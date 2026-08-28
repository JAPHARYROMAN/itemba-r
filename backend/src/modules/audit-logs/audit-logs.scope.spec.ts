import { AuditLogsService } from './audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditAttributionStatus, AuditScopeKind } from '@prisma/client';

describe('AuditLogsService group-level autonomous visibility', () => {
  const groupUser = {
    id: 'oversight-1',
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-2', accessLevel: 'READ' }],
    roleScopes: ['GROUP'],
    permissions: ['audit.read', 'msaidizi.oversight'],
  } as AuthUser;

  function makeService() {
    const auditLog = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'audit-1',
        companyId: null,
        scopeKind: AuditScopeKind.COMPANY,
        attributionStatus: AuditAttributionStatus.RESOLVED,
        companyScopes: [{ companyId: 'company-1' }],
      }),
    };
    return { service: new AuditLogsService({ auditLog } as never), auditLog };
  }

  function expectGroupScope(where: unknown) {
    expect(where).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { scopeKind: { in: [AuditScopeKind.GROUP, AuditScopeKind.GLOBAL] } },
          {
            scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
            companyScopes: { some: {} },
          },
        ]),
      }),
    );
  }

  it('includes global rows in every group oversight projection', async () => {
    const { service, auditLog } = makeService();

    await service.findAll({}, groupUser);
    await service.findByEntity('MsaidiziTask', 'task-1', groupUser);
    await service.findByUser('user-1', {}, groupUser);
    await service.findSensitive(10, groupUser);
    await service.getSummary(undefined, undefined, groupUser);
    await service.getEntityTypes(groupUser);

    for (const call of auditLog.findMany.mock.calls) expectGroupScope(call[0].where);
    for (const call of auditLog.count.mock.calls) expectGroupScope(call[0].where);
    for (const call of auditLog.groupBy.mock.calls) expectGroupScope(call[0].where);
  });

  it('does not expose global rows after group scope is revoked', async () => {
    const { service, auditLog } = makeService();
    await service.findAll({}, { ...groupUser, roleScopes: ['COMPANY'], companyAccess: [] });

    expect(auditLog.findMany.mock.calls[0][0].where).toEqual({
      scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
      companyScopes: { some: { companyId: { in: ['company-1'] } } },
    });
  });

  it('keeps group visibility separate from free-text search', async () => {
    const { service, auditLog } = makeService();
    await service.findAll({ search: 'task-1' }, groupUser);

    const where = auditLog.findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    expectGroupScope(where.AND[0]);
    expect(where.AND[1]).toEqual(expect.objectContaining({ OR: expect.any(Array) }));
  });

  it('lets a company user see a multi-company row through any accessible snapshot only', async () => {
    const { service, auditLog } = makeService();
    await service.findAll({}, { ...groupUser, roleScopes: ['COMPANY'], companyId: 'company-1' });

    expect(auditLog.findMany.mock.calls[0][0].where).toEqual({
      scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
      companyScopes: {
        some: { companyId: { in: ['company-1', 'company-2'] } },
      },
    });
  });

  it('filters a requested company by its immutable snapshot and excludes global/group rows', async () => {
    const { service, auditLog } = makeService();
    await service.findAll({ companyId: 'company-2' }, groupUser);

    expect(auditLog.findMany.mock.calls[0][0].where).toEqual({
      scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
      companyScopes: { some: { companyId: 'company-2' } },
    });
  });

  it('authorizes findOne from immutable scope after the compatibility FK was set null', async () => {
    const { service, auditLog } = makeService();
    const companyUser = { ...groupUser, roleScopes: ['COMPANY'], companyAccess: [] };

    await expect(service.findOne('audit-1', companyUser)).resolves.toEqual(
      expect.objectContaining({ companyId: null, companyScopes: [{ companyId: 'company-1' }] }),
    );
    expect(auditLog.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'audit-1',
          AND: [
            {
              scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
              companyScopes: { some: { companyId: { in: ['company-1'] } } },
            },
          ],
        },
        include: expect.objectContaining({
          companyScopes: { select: { companyId: true } },
        }),
      }),
    );
  });

  it('returns an attributed task-attempt row through its immutable company snapshot', async () => {
    const { service, auditLog } = makeService();
    auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-attempt-1',
        taskId: 'task-1',
        scopeKind: AuditScopeKind.COMPANY,
        companyScopes: [{ companyId: 'company-1' }],
      },
    ]);
    const companyUser = { ...groupUser, roleScopes: ['COMPANY'], companyAccess: [] };

    const result = await service.findAll({ taskId: 'task-1' }, companyUser);

    expect(result.data).toEqual([expect.objectContaining({ id: 'audit-attempt-1' })]);
    expect(auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task-1',
          scopeKind: { in: [AuditScopeKind.COMPANY, AuditScopeKind.MULTI_COMPANY] },
          companyScopes: { some: { companyId: { in: ['company-1'] } } },
        },
      }),
    );
  });
});
