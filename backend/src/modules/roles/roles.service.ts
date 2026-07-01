import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { RoleScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { isGroupScopedUser } from '../../common/services/company-scope.service';
import { PermissionCacheService } from '../../common/services';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  /**
   * Evict the JwtStrategy permission cache for every user holding this role.
   *
   * PermissionsGuard authorizes off the cached, role-derived permission set
   * (TTL 60s). When a role's permission set, scope, or existence changes, the
   * effective permissions of every user holding it change too, so their cache
   * entries must be dropped immediately — otherwise a revoked permission stays
   * usable (and a newly-granted one stays unavailable) for up to the TTL.
   * Mirrors the invalidation UsersService performs on role/access changes.
   */
  private async invalidateCacheForRole(roleId: string): Promise<void> {
    const holders = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    await this.invalidateCacheForUsers(holders.map((h) => h.userId));
  }

  /** Evict the JwtStrategy permission cache for a set of user ids (de-duped). */
  private async invalidateCacheForUsers(userIds: string[]): Promise<void> {
    const distinct = [...new Set(userIds)];
    await Promise.all(distinct.map((userId) => this.permissionCache.invalidate(userId)));
  }

  /**
   * Authority guard for role mutations (ITMB-039) — prevents a delegated
   * role-admin from escalating privilege:
   *  - Only a GROUP-scoped actor may create or keep a GROUP-scoped role.
   *  - An actor may only grant permission codes they themselves already hold;
   *    a GROUP-scoped actor (group control layer) is exempt and may grant any
   *    permission.
   * `effectiveScope` is the scope the role will carry after the mutation;
   * `permissionIds` is the requested permission set (undefined when not editing
   * the permission set).
   */
  private async assertRoleMutationAllowed(
    user: AuthUser | undefined,
    effectiveScope: RoleScope | undefined,
    permissionIds: string[] | undefined,
  ): Promise<void> {
    if (!user) {
      throw new ForbiddenException('Authenticated user required to manage roles');
    }

    const actorIsGroup = isGroupScopedUser(user);

    if (effectiveScope === RoleScope.GROUP && !actorIsGroup) {
      throw new ForbiddenException(
        'Only group-scoped administrators can manage group-scoped roles',
      );
    }

    // A group-scoped actor (group control layer) may assign any permission.
    if (actorIsGroup) {
      return;
    }

    if (!permissionIds || permissionIds.length === 0) {
      return;
    }

    // The actor may only grant permissions they currently possess.
    const actorPerms = new Set(user.permissions ?? []);
    const requested = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { code: true },
    });
    for (const perm of requested) {
      if (!actorPerms.has(perm.code)) {
        throw new ForbiddenException(
          `Cannot grant a permission you do not hold: ${perm.code}`,
        );
      }
    }
  }

  /**
   * List all roles with their permissions and per-role counts the UI uses to
   * render assignment summaries (how many users currently hold the role and
   * how many permissions the role grants).
   */
  findAll() {
    return this.prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true, rolePermissions: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true, rolePermissions: true } },
      },
    });
  }

  async create(dto: CreateRoleDto, user?: AuthUser) {
    await this.assertRoleMutationAllowed(user, dto.scope, dto.permissionIds);
    return this.prisma.role.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        scope: dto.scope,
        rolePermissions: dto.permissionIds
          ? { create: dto.permissionIds.map((pid) => ({ permissionId: pid })) }
          : undefined,
      },
    });
  }

  /**
   * Update role metadata and (optionally) replace its permission set.
   * Replacement is wrapped in a single transaction so a partial failure
   * doesn't leave the role with half-applied permissions.
   */
  async update(id: string, dto: UpdateRoleDto, user?: AuthUser) {
    // Authorize against the effective scope (requested scope if changing,
    // otherwise the role's current scope) so a non-group actor cannot edit a
    // group-scoped role's permission set either.
    const current = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      select: { scope: true },
    });
    const effectiveScope = dto.scope ?? current.scope;
    await this.assertRoleMutationAllowed(user, effectiveScope, dto.permissionIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (dto.permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: dto.permissionIds.map((pid) => ({ roleId: id, permissionId: pid })),
          });
        }
      }
      return tx.role.update({
        where: { id },
        data: {
          name: dto.name,
          displayName: dto.displayName,
          description: dto.description,
          scope: dto.scope,
        },
      });
    });

    // The role's effective permission set / scope may have changed; drop the
    // cached permissions of every user holding it so the change takes effect
    // immediately instead of lagging up to the cache TTL.
    await this.invalidateCacheForRole(id);

    return updated;
  }

  /**
   * Delete a role. Refuses on:
   *  - System roles (`isSystem: true`) — seeded baseline roles must never be
   *    removed via the API.
   *  - Roles still assigned to users — Prisma would Cascade-remove the
   *    UserRole rows and silently strip people of access. Force the caller to
   *    reassign first.
   */
  async remove(id: string) {
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { userRoles: true } } },
    });
    if (role.isSystem) {
      throw new BadRequestException(
        `Role "${role.name}" is a system role and cannot be deleted.`,
      );
    }
    if (role._count.userRoles > 0) {
      throw new BadRequestException(
        `Role "${role.name}" is still assigned to ${role._count.userRoles} user(s). Reassign them before deleting.`,
      );
    }
    // Capture any current holders BEFORE the delete: UserRole.role is
    // onDelete:Cascade, so once role.delete() runs the join rows are gone and a
    // post-delete userRole.findMany would evict nothing. In practice the guard
    // above means there are none, but reading holders first keeps this race-safe
    // and correct. Invalidate the captured holders after the delete commits so
    // any lingering cached permissions are dropped immediately.
    const holders = await this.prisma.userRole.findMany({
      where: { roleId: id },
      select: { userId: true },
    });
    const deleted = await this.prisma.role.delete({ where: { id } });
    await this.invalidateCacheForUsers(holders.map((h) => h.userId));
    return deleted;
  }
}
