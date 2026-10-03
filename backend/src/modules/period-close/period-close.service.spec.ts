import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PeriodCloseService } from './period-close.service';

function authUser(): AuthUser {
  return {
    id: 'closer-user',
    email: 'closer@itemba.local',
    roles: ['Accountant'],
    roleScopes: ['COMPANY'],
    permissions: ['period_close.close'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.MANAGE }],
  };
}

function makePrisma() {
  const prisma: any = {
    accountingPeriodClose: {
      findFirst: jest.fn(),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      create: jest.fn(async (args: any) => ({ id: 'close-1', ...args.data })),
    },
    accountingPeriod: {
      findFirst: jest.fn(),
      update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    },
    accountingLock: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ id: 'lock-1', ...args.data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    journalEntry: {
      count: jest.fn(async () => 0),
    },
    userCompanyAccess: {
      findMany: jest.fn(async () => []),
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return prisma;
}

function makeService(prisma: any) {
  return new PeriodCloseService(
    prisma,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    new CompanyScopeService(prisma),
  );
}

describe('PeriodCloseService GL controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('closes the underlying accounting period when the close is completed', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriodClose.findFirst.mockResolvedValue({
      id: 'close-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      accountingPeriodId: 'period-1',
      status: 'REVIEWING',
    });
    const service = makeService(prisma);

    await service.close('close-1', authUser());

    expect(prisma.accountingPeriodClose.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'close-1' },
        data: expect.objectContaining({ status: 'CLOSED', closedById: 'closer-user' }),
      }),
    );
    expect(prisma.accountingPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { status: 'CLOSED' },
    });
    expect(prisma.accountingLock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          accountingPeriodId: 'period-1',
          lockType: 'PERIOD_LOCK',
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('blocks period close while draft journals remain in the period', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriodClose.findFirst.mockResolvedValue({
      id: 'close-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      accountingPeriodId: 'period-1',
      status: 'REVIEWING',
    });
    prisma.journalEntry.count.mockResolvedValue(1);
    const service = makeService(prisma);

    await expect(service.close('close-1', authUser())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
  });

  it('re-checks for draft journals inside the close transaction to close the TOCTOU window (finding #24)', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriodClose.findFirst.mockResolvedValue({
      id: 'close-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      accountingPeriodId: 'period-1',
      status: 'REVIEWING',
    });
    // Simulate a DRAFT journal appearing AFTER the pre-transaction check passes:
    // first count (outside tx) returns 0, second count (inside tx) returns 1.
    prisma.journalEntry.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const service = makeService(prisma);

    await expect(service.close('close-1', authUser())).rejects.toBeInstanceOf(BadRequestException);
    // The check ran twice (once outside, once inside the transaction).
    expect(prisma.journalEntry.count).toHaveBeenCalledTimes(2);
    // The period must NOT have been closed because the in-transaction check aborted.
    expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
    expect(prisma.accountingLock.create).not.toHaveBeenCalled();
  });

  it('validates that close records match the requested company, fiscal year and period', async () => {
    const prisma = makePrisma();
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      companyId: 'company-2',
      fiscalYearId: 'fy-1',
    });
    const service = makeService(prisma);

    await expect(
      service.create(
        {
          companyId: 'company-1',
          fiscalYearId: 'fy-1',
          accountingPeriodId: 'period-1',
          closeNumber: 'CLOSE-1',
        },
        authUser(),
      ),
    ).rejects.toThrow('Accounting period must belong to the requested company and fiscal year');
  });
});

/** Party linkage, Phase 3 PR-3: the control-by-party gate and snapshot on the formal close. */
describe('PeriodCloseService party control gate', () => {
  function closeCheck(overrides: Record<string, any> = {}) {
    return {
      checkOrRefuse: jest.fn(async () => ({ rows: [], differences: [], hasDifferences: false })),
      snapshot: jest.fn(async () => 2),
      auditMetadata: jest.fn(() => ({ partyControl: { acknowledged: true } })),
      check: jest.fn(async () => ({ hasDifferences: false })),
      snapshots: jest.fn(async () => ({ rows: [] })),
      ...overrides,
    };
  }
  function closeRecord(prisma: any) {
    prisma.accountingPeriodClose.findFirst.mockResolvedValue({
      id: 'close-1',
      companyId: 'company-1',
      fiscalYearId: 'fy-1',
      accountingPeriodId: 'period-1',
      status: 'REVIEWING',
    });
    prisma.accountingPeriod.findFirst.mockResolvedValue({
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    });
  }

  it('refuses the close before any write when the gate refuses', async () => {
    const prisma = makePrisma();
    closeRecord(prisma);
    const gate = closeCheck({
      checkOrRefuse: jest.fn(async () => {
        throw new BadRequestException({ code: 'PARTY_CONTROL_DIFFERENCES' });
      }),
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new PeriodCloseService(
      prisma,
      audit as any,
      new CompanyScopeService(prisma),
      gate as any,
    );
    await expect(service.close('close-1', authUser())).rejects.toBeInstanceOf(BadRequestException);
    expect(gate.checkOrRefuse).toHaveBeenCalledWith(
      'company-1',
      new Date('2026-09-30T00:00:00.000Z'),
      expect.objectContaining({ id: 'closer-user' }),
      undefined,
    );
    expect(prisma.accountingPeriodClose.update).not.toHaveBeenCalled();
    expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('passes the acknowledgement through, snapshots inside the close and audits the reason', async () => {
    const prisma = makePrisma();
    closeRecord(prisma);
    const gate = closeCheck();
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new PeriodCloseService(
      prisma,
      audit as any,
      new CompanyScopeService(prisma),
      gate as any,
    );
    await service.close('close-1', authUser(), { reason: 'Legacy lines await the backfill' });
    expect((gate.checkOrRefuse as jest.Mock).mock.calls[0][3]).toEqual({
      reason: 'Legacy lines await the backfill',
    });
    expect(gate.snapshot).toHaveBeenCalledWith(
      prisma,
      {
        companyId: 'company-1',
        accountingPeriodId: 'period-1',
        periodCloseId: 'close-1',
        userId: 'closer-user',
      },
      expect.objectContaining({ hasDifferences: false }),
    );
    expect((gate.auditMetadata as jest.Mock).mock.calls[0][1]).toEqual({
      reason: 'Legacy lines await the backfill',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLOSE',
        companyId: 'company-1',
        metadata: { partyControl: { acknowledged: true } },
      }),
    );
    expect(prisma.accountingPeriod.update).toHaveBeenCalledWith({
      where: { id: 'period-1' },
      data: { status: 'CLOSED' },
    });
  });

  it('reads the check and the snapshots for the close record', async () => {
    const prisma = makePrisma();
    closeRecord(prisma);
    const gate = closeCheck();
    const service = new PeriodCloseService(
      prisma,
      { log: jest.fn() } as any,
      new CompanyScopeService(prisma),
      gate as any,
    );
    await service.partyCheck('close-1', authUser());
    expect(gate.check).toHaveBeenCalledWith(
      'company-1',
      new Date('2026-09-30T00:00:00.000Z'),
      expect.anything(),
    );
    await service.partySnapshots('close-1', authUser());
    expect(gate.snapshots).toHaveBeenCalledWith('period-1');
    const bare = makeService(prisma);
    await expect(bare.partyCheck('close-1', authUser())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
