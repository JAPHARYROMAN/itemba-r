import { ForbiddenException } from '@nestjs/common';
import { AccessLevel, AuditScopeKind } from '@prisma/client';
import { OfflineSyncService } from './offline-sync.service';

const USER = { id: 'user-a' } as any;
const DTO = {
  clientBatchId: 'client-batch-1',
  companyId: 'company-a',
  records: [],
  syncDirection: 'BIDIRECTIONAL',
} as any;

function harness() {
  const batches: any[] = [];
  const prisma = {
    offlineSyncBatch: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const batch = {
          id: 'batch-1',
          ...data,
          records: [],
        };
        batches.push(batch);
        return batch;
      }),
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        const includesGroupRows = where.OR?.some((clause: any) => clause.companyId === null);
        return batches.filter((batch) => batch.companyId !== null || includesGroupRows);
      }),
      count: jest.fn().mockImplementation(({ where }: any) => {
        const includesGroupRows = where.OR?.some((clause: any) => clause.companyId === null);
        return batches.filter((batch) => batch.companyId !== null || includesGroupRows).length;
      }),
    },
  } as any;
  prisma.$transaction = jest.fn(async (work: (tx: typeof prisma) => unknown) => work(prisma));
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const companyScope = {
    accessibleCompanyIds: jest.fn().mockResolvedValue(['company-a']),
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    isGroupScoped: jest.fn().mockReturnValue(false),
  } as any;
  const service = new OfflineSyncService(prisma, audit, {} as any, companyScope);
  return { audit, companyScope, prisma, service };
}

describe('OfflineSyncService.createBatch company authorization', () => {
  it('requires company WRITE before checking idempotency or creating records', async () => {
    const { companyScope, prisma, service } = harness();

    await service.createBatch(DTO, USER);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      USER,
      DTO.companyId,
      AccessLevel.WRITE,
    );
    expect(prisma.offlineSyncBatch.create).toHaveBeenCalledTimes(1);
  });

  it('does not read, create, or audit when company WRITE is denied', async () => {
    const { audit, companyScope, prisma, service } = harness();
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(
      new ForbiddenException('write access required'),
    );

    await expect(service.createBatch(DTO, USER)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.offlineSyncBatch.findFirst).not.toHaveBeenCalled();
    expect(prisma.offlineSyncBatch.create).not.toHaveBeenCalled();
    expect(audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('allows an unscoped batch only as an explicit group action and attributes its audit', async () => {
    const { audit, companyScope, prisma, service } = harness();
    const groupUser = { id: 'group-user', companyId: null, roleScopes: ['GROUP'] } as any;
    companyScope.isGroupScoped.mockReturnValue(true);

    const created = await service.createBatch({ ...DTO, companyId: undefined }, groupUser);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      groupUser,
      null,
      AccessLevel.WRITE,
    );
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: null,
        scopeKind: AuditScopeKind.GROUP,
        companyScopeIds: [],
      }),
    );

    const listed = await service.findAllBatches({} as any, groupUser);
    expect(listed.data).toEqual([created]);
    expect(prisma.offlineSyncBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ companyId: { in: ['company-a'] } }, { companyId: null }],
        },
      }),
    );

    prisma.offlineSyncBatch.findFirst.mockResolvedValueOnce(created);
    await expect(service.findOneBatch(created.id, groupUser)).resolves.toBe(created);
    expect(companyScope.assertCanAccessCompany).toHaveBeenLastCalledWith(groupUser, null);
  });

  it('never exposes group-level batches in a company-only list', async () => {
    const { companyScope, prisma, service } = harness();
    const companyUser = { id: 'company-user', companyId: 'company-a', roleScopes: [] } as any;

    await service.createBatch(DTO, companyUser);
    await service.findAllBatches({} as any, companyUser);

    expect(prisma.offlineSyncBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: { in: ['company-a'] } } }),
    );
  });

  it('fails the create transaction when its mandatory audit append fails', async () => {
    const { audit, service } = harness();
    const failure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(service.createBatch(DTO, USER)).rejects.toBe(failure);
  });
});
