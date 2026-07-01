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
}) {
  const currentScope = opts?.currentScope ?? RoleScope.COMPANY;
  const holders = opts?.holders ?? ['user-a', 'user-b'];

  const prisma = {
    role: {
      findUniqueOrThrow: jest.fn(async () => ({
        scope: currentScope,
        name: 'Cashier',
        isSystem: opts?.isSystem ?? false,
        _count: { userRoles: opts?.userRoleCount ?? 0 },
      })),
      update: jest.fn(async () => ({ id: 'role-1', scope: currentScope })),
      delete: jest.fn(async () => ({ id: 'role-1' })),
    },
    permission: { findMany: jest.fn(async () => []) },
    rolePermission: {
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

  const service = new RolesService(prisma, permissionCache);
  return { service, prisma, permissionCache };
}

describe('RolesService — permission cache invalidation', () => {
  it('update() evicts the cache for every distinct user holding the role', async () => {
    const { service, prisma, permissionCache } = makeService({
      holders: ['user-a', 'user-b', 'user-a'], // duplicate to prove de-dup
    });

    await service.update(
      'role-1',
      { permissionIds: ['perm-1'] } as any,
      GROUP_ADMIN,
    );

    expect(prisma.userRole.findMany).toHaveBeenCalledWith({
      where: { roleId: 'role-1' },
      select: { userId: true },
    });
    expect(permissionCache.invalidate).toHaveBeenCalledTimes(2);
    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-a');
    expect(permissionCache.invalidate).toHaveBeenCalledWith('user-b');
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
    const { service, prisma, permissionCache } = makeService({
      userRoleCount: 0,
      holders: [],
    });

    await service.remove('role-1');

    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    // No holders once the cascade runs, but the invalidation path is exercised.
    expect(prisma.userRole.findMany).toHaveBeenCalledWith({
      where: { roleId: 'role-1' },
      select: { userId: true },
    });
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
