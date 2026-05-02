import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoleScope } from '@prisma/client';
import { UsersService } from './users.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * P0-07 regression — role assignment.
 *
 * The Phase 3 contract: assignRoles replaces the role set, refuses to assign
 * GROUP-scoped roles unless the actor is GROUP-scoped, audits the diff,
 * invalidates the permission cache cluster-wide, and rejects unknown role
 * ids before any mutation.
 */

function actor(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'admin-1',
    email: 'admin@itemba.local',
    roles: ['Group Admin'],
    roleScopes: ['GROUP'],
    permissions: ['users.assign_roles'],
    companyId: null,
    companyAccess: [],
    ...overrides,
  };
}

const TARGET_USER = {
  id: 'user-1',
  email: 'u@itemba.local',
  fullName: 'Test User',
  status: 'ACTIVE',
  companyId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  userRoles: [
    {
      role: { id: 'role-existing', name: 'COMPANY_USER', displayName: 'User', scope: RoleScope.COMPANY },
      assignedAt: new Date(),
      assignedById: null,
    },
  ],
  companyAccess: [],
} as any;

function makeHarness() {
  const userRoleCreateMany = jest.fn().mockResolvedValue({ count: 1 });
  const userRoleDeleteMany = jest.fn().mockResolvedValue({ count: 1 });

  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(TARGET_USER),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    role: { findMany: jest.fn() },
    userCompanyAccess: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (cb: any) => {
      return cb({
        userRole: { createMany: userRoleCreateMany, deleteMany: userRoleDeleteMany },
      });
    }),
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = new CompanyScopeService(prisma);
  const permissionCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateAll: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  } as any;

  const service = new UsersService(prisma, auditLogs, companyScope, permissionCache);
  return { service, prisma, auditLogs, permissionCache, userRoleCreateMany, userRoleDeleteMany };
}

describe('UsersService.assignRoles (P0-07 regression)', () => {
  it('rejects unknown role ids before any mutation', async () => {
    const harness = makeHarness();
    harness.prisma.role.findMany.mockResolvedValue([]); // none of the requested ids exist

    await expect(
      harness.service.assignRoles(
        'user-1',
        { roleIds: ['ghost-role'] },
        actor(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(harness.userRoleCreateMany).not.toHaveBeenCalled();
    expect(harness.userRoleDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects when target user does not exist', async () => {
    const harness = makeHarness();
    harness.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      harness.service.assignRoles('missing', { roleIds: [] }, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses GROUP-scoped role assignment by a non-GROUP-scoped actor', async () => {
    const harness = makeHarness();
    harness.prisma.role.findMany.mockResolvedValue([
      { id: 'role-group', name: 'GROUP_ADMIN', scope: RoleScope.GROUP },
    ]);

    const companyActor = actor({
      roles: ['Company User'],
      roleScopes: ['COMPANY'],
      companyId: 'company-A',
    });

    await expect(
      harness.service.assignRoles(
        'user-1',
        { roleIds: ['role-group'] },
        companyActor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('replaces the role set: removes obsolete + adds new', async () => {
    const harness = makeHarness();
    harness.prisma.role.findMany.mockResolvedValue([
      { id: 'role-new', name: 'COMPANY_MANAGER', scope: RoleScope.COMPANY },
    ]);

    await harness.service.assignRoles(
      'user-1',
      { roleIds: ['role-new'] },
      actor(),
    );

    // Existing role-existing should be deleted, role-new added.
    expect(harness.userRoleDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          roleId: { in: ['role-existing'] },
        }),
      }),
    );
    expect(harness.userRoleCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'user-1', roleId: 'role-new' }),
        ]),
      }),
    );
  });

  it('audits the role-set diff with old/new role ids', async () => {
    const harness = makeHarness();
    harness.prisma.role.findMany.mockResolvedValue([
      { id: 'role-new', name: 'COMPANY_MANAGER', scope: RoleScope.COMPANY },
    ]);

    await harness.service.assignRoles(
      'user-1',
      { roleIds: ['role-new'] },
      actor(),
    );

    expect(harness.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_ROLES_ASSIGNED',
        entityType: 'User',
        entityId: 'user-1',
        oldValue: { roleIds: ['role-existing'] },
        newValue: { roleIds: ['role-new'] },
      }),
    );
  });

  it('invalidates the affected user in the permission cache', async () => {
    const harness = makeHarness();
    harness.prisma.role.findMany.mockResolvedValue([
      { id: 'role-new', name: 'COMPANY_MANAGER', scope: RoleScope.COMPANY },
    ]);

    await harness.service.assignRoles(
      'user-1',
      { roleIds: ['role-new'] },
      actor(),
    );

    expect(harness.permissionCache.invalidate).toHaveBeenCalledWith('user-1');
  });
});
