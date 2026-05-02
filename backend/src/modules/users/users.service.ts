import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AccessLevel, AuditSeverity, RoleScope, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService, PermissionCacheService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { GrantCompanyAccessDto } from './dto/grant-company-access.dto';

const SAFE_USER = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const USER_WITH_ROLES = {
  ...SAFE_USER,
  userRoles: {
    select: {
      role: { select: { id: true, name: true, displayName: true, scope: true } },
      assignedAt: true,
      assignedById: true,
    },
  },
  companyAccess: {
    select: { companyId: true, accessLevel: true },
  },
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  // ─── Read ──────────────────────────────────────────────────────────────

  async findAll(actor: AuthUser, query: any = {}) {
    const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(actor);
    return this.prisma.user.findMany({
      where: await this.userWhereFor(actor, query.companyId),
      select: this.userSelect(accessibleCompanyIds),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actor?: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const user = await this.findUserRaw(id);
    if (actor) {
      await this.assertCanAccessUser(actor, user, minimumAccess);
      return this.sanitizeUserForActor(user, actor);
    }
    return user;
  }

  /** Internal lookup — does not skip soft-deleted users. */
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  // ─── Create / Update / Soft-delete ────────────────────────────────────

  async create(dto: CreateUserDto, actor: AuthUser) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with that email already exists');

    if (dto.companyId) {
      await this.companyScope.assertCanAccessCompany(actor, dto.companyId, AccessLevel.MANAGE);
    } else {
      this.companyScope.assertGroupScoped(actor, 'create group-level users');
    }

    if (dto.roleIds?.length) {
      await this.assertRolesAssignable(actor, dto.roleIds);
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          companyId: dto.companyId,
        },
        select: SAFE_USER,
      });
      if (dto.roleIds?.length) {
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            userId: created.id,
            roleId,
            assignedById: actor.id,
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await this.auditLogs.log({
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      userId: actor.id,
      companyId: user.companyId ?? undefined,
      newValue: { ...user, roleIds: dto.roleIds ?? [] } as any,
      severity: AuditSeverity.MEDIUM,
    });

    if (dto.roleIds?.length) {
      await this.permissionCache.invalidate(user.id);
    }

    return this.findById(user.id);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    const existing = await this.findUserRaw(id);
    await this.assertCanAccessUser(actor, existing, AccessLevel.MANAGE);

    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      // Moving a user between companies requires write access on BOTH.
      if (existing.companyId) {
        await this.companyScope.assertCanAccessCompany(
          actor,
          existing.companyId,
          AccessLevel.MANAGE,
        );
      }
      if (dto.companyId) {
        await this.companyScope.assertCanAccessCompany(actor, dto.companyId, AccessLevel.MANAGE);
      } else {
        this.companyScope.assertGroupScoped(actor, 'move users to group-level scope');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.companyId !== undefined) data.companyId = dto.companyId || null;
    if (dto.password) data.passwordHash = await argon2.hash(dto.password);

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_USER,
    });

    await this.auditLogs.log({
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: id,
      userId: actor.id,
      companyId: updated.companyId ?? undefined,
      oldValue: {
        fullName: existing.fullName,
        status: existing.status,
        companyId: existing.companyId,
      } as any,
      newValue: {
        fullName: updated.fullName,
        status: updated.status,
        companyId: updated.companyId,
      } as any,
      severity: dto.password ? AuditSeverity.HIGH : AuditSeverity.MEDIUM,
    });

    // Status change or password reset must propagate: a disabled or rotated
    // user should not retain cached permissions on any replica.
    if (dto.status !== undefined || dto.password) {
      await this.permissionCache.invalidate(id);
    }

    return this.findById(id, actor);
  }

  /**
   * Soft-delete (status -> INACTIVE, deletedAt set, refresh tokens revoked).
   * Hard-delete is reserved for explicit maintenance and is NOT exposed here.
   */
  async remove(id: string, actor: AuthUser) {
    const existing = await this.findUserRaw(id);
    await this.assertCanAccessUser(actor, existing, AccessLevel.MANAGE);
    if (existing.id === actor.id) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: UserStatus.INACTIVE,
        },
      });
      // Revoke all live refresh tokens — a deactivated user must lose access
      // immediately, not at next access-token expiry.
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'USER_DEACTIVATED' },
      });
    });

    await this.auditLogs.log({
      action: 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: id,
      userId: actor.id,
      companyId: existing.companyId ?? undefined,
      oldValue: { status: existing.status } as any,
      newValue: { status: UserStatus.INACTIVE, deletedAt: new Date() } as any,
      severity: AuditSeverity.HIGH,
    });

    await this.permissionCache.invalidate(id);

    return { id, status: UserStatus.INACTIVE };
  }

  // ─── Role Assignment ───────────────────────────────────────────────────

  /**
   * Replace the user's role assignment with the supplied set. Returns the
   * user with the new role list. All mutations are audited and the
   * permission cache is invalidated cluster-wide.
   */
  async assignRoles(userId: string, dto: AssignRolesDto, actor: AuthUser) {
    const user = await this.findUserRaw(userId);

    await this.assertRolesAssignable(actor, dto.roleIds);
    await this.assertCanAccessUser(actor, user, AccessLevel.MANAGE);

    const previousRoleIds = user.userRoles.map((ur) => ur.role.id);
    const targetRoleIds = Array.from(new Set(dto.roleIds));

    await this.prisma.$transaction(async (tx) => {
      const toRemove = previousRoleIds.filter((id) => !targetRoleIds.includes(id));
      const toAdd = targetRoleIds.filter((id) => !previousRoleIds.includes(id));

      if (toRemove.length) {
        await tx.userRole.deleteMany({
          where: { userId, roleId: { in: toRemove } },
        });
      }
      if (toAdd.length) {
        await tx.userRole.createMany({
          data: toAdd.map((roleId) => ({ userId, roleId, assignedById: actor.id })),
          skipDuplicates: true,
        });
      }
    });

    await this.auditLogs.log({
      action: 'USER_ROLES_ASSIGNED',
      entityType: 'User',
      entityId: userId,
      userId: actor.id,
      companyId: user.companyId ?? undefined,
      oldValue: { roleIds: previousRoleIds } as any,
      newValue: { roleIds: targetRoleIds } as any,
      severity: AuditSeverity.HIGH,
    });

    await this.permissionCache.invalidate(userId);

    return this.findById(userId, actor);
  }

  /**
   * Replace the user's company-access set. Companies the actor cannot manage
   * are rejected before any mutation runs.
   */
  async grantCompanyAccess(userId: string, dto: GrantCompanyAccessDto, actor: AuthUser) {
    const user = await this.findUserRaw(userId);
    await this.assertCanAccessUser(actor, user, AccessLevel.MANAGE);

    // The actor must be able to manage every target company.
    for (const grant of dto.access) {
      await this.companyScope.assertCanAccessCompany(actor, grant.companyId, AccessLevel.MANAGE);
    }
    // And every previously-granted company that we are about to remove or
    // change — otherwise a company-A admin could unset a user's access to
    // company B.
    for (const existing of user.companyAccess) {
      await this.companyScope.assertCanAccessCompany(actor, existing.companyId, AccessLevel.MANAGE);
    }

    const previous = user.companyAccess.map((c) => ({
      companyId: c.companyId,
      accessLevel: c.accessLevel,
    }));

    await this.prisma.$transaction(async (tx) => {
      await tx.userCompanyAccess.deleteMany({ where: { userId } });
      if (dto.access.length) {
        await tx.userCompanyAccess.createMany({
          data: dto.access.map((g) => ({
            userId,
            companyId: g.companyId,
            accessLevel: g.accessLevel,
            grantedById: actor.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    await this.auditLogs.log({
      action: 'USER_COMPANY_ACCESS_GRANTED',
      entityType: 'User',
      entityId: userId,
      userId: actor.id,
      oldValue: { access: previous } as any,
      newValue: { access: dto.access } as any,
      severity: AuditSeverity.HIGH,
    });

    await this.permissionCache.invalidate(userId);

    return this.findById(userId, actor);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  private async findUserRaw(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_WITH_ROLES,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private userSelect(accessibleCompanyIds: string[] | null) {
    return {
      ...SAFE_USER,
      userRoles: {
        select: {
          role: { select: { id: true, name: true, displayName: true, scope: true } },
          assignedAt: true,
          assignedById: true,
        },
      },
      companyAccess: {
        ...(accessibleCompanyIds && { where: { companyId: { in: accessibleCompanyIds } } }),
        select: { companyId: true, accessLevel: true },
      },
    };
  }

  private async userWhereFor(actor: AuthUser, requestedCompanyId?: string | null) {
    const where: any = { deletedAt: null };
    const companyMatch = (companyIds: string[]) => ({
      OR: [
        { companyId: { in: companyIds } },
        { companyAccess: { some: { companyId: { in: companyIds } } } },
      ],
    });

    if (requestedCompanyId) {
      await this.companyScope.assertCanAccessCompany(actor, requestedCompanyId);
      Object.assign(where, companyMatch([requestedCompanyId]));
      return where;
    }

    if (this.companyScope.isGroupScoped(actor)) {
      return where;
    }

    const companyIds = await this.companyScope.accessibleCompanyIds(actor);
    if (!companyIds?.length) {
      return { ...where, id: { in: [] } };
    }
    Object.assign(where, companyMatch(companyIds));
    return where;
  }

  private async assertCanAccessUser(
    actor: AuthUser,
    user: Awaited<ReturnType<UsersService['findUserRaw']>>,
    minimum: AccessLevel,
  ) {
    if (this.companyScope.isGroupScoped(actor)) return;

    const relatedCompanyIds = new Set<string>();
    if (user.companyId) relatedCompanyIds.add(user.companyId);
    for (const access of user.companyAccess ?? []) {
      relatedCompanyIds.add(access.companyId);
    }

    if (relatedCompanyIds.size === 0) {
      this.companyScope.assertGroupScoped(actor, 'access group-level users');
      return;
    }

    if (minimum === AccessLevel.READ) {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(actor);
      if (accessibleCompanyIds?.some((companyId) => relatedCompanyIds.has(companyId))) {
        return;
      }
      throw new ForbiddenException('You do not have access to this user');
    }

    for (const companyId of relatedCompanyIds) {
      await this.companyScope.assertCanAccessCompany(actor, companyId, minimum);
    }
  }

  private async sanitizeUserForActor(
    user: Awaited<ReturnType<UsersService['findUserRaw']>>,
    actor: AuthUser,
  ) {
    if (this.companyScope.isGroupScoped(actor)) return user;
    const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(actor);
    const allowed = new Set(accessibleCompanyIds ?? []);
    return {
      ...user,
      companyAccess: user.companyAccess.filter((access) => allowed.has(access.companyId)),
    };
  }

  /**
   * Verify that every role in the supplied list exists, is assignable by the
   * actor (group-scoped roles require an actor with GROUP scope), and refers
   * to a known role row.
   */
  private async assertRolesAssignable(actor: AuthUser, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true, scope: true },
    });
    if (roles.length !== roleIds.length) {
      const missing = roleIds.filter((id) => !roles.find((r) => r.id === id));
      throw new BadRequestException(`Unknown role id(s): ${missing.join(', ')}`);
    }
    const actorIsGroup = (actor.roleScopes ?? []).includes('GROUP');
    const groupRoles = roles.filter((r) => r.scope === RoleScope.GROUP);
    if (groupRoles.length > 0 && !actorIsGroup) {
      throw new ForbiddenException(
        `Group-scoped roles can only be assigned by users holding a GROUP-scoped role. ` +
          `Blocked roles: ${groupRoles.map((r) => r.name).join(', ')}`,
      );
    }
  }
}
