import { ForbiddenException } from '@nestjs/common';
import {
  AccessLevel,
  AuditAttributionStatus,
  AuditChannel,
  AuditScopeKind,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { CompanyScopeService } from '../../common/services';
import {
  recordValidatedCompanyScope,
  runWithRequestContext,
} from '../../common/context/request-context';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from './entity-code-generator.service';
import {
  BACKFILL_TARGETS,
  SequenceBackfillService,
  sequenceBackfillAuditScope,
  sequenceResetDue,
} from './sequence-backfill.service';

type ResetFrequency = 'NEVER' | 'YEARLY' | 'MONTHLY' | 'DAILY';

interface SequenceState {
  id: string;
  currentNumber: number;
  resetFrequency: ResetFrequency;
  lastResetAt: Date | null;
  sequenceCode?: string;
  companyId?: string;
  entityType?: string;
  prefix?: string;
  suffix?: string | null;
  padding?: number;
  isActive?: boolean;
}

function sequenceBackfillService(
  prisma: unknown,
  companyScope: unknown,
  auditLogs: unknown,
): SequenceBackfillService {
  return new SequenceBackfillService(
    prisma as PrismaService,
    companyScope as CompanyScopeService,
    auditLogs as AuditLogsService,
  );
}

function entityCodeGenerator(documentNumberSequence: unknown): EntityCodeGeneratorService {
  return new EntityCodeGeneratorService({ documentNumberSequence } as unknown as PrismaService);
}

describe('SequenceBackfillService audit attribution', () => {
  const user = { id: 'user-1' } as AuthUser;

  function makeHarness() {
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const companyScope = {
      isGroupScoped: jest.fn().mockReturnValue(true),
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      accessibleCompanyIds: jest.fn().mockResolvedValue([]),
    };
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: sequenceBackfillService(prisma, companyScope, auditLogs),
      companyScope,
      auditLogs,
    };
  }

  it('does not append a mutation summary when no company passed WRITE policy', async () => {
    const { service, auditLogs } = makeHarness();

    await expect(service.backfillAll(user)).resolves.toEqual([]);

    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('does not claim audit evidence when authorization fails', async () => {
    const { service, companyScope, auditLogs } = makeHarness();
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(new Error('access denied'));

    await expect(service.backfillAll(user, { companyId: 'company-1' })).rejects.toThrow(
      'access denied',
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});

describe('SequenceBackfillService target metadata and execution', () => {
  const companyId = 'company-1';
  const user = { id: 'user-1' } as AuthUser;

  it('maps zero, one, and many post-WRITE companies to exact audit scopes', () => {
    expect(sequenceBackfillAuditScope([])).toBeUndefined();
    expect(sequenceBackfillAuditScope(['company-b', 'company-b'])).toEqual({
      scopeKind: AuditScopeKind.COMPANY,
      companyScopeIds: ['company-b'],
    });
    expect(sequenceBackfillAuditScope(['company-b', 'company-a', 'company-b'])).toEqual({
      scopeKind: AuditScopeKind.MULTI_COMPANY,
      companyScopeIds: ['company-a', 'company-b'],
    });
  });

  function makeExecutionHarness(input?: {
    rowsByModel?: Record<string, Array<Record<string, unknown>>>;
    existingBySequence?: Record<
      string,
      {
        id: string;
        currentNumber: number;
        resetFrequency?: ResetFrequency;
        lastResetAt?: Date | null;
      }
    >;
    candidateCompanyIds?: string[];
    accessibleCompanyIds?: string[];
    groupScoped?: boolean;
    readOnlyCompanyIds?: string[];
    persistAudit?: boolean;
    beforeAtomicAlign?: (
      state: SequenceState,
      operation: { anchorsPeriod: boolean; sql: string },
      callIndex: number,
    ) => void;
  }) {
    const rowsByModel = input?.rowsByModel ?? {};
    const sequenceByCode = new Map<string, SequenceState>(
      Object.entries(input?.existingBySequence ?? {}).map(([sequenceCode, sequence]) => [
        sequenceCode,
        {
          ...sequence,
          resetFrequency: sequence.resetFrequency ?? ('YEARLY' as const),
          lastResetAt: sequence.lastResetAt ?? null,
        } satisfies SequenceState,
      ]),
    );
    const sequenceById = new Map(
      [...sequenceByCode.values()].map((sequence) => [sequence.id, sequence]),
    );
    const delegates = new Map<string, { findMany: jest.Mock }>();
    let atomicAlignCallIndex = 0;
    const documentNumberSequence = {
      findFirst: jest.fn(async ({ where }: { where: { sequenceCode: string } }) => {
        const sequence = sequenceByCode.get(where.sequenceCode);
        return sequence ? { ...sequence } : null;
      }),
      findFirstOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const sequence = sequenceById.get(where.id);
        if (!sequence) throw new Error(`Missing sequence ${where.id}`);
        return { ...sequence };
      }),
      create: jest.fn(
        async ({ data }: { data: Omit<SequenceState, 'id'> & { sequenceCode: string } }) => {
          const sequence: SequenceState = { id: 'created-sequence', ...data };
          sequenceByCode.set(data.sequenceCode, sequence);
          sequenceById.set(sequence.id, sequence);
          return { ...sequence };
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
          id: where.id,
          ...data,
        }),
      ),
      updateMany: jest.fn(),
    };
    const candidateCompanyIds = input?.candidateCompanyIds ?? [];
    const executeRaw = jest.fn(async (query: Prisma.Sql) => {
      const sql = query.strings.join('?');
      const maxFound = query.values.find((value): value is number => typeof value === 'number');
      const id = query.values.find(
        (value): value is string => typeof value === 'string' && sequenceById.has(value),
      );
      if (maxFound === undefined || !id) throw new Error('Malformed atomic alignment query');
      const sequence = sequenceById.get(id)!;
      const anchorsPeriod = sql.includes('"lastResetAt" = CASE');
      input?.beforeAtomicAlign?.(sequence, { anchorsPeriod, sql }, atomicAlignCallIndex++);
      if (!anchorsPeriod && !(sequence.currentNumber < maxFound)) return 0;
      sequence.currentNumber = Math.max(sequence.currentNumber, maxFound);
      if (anchorsPeriod && sequence.resetFrequency !== 'NEVER') {
        sequence.lastResetAt = query.values.find((value): value is Date => value instanceof Date)!;
      }
      return 1;
    });
    const prismaBase = {
      company: {
        findMany: jest.fn(async ({ where }: { where: { id?: { in: string[] } } }) => {
          const allowedIds = where.id?.in as string[] | undefined;
          return candidateCompanyIds
            .filter((id) => !allowedIds || allowedIds.includes(id))
            .map((id) => ({ id }));
        }),
      },
      documentNumberSequence,
      $executeRaw: executeRaw,
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-row' }) },
    };
    const prisma = new Proxy(prismaBase, {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        if (typeof property !== 'string') return undefined;
        let delegate = delegates.get(property);
        if (!delegate) {
          delegate = {
            findMany: jest.fn(async () => rowsByModel[property] ?? []),
          };
          delegates.set(property, delegate);
        }
        return delegate;
      },
    });
    const companyScope = {
      isGroupScoped: jest.fn().mockReturnValue(input?.groupScoped ?? true),
      assertCanAccessCompany: jest.fn(async (_user: unknown, id: string, level: AccessLevel) => {
        if (level === AccessLevel.WRITE && input?.readOnlyCompanyIds?.includes(id)) {
          throw new ForbiddenException('Insufficient access level for this company');
        }
      }),
      accessibleCompanyIds: jest.fn().mockResolvedValue(input?.accessibleCompanyIds ?? []),
    };
    const auditLogs = input?.persistAudit
      ? new AuditLogsService(prisma as unknown as PrismaService)
      : { log: jest.fn().mockResolvedValue(undefined) };

    return {
      service: sequenceBackfillService(prisma, companyScope, auditLogs),
      delegates,
      documentNumberSequence,
      executeRaw,
      sequenceByCode,
      companyScope,
      auditLogs,
      auditLogCreate: prismaBase.auditLog.create,
      company: prismaBase.company,
    };
  }

  it('requires WRITE per candidate in an omitted-company group sweep', async () => {
    const { service, companyScope, auditLogs } = makeExecutionHarness({
      candidateCompanyIds: ['company-write', 'company-read'],
      groupScoped: true,
      readOnlyCompanyIds: ['company-read'],
    });

    const results = await service.backfillAll(user);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-write',
      AccessLevel.WRITE,
    );
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-read',
      AccessLevel.WRITE,
    );
    expect(results).toHaveLength(BACKFILL_TARGETS.length);
    expect(results.every((result) => result.sequenceCode.endsWith('_company-write'))).toBe(true);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          companies: 1,
          targets: BACKFILL_TARGETS.length,
          updated: 0,
          failed: 0,
        },
      }),
    );
  });

  it('excludes READ-only candidates from an omitted-company non-group sweep', async () => {
    const { service, companyScope, company } = makeExecutionHarness({
      candidateCompanyIds: ['company-write', 'company-read', 'company-not-visible'],
      accessibleCompanyIds: ['company-write', 'company-read'],
      groupScoped: false,
      readOnlyCompanyIds: ['company-read'],
    });

    const results = await service.backfillAll(user);

    expect(company.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['company-write', 'company-read'] },
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(BACKFILL_TARGETS.length);
    expect(results.every((result) => result.sequenceCode.endsWith('_company-write'))).toBe(true);
  });

  it('persists only post-WRITE scope even when ambient discovery contains a READ-only company', async () => {
    const { service, auditLogCreate } = makeExecutionHarness({
      candidateCompanyIds: ['company-write', 'company-read'],
      accessibleCompanyIds: ['company-write', 'company-read'],
      groupScoped: false,
      readOnlyCompanyIds: ['company-read'],
      persistAudit: true,
    });

    await runWithRequestContext({ channel: AuditChannel.WEB }, async () => {
      // Model the real discovery side effect: accessibleCompanyIds() records
      // READ-visible companies before the service applies WRITE filtering.
      recordValidatedCompanyScope('MULTI_COMPANY', ['company-write', 'company-read']);
      await service.backfillAll(user);
    });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const persisted = auditLogCreate.mock.calls[0][0].data;
    expect(persisted).toEqual(
      expect.objectContaining({
        action: 'ENTITY_CODE_BACKFILL',
        companyId: 'company-write',
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.EXPLICIT,
        companyScopes: { create: [{ companyId: 'company-write' }] },
      }),
    );
    expect(JSON.stringify(persisted.companyScopes)).not.toContain('company-read');
  });

  it('keeps ordinary targets on companyId and scopes intercompany numbers exactly to fromCompanyId', async () => {
    const { service, delegates } = makeExecutionHarness();

    await service.backfillAll(user, { companyId });

    expect(delegates.get('trip')?.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId } }),
    );
    expect(delegates.get('interCompanyTransaction')?.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fromCompanyId: companyId } }),
    );
    expect(delegates.get('interCompanyTransaction')?.findMany.mock.calls[0][0].where).toEqual({
      fromCompanyId: companyId,
    });
  });

  it('parses the highest matching intercompany number and advances an existing sequence', async () => {
    const year = new Date().getFullYear();
    const sequenceCode = `IntercompanyTransaction_${companyId}`;
    const { service, documentNumberSequence, executeRaw } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [
          { transactionNumber: `IC-${year}-00007` },
          { transactionNumber: `IC-${year}-00042` },
          { transactionNumber: `IC-${year - 1}-00999` },
          { transactionNumber: `IC-${year}-legacy` },
        ],
      },
      existingBySequence: {
        [sequenceCode]: {
          id: 'intercompany-sequence',
          currentNumber: 5,
          lastResetAt: new Date(`${year}-01-01T00:00:00.000Z`),
        },
      },
    });

    const results = await service.backfillAll(user, { companyId });

    expect(results.find((result) => result.entityType === 'IntercompanyTransaction')).toEqual({
      entityType: 'IntercompanyTransaction',
      sequenceCode,
      rowsScanned: 4,
      matchingRows: 2,
      maxFound: 42,
      before: 5,
      after: 42,
      updated: true,
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sql = executeRaw.mock.calls[0][0].strings.join('?');
    expect(sql).toContain('GREATEST("currentNumber", ?)');
    expect(sql).toContain('AND "currentNumber" < ?');
    expect(documentNumberSequence.update).not.toHaveBeenCalled();
    expect(documentNumberSequence.updateMany).not.toHaveBeenCalled();
  });

  it('atomically anchors an existing periodic legacy maximum so next emits max + 1', async () => {
    const year = new Date().getFullYear();
    const sequenceCode = `IntercompanyTransaction_${companyId}`;
    const { service, sequenceByCode, documentNumberSequence, executeRaw } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [{ transactionNumber: `IC-${year}-00042` }],
      },
      existingBySequence: {
        [sequenceCode]: {
          id: 'legacy-periodic-sequence',
          currentNumber: 5,
          resetFrequency: 'YEARLY',
          lastResetAt: null,
        },
      },
    });

    const results = await service.backfillAll(user, { companyId });
    const sequence = sequenceByCode.get(sequenceCode)!;

    expect(results.find((result) => result.entityType === 'IntercompanyTransaction')).toEqual(
      expect.objectContaining({ before: 5, maxFound: 42, after: 42, updated: true }),
    );
    expect(executeRaw.mock.calls[0][0].strings.join('?')).toContain('"lastResetAt" = CASE');
    expect(sequence.lastResetAt).toEqual(expect.any(Date));

    const generatorDelegate = {
      findFirst: jest.fn(async () => ({ ...sequence })),
      update: jest.fn(async () => {
        sequence.currentNumber += 1;
        return {
          currentNumber: sequence.currentNumber,
          prefix: `IC-{YYYY}-`,
          suffix: null,
          padding: 5,
        };
      }),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    };
    const generator = entityCodeGenerator(generatorDelegate);

    await expect(
      generator.next({
        entityType: 'IntercompanyTransaction',
        companyId,
        when: sequence.lastResetAt!,
      }),
    ).resolves.toBe(`IC-${year}-00043`);
    expect(generatorDelegate.updateMany).not.toHaveBeenCalled();
    expect(documentNumberSequence.updateMany).not.toHaveBeenCalled();
  });

  it('refreshes a prior-year periodic anchor before the next issuer can reset recovered data', async () => {
    const year = new Date().getFullYear();
    const sequenceCode = `IntercompanyTransaction_${companyId}`;
    const { service, sequenceByCode } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [{ transactionNumber: `IC-${year}-00042` }],
      },
      existingBySequence: {
        [sequenceCode]: {
          id: 'stale-yearly-sequence',
          currentNumber: 5,
          resetFrequency: 'YEARLY',
          lastResetAt: new Date(`${year - 1}-07-01T12:00:00.000Z`),
        },
      },
    });

    const results = await service.backfillAll(user, { companyId });
    const sequence = sequenceByCode.get(sequenceCode)!;

    expect(results.find((result) => result.entityType === 'IntercompanyTransaction')).toEqual(
      expect.objectContaining({ before: 5, maxFound: 42, after: 42, updated: true }),
    );
    expect(sequence.lastResetAt?.getFullYear()).toBe(year);

    const generatorDelegate = {
      findFirst: jest.fn(async () => ({ ...sequence })),
      update: jest.fn(async () => {
        sequence.currentNumber += 1;
        return {
          currentNumber: sequence.currentNumber,
          prefix: `IC-{YYYY}-`,
          suffix: null,
          padding: 5,
        };
      }),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    };
    const generator = entityCodeGenerator(generatorDelegate);

    await expect(
      generator.next({
        entityType: 'IntercompanyTransaction',
        companyId,
        when: sequence.lastResetAt!,
      }),
    ).resolves.toBe(`IC-${year}-00043`);
    expect(generatorDelegate.updateMany).not.toHaveBeenCalled();
  });

  it('never rolls a sequence back when an issuer advances above the scanned maximum', async () => {
    const year = new Date().getFullYear();
    const sequenceCode = `IntercompanyTransaction_${companyId}`;
    const { service, sequenceByCode, documentNumberSequence, executeRaw } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [{ transactionNumber: `IC-${year}-00042` }],
      },
      existingBySequence: {
        [sequenceCode]: {
          id: 'racing-sequence',
          currentNumber: 5,
          resetFrequency: 'YEARLY',
          lastResetAt: new Date(`${year}-01-01T00:00:00.000Z`),
        },
      },
      beforeAtomicAlign: (sequence, _operation, callIndex) => {
        if (callIndex === 0) sequence.currentNumber = 43;
      },
    });

    const results = await service.backfillAll(user, { companyId });

    expect(sequenceByCode.get(sequenceCode)?.currentNumber).toBe(43);
    expect(results.find((result) => result.entityType === 'IntercompanyTransaction')).toEqual(
      expect.objectContaining({ before: 5, maxFound: 42, after: 43, updated: false }),
    );
    expect(executeRaw.mock.calls[0][0].strings.join('?')).toContain('GREATEST("currentNumber", ?)');
    expect(documentNumberSequence.update).not.toHaveBeenCalled();
    expect(documentNumberSequence.updateMany).not.toHaveBeenCalled();
  });

  it('anchors without lowering when an issuer advances an unanchored row above legacy max', async () => {
    const year = new Date().getFullYear();
    const sequenceCode = `IntercompanyTransaction_${companyId}`;
    const { service, sequenceByCode } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [{ transactionNumber: `IC-${year}-00042` }],
      },
      existingBySequence: {
        [sequenceCode]: {
          id: 'unanchored-racing-sequence',
          currentNumber: 5,
          resetFrequency: 'YEARLY',
          lastResetAt: null,
        },
      },
      beforeAtomicAlign: (sequence) => {
        sequence.currentNumber = 43;
      },
    });

    const results = await service.backfillAll(user, { companyId });
    const sequence = sequenceByCode.get(sequenceCode)!;

    expect(sequence.currentNumber).toBe(43);
    expect(sequence.lastResetAt).toEqual(expect.any(Date));
    expect(results.find((result) => result.entityType === 'IntercompanyTransaction')).toEqual(
      expect.objectContaining({ before: 5, maxFound: 42, after: 43, updated: true }),
    );
  });

  it('restores legacy max when a stale issuer wins reset immediately before atomic alignment', async () => {
    const year = new Date().getFullYear();
    const sequenceCode = `IntercompanyTransaction_${companyId}`;
    const issuerResetAt = new Date(`${year}-08-01T12:00:00.000Z`);
    const { service, sequenceByCode } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [{ transactionNumber: `IC-${year}-00042` }],
      },
      existingBySequence: {
        [sequenceCode]: {
          id: 'issuer-reset-race',
          currentNumber: 50,
          resetFrequency: 'YEARLY',
          lastResetAt: null,
        },
      },
      beforeAtomicAlign: (sequence, operation) => {
        expect(operation.anchorsPeriod).toBe(true);
        sequence.currentNumber = 1;
        sequence.lastResetAt = issuerResetAt;
      },
    });

    const results = await service.backfillAll(user, { companyId });
    const sequence = sequenceByCode.get(sequenceCode)!;

    expect(sequence.currentNumber).toBe(42);
    expect(sequence.lastResetAt).toEqual(expect.any(Date));
    expect(results.find((result) => result.entityType === 'IntercompanyTransaction')).toEqual(
      expect.objectContaining({ before: 50, maxFound: 42, after: 42, updated: true }),
    );
  });

  it('anchors a newly backfilled periodic sequence so the next generated number is max + 1', async () => {
    const year = new Date().getFullYear();
    const { service, documentNumberSequence } = makeExecutionHarness({
      rowsByModel: {
        interCompanyTransaction: [{ transactionNumber: `IC-${year}-00042` }],
      },
    });

    const results = await service.backfillAll(user, { companyId });
    const result = results.find((item) => item.entityType === 'IntercompanyTransaction');
    const createCall = documentNumberSequence.create.mock.calls.find(
      ([{ data }]) => data.entityType === 'IntercompanyTransaction',
    );
    expect(result).toEqual(
      expect.objectContaining({ maxFound: 42, before: 0, after: 42, updated: true }),
    );
    expect(createCall).toBeDefined();
    const created = createCall![0].data;
    expect(created).toEqual(
      expect.objectContaining({
        sequenceCode: `IntercompanyTransaction_${companyId}`,
        companyId,
        currentNumber: 42,
        resetFrequency: 'YEARLY',
        lastResetAt: expect.any(Date),
      }),
    );

    const sequence = { id: 'created-sequence', ...created };
    const generatorDelegate = {
      findFirst: jest.fn(async () => ({ ...sequence })),
      update: jest.fn(async () => {
        sequence.currentNumber += 1;
        return {
          currentNumber: sequence.currentNumber,
          prefix: sequence.prefix,
          suffix: sequence.suffix,
          padding: sequence.padding,
        };
      }),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    };
    const generator = entityCodeGenerator(generatorDelegate);

    await expect(
      generator.next({
        entityType: 'IntercompanyTransaction',
        companyId,
        when: created.lastResetAt!,
      }),
    ).resolves.toBe(`IC-${year}-00043`);
    expect(generatorDelegate.updateMany).not.toHaveBeenCalled();
    expect(generatorDelegate.update).toHaveBeenCalledWith({
      where: { id: 'created-sequence' },
      data: { currentNumber: { increment: 1 } },
      select: { currentNumber: true, prefix: true, suffix: true, padding: true },
    });
  });

  it('keeps every registry model, number field, and company-scope field aligned with Prisma', () => {
    const errors = BACKFILL_TARGETS.flatMap((target) => {
      const modelName = `${target.prismaModel[0].toUpperCase()}${target.prismaModel.slice(1)}`;
      const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
      if (!model) return [`${target.entityType}: missing Prisma model ${modelName}`];
      const fields = new Set(
        model.fields.filter((field) => field.kind === 'scalar').map((field) => field.name),
      );
      return [target.numberField, target.companyIdField ?? 'companyId']
        .filter((field) => !fields.has(field))
        .map((field) => `${target.entityType}: missing scalar field ${modelName}.${field}`);
    });

    expect(errors).toEqual([]);
  });

  it('detects stale YEARLY and MONTHLY anchors without refreshing current-period anchors', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');

    expect(sequenceResetDue('YEARLY', new Date('2025-07-15T12:00:00.000Z'), now)).toBe(true);
    expect(sequenceResetDue('YEARLY', new Date('2026-01-01T12:00:00.000Z'), now)).toBe(false);
    expect(sequenceResetDue('MONTHLY', new Date('2026-06-30T12:00:00.000Z'), now)).toBe(true);
    expect(sequenceResetDue('MONTHLY', new Date('2026-07-01T12:00:00.000Z'), now)).toBe(false);
  });
});
