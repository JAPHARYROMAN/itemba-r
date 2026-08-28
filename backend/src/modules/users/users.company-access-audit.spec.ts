import { AccessLevel, AuditScopeKind } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService.grantCompanyAccess audit scope', () => {
  it('attributes a one-company replacement to the exact affected company', async () => {
    const target = {
      id: 'target-user',
      companyId: 'company-a',
      userRoles: [],
      companyAccess: [],
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(target) },
      $transaction: jest.fn(async (callback: any) =>
        callback({
          userCompanyAccess: {
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        }),
      ),
    } as any;
    const auditLogs = { log: jest.fn() } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      accessibleCompanyIds: jest.fn().mockResolvedValue(null),
      isGroupScoped: jest.fn().mockReturnValue(true),
    } as any;
    const service = new UsersService(prisma, auditLogs, companyScope, {
      invalidate: jest.fn(),
    } as any);
    jest.spyOn(service as any, 'assertCanAccessUser').mockResolvedValue(undefined);
    jest.spyOn(service, 'findById').mockResolvedValue(target as any);

    await service.grantCompanyAccess(
      target.id,
      { access: [{ companyId: 'company-b', accessLevel: AccessLevel.MANAGE }] },
      { id: 'actor', roleScopes: ['GROUP'] } as any,
    );

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_COMPANY_ACCESS_GRANTED',
        entityId: target.id,
        userId: 'actor',
        companyId: 'company-b',
        scopeKind: AuditScopeKind.COMPANY,
        companyScopeIds: ['company-b'],
      }),
    );
  });
});
