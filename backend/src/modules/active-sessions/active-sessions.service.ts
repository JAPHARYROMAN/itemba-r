import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService, PermissionCacheService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Active session lifecycle. P1-01: revoke is authoritative — it flips the
 * status, revokes any unrevoked refresh tokens that may belong to the same
 * device, and broadcasts a permission-cache invalidation so every replica
 * drops the affected user from cache. The next request from that device
 * will be rejected by JwtStrategy because the bound ActiveSession is no
 * longer ACTIVE.
 */
@Injectable()
export class ActiveSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly permissionCache: PermissionCacheService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { page = 1, limit = 20, userId, companyId, status, sessionType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = await this.companyScope.companyWhereFor(user, companyId);
    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (sessionType) where.sessionType = sessionType;

    const [data, total] = await Promise.all([
      this.prisma.activeSession.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.activeSession.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findByUser(userId: string, query: any, user: AuthUser) {
    const canManage = user.permissions?.includes('active_sessions.manage') ?? false;
    if (userId !== user.id && !canManage) {
      throw new ForbiddenException('You can only view your own active sessions');
    }

    const { page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any =
      userId === user.id ? { userId } : { userId, ...(await this.sessionScopeWhere(user)) };

    const [data, total] = await Promise.all([
      this.prisma.activeSession.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.activeSession.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user?: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.activeSession.findFirst({
      where: user ? await this.sessionScopeWhere(user, id) : { id },
    });
    if (!record) throw new NotFoundException('Active session not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    }
    return record;
  }

  async create(dto: any, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.MANAGE);
    await this.assertSessionUserBelongsToCompany(dto.userId, dto.companyId);
    const record = await this.prisma.activeSession.create({
      data: {
        sessionCode: 'SS-' + Date.now(),
        userId: dto.userId,
        companyId: dto.companyId,
        deviceId: dto.deviceId,
        sessionType: dto.sessionType ?? 'WEB',
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        deviceSummary: dto.deviceSummary,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : new Date(Date.now() + 86400000),
        status: 'ACTIVE',
      },
    });
    await this.auditLogs.log({
      action: 'SESSION_CREATED',
      entityType: 'ActiveSession',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId ?? undefined,
      severity: AuditSeverity.MEDIUM,
    });
    return record;
  }

  /**
   * Revoke a session. After this call returns, no request bearing a JWT with
   * `sid === <id>` will pass JwtStrategy.validate() — the strategy looks the
   * session up and rejects when status !== ACTIVE.
   */
  async revoke(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.activeSession.update({
        where: { id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokeReason: dto.revokeReason,
        },
      });
      // If we have a deviceId we cannot reliably correlate refresh tokens to
      // this exact session, but we can still revoke any refresh tokens issued
      // from the same device window. Conservative scope: revoke all of this
      // user's unrevoked tokens issued AFTER the session start so we don't
      // accidentally kill an unrelated session.
      await tx.refreshToken.updateMany({
        where: {
          userId: existing.userId,
          revokedAt: null,
          createdAt: { gte: existing.startedAt },
        },
        data: { revokedAt: new Date(), revokedReason: 'SESSION_REVOKED' },
      });
      return updated;
    });

    // Drop the permission cache cluster-wide so JwtStrategy fetches fresh state
    // (and will see status !== ACTIVE on its session lookup).
    await this.permissionCache.invalidate(existing.userId);

    await this.auditLogs.log({
      action: 'SESSION_REVOKED',
      entityType: 'ActiveSession',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as any,
      newValue: record as any,
      severity: AuditSeverity.HIGH,
    });
    return record;
  }

  private async assertSessionUserBelongsToCompany(
    userId: string,
    companyId: string | null | undefined,
  ) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        companyId: true,
        companyAccess: { select: { companyId: true } },
      },
    });
    if (!target) throw new NotFoundException('Session user not found');
    if (!companyId) return;
    const userCompanyIds = new Set([
      target.companyId,
      ...target.companyAccess.map((access) => access.companyId),
    ]);
    if (!userCompanyIds.has(companyId)) {
      throw new BadRequestException('Session user does not belong to this company');
    }
  }

  private async sessionScopeWhere(user: AuthUser, id?: string) {
    const where: any = id ? { id } : {};
    if (this.companyScope.isGroupScoped(user)) {
      const companyIds = await this.companyScope.accessibleCompanyIds(user);
      where.OR = [
        { companyId: null },
        ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
      ];
      return where;
    }
    Object.assign(where, await this.companyScope.companyWhereFor(user));
    return where;
  }
}
