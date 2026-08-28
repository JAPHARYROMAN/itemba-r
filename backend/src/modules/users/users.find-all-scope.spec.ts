import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

describe('UsersService.findAll company projection', () => {
  function makeService() {
    const findMany = jest.fn().mockResolvedValue([]);
    const companyScope = {
      accessibleCompanyIds: jest.fn().mockResolvedValue(['company-a']),
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      isGroupScoped: jest.fn().mockReturnValue(true),
    };
    const service = new UsersService(
      { user: { findMany } } as never,
      {} as never,
      companyScope as never,
      {} as never,
    );
    const actor = {
      id: 'group-user',
      companyId: 'company-a',
      roleScopes: ['GROUP'],
    } as AuthUser;
    return { actor, companyScope, findMany, service };
  }

  it('filters nested company-access grants to an explicitly requested company', async () => {
    const { actor, companyScope, findMany, service } = makeService();
    await service.findAll(actor, { companyId: 'company-a' });

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(actor, 'company-a');
    expect(findMany.mock.calls[0][0].select.companyAccess.where).toEqual({
      companyId: { in: ['company-a'] },
    });
  });

  it('preserves full group oversight when no company filter is requested', async () => {
    const { actor, companyScope, findMany, service } = makeService();
    await service.findAll(actor, {});

    expect(companyScope.accessibleCompanyIds).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].select.companyAccess.where).toBeUndefined();
  });

  it('redacts a foreign primary tenant when the row matched through an in-scope grant', async () => {
    const { actor, findMany, service } = makeService();
    findMany.mockResolvedValue([
      {
        id: 'shared-user',
        companyId: 'company-b',
        userRoles: [{ role: { id: 'foreign-role' }, assignedById: 'foreign-admin' }],
        companyAccess: [{ companyId: 'company-a', accessLevel: 'READ' }],
      },
    ]);

    await expect(service.findAll(actor, { companyId: 'company-a' })).resolves.toEqual([
      expect.objectContaining({
        id: 'shared-user',
        companyId: null,
        userRoles: [],
        primaryCompanyRestricted: true,
        companyAccess: [{ companyId: 'company-a', accessLevel: 'READ' }],
      }),
    ]);
  });
});
