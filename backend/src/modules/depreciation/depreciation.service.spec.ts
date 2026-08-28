import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DepreciationService } from './depreciation.service';

/**
 * Fully-mocked unit tests for the depreciation poster. No Postgres / real
 * Prisma client needed — the delegates the service touches are stubbed on a
 * mock `prisma` object and `$transaction` runs the callback inline.
 *
 * Focus: postEntry() must post a BALANCED journal entry (DR DEPRECIATION_EXPENSE
 * / CR ACCUMULATED_DEPRECIATION) AND write the depreciation back to the
 * FixedAsset subledger (currentBookValue), floored at the schedule salvage
 * value, so the register never diverges from the GL contra-account.
 */

const D = (v: number | string) => new Prisma.Decimal(v);

const USER = { id: 'user-1' } as any;

function makeGenerationService() {
  const schedule = {
    id: 'sch-1',
    companyId: 'company-1',
    fixedAssetId: 'fa-1',
    depreciationMethod: 'STRAIGHT_LINE',
    startDate: new Date('2026-01-31T00:00:00.000Z'),
    usefulLifeMonths: 10,
    salvageValue: D(0),
    totalDepreciableAmount: D(1_000),
    accumulatedDepreciation: D(200),
    deletedAt: null,
  };
  const existing = [
    {
      id: 'draft-1',
      depreciationDate: new Date('2026-03-31T00:00:00.000Z'),
      amount: D(100),
      status: 'DRAFT',
    },
  ];
  let createdSequence = 0;
  const create = jest.fn(async ({ data }: any) => ({
    id: `created-${++createdSequence}`,
    ...data,
  }));
  const findMany = jest.fn(async () => existing);
  const scheduleFindFirst = jest.fn(async () => schedule);
  const $queryRaw = jest.fn(async () => [{ id: schedule.id }]);
  const prisma: any = {
    depreciationSchedule: { findFirst: scheduleFindFirst },
    depreciationEntry: { findMany, create },
    $queryRaw,
  };
  prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));

  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new DepreciationService(
    prisma,
    auditLogs,
    {} as any,
    {} as any,
    {} as any,
    companyScope,
  );

  return {
    service,
    prisma,
    create,
    findMany,
    schedule,
    scheduleFindFirst,
    $queryRaw,
    auditLogs,
  };
}

function makeService(opts?: {
  entryStatus?: string;
  amount?: number;
  salvageValue?: number;
  currentBookValue?: number;
  /** Simulate the FOR UPDATE lock returning no asset row. */
  missingAsset?: boolean;
  /** updateMany claim result (0 => lost the TOCTOU race). */
  claimCount?: number;
}) {
  const entryStatus = opts?.entryStatus ?? 'DRAFT';
  const amount = opts?.amount ?? 200_000;
  const salvageValue = opts?.salvageValue ?? 0;
  const currentBookValue = opts?.currentBookValue ?? 12_000_000;

  const entry = {
    id: 'de-1',
    amount: D(amount),
    depreciationDate: new Date('2026-06-30'),
    status: entryStatus,
    depreciationScheduleId: 'sch-1',
    depreciationSchedule: {
      id: 'sch-1',
      companyId: 'company-1',
      fixedAssetId: 'fa-1',
      salvageValue: D(salvageValue),
    },
    fixedAsset: {
      name: 'Toyota Hilux',
      assetCode: 'FA-2024-001',
      divisionId: 'division-1',
      branchId: 'branch-1',
    },
  };

  const depreciationEntry = {
    findFirst: jest.fn(async () => ({ ...entry })),
    updateMany: jest.fn(async () => ({ count: opts?.claimCount ?? 1 })),
    update: jest.fn(async ({ data }: any) => ({ ...entry, ...data })),
  };

  const depreciationSchedule = {
    update: jest.fn(async () => ({})),
  };

  const fixedAssetUpdate = jest.fn(async ({ data }: any) => ({ id: 'fa-1', ...data }));
  const fixedAsset = { update: fixedAssetUpdate };

  const $queryRaw = jest.fn(async () =>
    opts?.missingAsset ? [] : [{ currentBookValue: D(currentBookValue) }],
  );

  const prisma: any = {
    depreciationEntry,
    depreciationSchedule,
    fixedAsset,
    $queryRaw,
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_companyId: string, role: string) =>
      role === 'DEPRECIATION_EXPENSE' ? { id: 'acc-dep-exp' } : { id: 'acc-accum-dep' },
    ),
  } as any;
  const postingEngine = {
    postLines: jest.fn(async () => ({ id: 'je-1', journalNumber: 'DEP-2026-00001' })),
  } as any;
  const codes = { next: jest.fn(async () => 'DEP-2026-00001') } as any;

  const service = new DepreciationService(
    prisma,
    auditLogs,
    accountResolver,
    codes,
    postingEngine,
    companyScope,
  );

  return { service, prisma, postingEngine, fixedAssetUpdate, depreciationSchedule, $queryRaw };
}

describe('DepreciationService.postEntry', () => {
  it('posts a balanced DR DEPRECIATION_EXPENSE / CR ACCUMULATED_DEPRECIATION journal entry', async () => {
    const { service, postingEngine } = makeService({ amount: 200_000 });

    await service.postEntry('de-1', USER);

    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const [payload] = postingEngine.postLines.mock.calls[0];
    const lines = payload.lines;
    expect(lines).toHaveLength(2);

    const debit = lines.find((l: any) => l.debit > 0);
    const credit = lines.find((l: any) => l.credit > 0);
    expect(debit.accountId).toBe('acc-dep-exp');
    expect(debit.debit).toBe(200_000);
    expect(credit.accountId).toBe('acc-accum-dep');
    expect(credit.credit).toBe(200_000);

    // Balanced: total debits === total credits.
    const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);

    expect(payload.referenceType).toBe('DepreciationEntry');
    expect(payload.referenceId).toBe('de-1');
  });

  it('writes back FixedAsset.currentBookValue decremented by the posted amount (subledger stays in lockstep with the GL)', async () => {
    const { service, fixedAssetUpdate, $queryRaw } = makeService({
      amount: 200_000,
      currentBookValue: 12_000_000,
    });

    await service.postEntry('de-1', USER);

    // Locked the asset row FOR UPDATE before the read-modify-write.
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(fixedAssetUpdate).toHaveBeenCalledTimes(1);
    const { where, data } = fixedAssetUpdate.mock.calls[0][0];
    expect(where.id).toBe('fa-1');
    expect(new Prisma.Decimal(data.currentBookValue).toString()).toBe('11800000');
  });

  it('floors currentBookValue at the schedule salvage value (never below residual)', async () => {
    const { service, fixedAssetUpdate } = makeService({
      amount: 200_000,
      currentBookValue: 100_000,
      salvageValue: 50_000,
    });

    await service.postEntry('de-1', USER);

    const { data } = fixedAssetUpdate.mock.calls[0][0];
    // 100_000 - 200_000 = -100_000, floored to salvage 50_000.
    expect(new Prisma.Decimal(data.currentBookValue).toString()).toBe('50000');
  });

  it('aborts (no JE, no writeback) when the entry is not DRAFT', async () => {
    const { service, postingEngine, fixedAssetUpdate } = makeService({ entryStatus: 'POSTED' });

    await expect(service.postEntry('de-1', USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(fixedAssetUpdate).not.toHaveBeenCalled();
  });

  it('aborts when the atomic DRAFT->POSTED claim is lost (concurrent post)', async () => {
    const { service, postingEngine, fixedAssetUpdate } = makeService({ claimCount: 0 });

    await expect(service.postEntry('de-1', USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(fixedAssetUpdate).not.toHaveBeenCalled();
  });

  it('excludes soft-deleted entries from both lookup and the atomic posting claim', async () => {
    const { service, prisma } = makeService();

    await service.postEntry('de-1', USER);

    expect(prisma.depreciationEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'de-1', deletedAt: null } }),
    );
    expect(prisma.depreciationEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'de-1', status: 'DRAFT', deletedAt: null },
      data: { status: 'POSTED' },
    });
  });

  it('throws NotFound when the locked asset row is missing', async () => {
    const { service, fixedAssetUpdate } = makeService({ missingAsset: true });

    await expect(service.postEntry('de-1', USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(fixedAssetUpdate).not.toHaveBeenCalled();
  });
});

describe('DepreciationService.generateEntries', () => {
  it('returns the exact ID for one deterministic zero-entry straight-line period', async () => {
    const { service, create, findMany, schedule, auditLogs } = makeGenerationService();
    findMany.mockResolvedValue([]);
    schedule.accumulatedDepreciation = D(0);

    await expect(service.generateEntries('sch-1', 1, USER)).resolves.toEqual({
      created: 1,
      entryIds: ['created-1'],
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        depreciationScheduleId: 'sch-1',
        companyId: 'company-1',
        fixedAssetId: 'fa-1',
        depreciationDate: new Date('2026-01-31T00:00:00.000Z'),
        amount: 100,
        accumulatedDepreciationAfter: 100,
        status: 'DRAFT',
      },
    });
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'GENERATE',
        entityType: 'DepreciationSchedule',
        entityId: 'sch-1',
        companyId: 'company-1',
        metadata: { generated: 1, months: 1 },
      }),
    );
  });

  it('locks the schedule before re-reading entries and includes existing drafts', async () => {
    const { service, create, findMany, scheduleFindFirst, $queryRaw, auditLogs } =
      makeGenerationService();

    await expect(service.generateEntries('sch-1', 2, USER)).resolves.toEqual({
      created: 2,
      entryIds: ['created-1', 'created-2'],
    });

    // One lookup authorizes company WRITE; the second happens after the row
    // lock and supplies the generation snapshot.
    expect(scheduleFindFirst).toHaveBeenCalledTimes(2);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findMany.mock.invocationCallOrder[0],
    );
    expect(create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        depreciationScheduleId: 'sch-1',
        depreciationDate: new Date('2026-04-30T00:00:00.000Z'),
        amount: 100,
        // 200 posted + 100 existing draft + 100 newly generated.
        accumulatedDepreciationAfter: 400,
        status: 'DRAFT',
      }),
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        depreciationScheduleId: 'sch-1',
        depreciationDate: new Date('2026-05-31T00:00:00.000Z'),
        amount: 100,
        accumulatedDepreciationAfter: 500,
        status: 'DRAFT',
      }),
    });
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(expect.anything(), {
      action: 'GENERATE',
      entityType: 'DepreciationSchedule',
      entityId: 'sch-1',
      userId: 'user-1',
      companyId: 'company-1',
      metadata: { generated: 2, months: 2 },
    });
  });

  it('fails the generation transaction when its mandatory audit append fails', async () => {
    const { service, auditLogs } = makeGenerationService();
    const failure = new Error('audit append unavailable');
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.generateEntries('sch-1', 1, USER)).rejects.toBe(failure);
  });
});
