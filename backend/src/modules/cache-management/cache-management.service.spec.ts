import { ForbiddenException } from '@nestjs/common';
import { CacheManagementService } from './cache-management.service';

describe('CacheManagementService mutation audit attribution', () => {
  const user = { id: 'user-1', roleScopes: [], companyId: 'company-1' } as any;
  const groupUser = { id: 'group-user', roleScopes: ['GROUP'], companyId: null } as any;

  function makeHarness() {
    const record = {
      id: 'cache-1',
      cacheKey: 'evidence-key',
      companyId: 'company-1',
      value: { ready: true },
    };
    const prisma = {
      cacheEntry: {
        upsert: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue(record),
        delete: jest.fn().mockResolvedValue(record),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        groupBy: jest.fn().mockResolvedValue([{ cacheType: 'PERMISSION', _count: { id: 2 } }]),
        count: jest.fn().mockResolvedValue(2),
      },
    } as any;
    prisma.$transaction = jest.fn(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const auditLogs = {
      log: jest.fn().mockResolvedValue(undefined),
      logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    return {
      service: new CacheManagementService(prisma, auditLogs, companyScope),
      prisma,
      auditLogs,
      companyScope,
    };
  }

  it('writes exactly one attributable row after the upsert succeeds', async () => {
    const { service, auditLogs, companyScope } = makeHarness();

    await service.set(
      {
        cacheKey: 'evidence-key',
        companyId: 'company-1',
        value: { ready: true },
        expiresAt: '2026-09-01T00:00:00.000Z',
      },
      user,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', 'WRITE');
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CACHE_ENTRY_SET',
        entityType: 'CacheEntry',
        entityId: 'cache-1',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
  });

  it('does not claim audit evidence when the upsert fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.cacheEntry.upsert.mockRejectedValueOnce(new Error('database rejected mutation'));

    await expect(
      service.set(
        {
          cacheKey: 'evidence-key',
          companyId: 'company-1',
          value: { ready: true },
          expiresAt: '2026-09-01T00:00:00.000Z',
        },
        user,
      ),
    ).rejects.toThrow('database rejected mutation');
    expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('authorizes and binds the persisted company before deleting one entry', async () => {
    const { service, prisma, auditLogs, companyScope } = makeHarness();

    await service.remove('cache-1', user);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', 'WRITE');
    expect(prisma.cacheEntry.delete).toHaveBeenCalledWith({ where: { id: 'cache-1' } });
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CACHE_ENTRY_INVALIDATED',
        entityId: 'cache-1',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
  });

  it('authorizes a company bulk invalidation before deletion and binds that company', async () => {
    const { service, prisma, auditLogs, companyScope } = makeHarness();

    await service.invalidateByCompany('company-1', user);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1', 'WRITE');
    expect(prisma.cacheEntry.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
    });
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CACHE_INVALIDATED_BY_COMPANY',
        userId: 'user-1',
        companyId: 'company-1',
      }),
    );
  });

  it('does not delete or audit when company authorization fails', async () => {
    const { service, prisma, auditLogs, companyScope } = makeHarness();
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(new Error('forbidden'));

    await expect(service.invalidateByCompany('company-2', user)).rejects.toThrow('forbidden');

    expect(prisma.cacheEntry.deleteMany).not.toHaveBeenCalled();
    expect(auditLogs.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('treats prefix invalidation as an explicitly global group action', async () => {
    const { service, auditLogs, companyScope } = makeHarness();

    await service.invalidateByPrefix('report:', groupUser);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(groupUser, null, 'WRITE');
    expect(auditLogs.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CACHE_INVALIDATED_BY_PREFIX',
        userId: 'group-user',
        companyId: null,
      }),
    );
  });

  it('authorizes group scope before reading group-wide cache statistics', async () => {
    const { service, prisma, companyScope } = makeHarness();

    await expect(service.getStats(groupUser)).resolves.toEqual({
      total: 2,
      expired: 2,
      byType: [{ cacheType: 'PERMISSION', count: 2 }],
    });

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(groupUser, null, 'READ');
    expect(prisma.cacheEntry.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.cacheEntry.count).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'entry upsert',
      (service: CacheManagementService) =>
        service.set(
          {
            cacheKey: 'evidence-key',
            companyId: 'company-1',
            value: { ready: true },
            expiresAt: '2026-09-01T00:00:00.000Z',
          },
          user,
        ),
    ],
    ['single entry', (service: CacheManagementService) => service.remove('cache-1', user)],
    [
      'company invalidation',
      (service: CacheManagementService) => service.invalidateByCompany('company-1', user),
    ],
    [
      'prefix invalidation',
      (service: CacheManagementService) => service.invalidateByPrefix('report:', groupUser),
    ],
  ])('fails the %s transaction when its mandatory audit append fails', async (_name, invoke) => {
    const { service, auditLogs } = makeHarness();
    const failure = new Error('audit append unavailable');
    auditLogs.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(invoke(service)).rejects.toBe(failure);
  });

  it('denies cache statistics before any query for a company principal', async () => {
    const { service, prisma, companyScope } = makeHarness();
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(new ForbiddenException());

    await expect(service.getStats(user)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.cacheEntry.groupBy).not.toHaveBeenCalled();
    expect(prisma.cacheEntry.count).not.toHaveBeenCalled();
  });
});
