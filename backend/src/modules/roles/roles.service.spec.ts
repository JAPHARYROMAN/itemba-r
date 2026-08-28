import { RoleScope } from '@prisma/client';
import { RolesService } from './roles.service';

/**
 * Fully-mocked unit tests for RolesService cache invalidation.
 *
 * Focus (audit fix): after a role's permission set / scope changes (update) or
 * the role is deleted (remove), the JwtStrategy permission cache must be evicted
 * for every user holding the role, so grants/revocations take effect immediately
 * instead of lagging up to the 60s cache TTL. PermissionsGuard authorizes off
 * that cache, so a stale entry lets a revoked permission keep working.
 */

const GROUP_ADMIN = {
  id: 'actor-group',
  permissions: [],
  roleScopes: [RoleScope.GROUP],
  role: { scope: RoleScope.GROUP },
} as any;

function makeService(opts?: {
  currentScope?: RoleScope;
  holders?: string[];
  isSystem?: boolean;
  userRoleCount?: number;
  permissions?: Array<{ code: string; isGroupControl: boolean }>;
  existingPermissionIds?: string[];
}) {
  const currentScope = opts?.currentScope ?? RoleScope.COMPANY;
  const holders = opts?.holders ?? ['user-a', 'user-b'];

  const prisma = {
    role: {
      create: jest.fn(async () => ({ id: 'role-1', scope: currentScope })),
      findUniqueOrThrow: jest.fn(async () => ({
        scope: currentScope,
        name: 'Cashier',
        isSystem: opts?.isSystem ?? false,
        _count: { userRoles: opts?.userRoleCount ?? 0 },
      })),
      update: jest.fn(async () => ({ id: 'role-1', scope: currentScope })),
      delete: jest.fn(async () => ({ id: 'role-1' })),
    },
    permission: { findMany: jest.fn(async () => opts?.permissions ?? []) },
    rolePermission: {
      findMany: jest.fn(async () =>
        (opts?.existingPermissionIds ?? []).map((permissionId) => ({ permissionId })),
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    userRole: {
      findMany: jest.fn(async () => holders.map((userId) => ({ userId }))),
    },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        rolePermission: prisma.rolePermission,
        role: prisma.role,
      }),
    ),
  } as any;

  const permissionCache = {
    invalidate: jest.fn(async () => undefined),
    invalidateAll: jest.fn(async () => undefined),
  } as any;

  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new RolesService(prisma, permissionCache, audit as any);
  return { service, prisma, permissionCache, audit };
}

describe('RolesService — permission cache invalidation', () => {
  it('rejects attaching a group-control permission to a COMPANY role before create', async () => {
    const { service, prisma, audit } = makeService({
      permissions: [{ code: 'fixed-assets.update', isGroupControl: true }],
    });

    await expect(
      service.create(
        {
          name: 'company-asset-admin',
          displayName: 'Company asset admin',
          scope: RoleScope.COMPANY,
          permissionIds: ['permission-fixed-assets-update'],
        },
        GROUP_ADMIN,
      ),
    ).rejects.toThrow('Group-control permissions require a GROUP-scoped role: fixed-assets.update');

    expect(prisma.role.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects replacing a COMPANY role grant set with a group-control permission', async () => {
    const { service, prisma, permissionCache, audit } = makeService({
      permissions: [{ code: 'fixed-assets.update', isGroupControl: true }],
    });

    await expect(
      service.update('role-1', { permissionIds: ['permission-fixed-assets-update'] }, GROUP_ADMIN),
    ).rejects.toThrow('Group-control permissions require a GROUP-scoped role: fixed-assets.update');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(permissionCache.invalidate).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects downgrading a GROUP role while retaining a group-control permission', async () => {
    const { service, prisma, permissionCache, audit } = makeService({
      currentScope: RoleScope.GROUP,
      existingPermissionIds: ['permission-fixed-assets-update'],
      permissions: [{ code: 'fixed-assets.update', isGroupControl: true }],
    });

    await expect(
      service.update('role-1', { scope: RoleScope.COMPANY }, GROUP_ADMIN),
    ).rejects.toThrow('Group-control permissions require a GROUP-scoped role: fixed-assets.update');

    expect(prisma.rolePermission.findMany).toHaveBeenCalledWith({
      where: { roleId: 'role-1' },
      select: { permissionId: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(permissionCache.invalidate).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('still allows a GROUP administrator to attach group-control permissions to a GROUP role', async () => {
    const { service, prisma, audit } = makeService({
      currentScope: RoleScope.GROUP,
      permissions: [{ code: 'fixed-assets.update', isGroupControl: true }],
    });

    await service.update(
      'role-1',
      { permissionIds: ['permission-fixed-assets-update'] },
      GROUP_ADMIN,
    );

    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        {
          roleId: 'role-1',
          permissionId: 'permission-fixed-assets-update',
        },
      ],
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('create() appends exactly one attributable audit row', async () => {
    const { service, audit } = makeService();

    await service.create(
      { name: 'cashier', displayName: 'Cashier', scope: RoleScope.COMPANY },
      GROUP_ADMIN,
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ROLE_CREATE',
        entityType: 'Role',
        entityId: 'role-1',
        userId: GROUP_ADMIN.id,
        companyId: null,
      }),
    );
  });

  it('update() evicts the cache for every distinct user holding the role', async () => {
    const { service, prisma, permissionCache, audit } = makeService({
      holders: ['user-a', 'user-b', 'user-a'], // duplicate to prove de-dup
    });

    await service.update('role-1', { permissionIds: ['perm-1'] } as any, GROUP_ADMIN);

    expect(prisma.userRole.findMany).toHaveBeenCalledWith({
      where: { roleId: 'role-1' },
      select: { userId: true },
    });
    expect(permissionCache.invalidate).toHaveBeenCalledTimes(2);
    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-a');
    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-b');
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ROLE_UPDATE',
        entityType: 'Role',
        entityId: 'role-1',
        userId: GROUP_ADMIN.id,
        companyId: null,
      }),
    );
  });

  it('update() invalidates even when only metadata/scope changes (no permissionIds)', async () => {
    const { service, permissionCache } = makeService({ holders: ['user-a'] });

    await service.update('role-1', { displayName: 'Renamed' } as any, GROUP_ADMIN);

    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-a');
  });

  it('update() with no holders performs no invalidation', async () => {
    const { service, permissionCache } = makeService({ holders: [] });

    await service.update('role-1', { permissionIds: [] } as any, GROUP_ADMIN);

    expect(permissionCache.invalidate).not.toHaveBeenCalled();
  });

  it('remove() invalidates the cache after deleting the role', async () => {
    const { service, prisma, audit } = makeService({
      userRoleCount: 0,
      holders: [],
    });

    await service.remove('role-1', GROUP_ADMIN);

    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    // No holders once the cascade runs, but the invalidation path is exercised.
    expect(prisma.userRole.findMany).toHaveBeenCalledWith({
      where: { roleId: 'role-1' },
      select: { userId: true },
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ROLE_DELETE',
        entityType: 'Role',
        entityId: 'role-1',
        userId: GROUP_ADMIN.id,
        companyId: null,
      }),
    );
  });

  it('remove() captures holders BEFORE the cascading delete and invalidates them', async () => {
    // Regression: UserRole.role is onDelete:Cascade, so holders must be read
    // before role.delete() — a post-delete findMany would return zero rows and
    // evict nothing, leaving stale permissions cached up to the TTL.
    const { service, prisma, permissionCache } = makeService({
      userRoleCount: 0,
      holders: ['user-a', 'user-b', 'user-a'], // duplicate proves de-dup
    });

    const callOrder: string[] = [];
    prisma.userRole.findMany.mockImplementation(async () => {
      callOrder.push('findMany');
      return [{ userId: 'user-a' }, { userId: 'user-b' }, { userId: 'user-a' }];
    });
    prisma.role.delete.mockImplementation(async () => {
      callOrder.push('delete');
      return { id: 'role-1' };
    });

    await service.remove('role-1');

    // Holders were read before the cascading delete.
    expect(callOrder).toEqual(['findMany', 'delete']);
    // Each distinct captured holder had its cache evicted (de-duped).
    expect(permissionCache.invalidate).toHaveBeenCalledTimes(2);
    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-a');
    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-b');
  });
});
