import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActiveSessionStatus,
  SecurityEventSeverity,
  SecurityEventStatus,
  SecurityEventType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { assertCanAccessCompanyFromUser } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type SecurityReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface SecurityReadinessCheck {
  key: string;
  title: string;
  status: SecurityReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string | boolean>;
}

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  async getDashboard(user: AuthUser) {
    assertCanAccessCompanyFromUser(user, null);
    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      eventsBySeverity,
      activeSessionsCount,
      lockedAccountsCount,
      failedLoginsCount,
      twoFactorStats,
      recentCriticalEvents,
    ] = await Promise.all([
      this.prisma.securityEvent.groupBy({
        by: ['severity'],
        where: { createdAt: { gte: last30Days } },
        _count: { id: true },
      }),
      this.prisma.activeSession.count({ where: { status: 'ACTIVE' } }),
      this.prisma.userSecurityProfile.count({ where: { lockedUntil: { gt: now } } }),
      this.prisma.securityEvent.count({
        where: { createdAt: { gte: last24h }, severity: { in: ['HIGH', 'CRITICAL'] as any } },
      }),
      this.prisma.userSecurityProfile.groupBy({
        by: ['twoFactorEnabled'],
        _count: { id: true },
      }),
      this.prisma.securityEvent.findMany({
        where: { severity: { in: ['CRITICAL', 'HIGH'] as any }, createdAt: { gte: last30Days } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const totalUsers = twoFactorStats.reduce((s, r) => s + r._count.id, 0);
    const twoFactorEnabled = twoFactorStats.find((r) => r.twoFactorEnabled)?._count.id ?? 0;
    const twoFactorAdoptionRate =
      totalUsers > 0 ? Math.round((twoFactorEnabled / totalUsers) * 100) : 0;

    return {
      eventsBySeverity,
      activeSessionsCount,
      lockedAccountsCount,
      failedLoginsLast24h: failedLoginsCount,
      twoFactorAdoptionRate,
      recentCriticalEvents,
      readiness: await this.getReadiness(user),
    };
  }

  async getSummary(user: AuthUser) {
    assertCanAccessCompanyFromUser(user, null);
    const now = new Date();

    const [activeSessionsCount, lockedAccountsCount, openEventsCount] = await Promise.all([
      this.prisma.activeSession.count({ where: { status: 'ACTIVE' } }),
      this.prisma.userSecurityProfile.count({ where: { lockedUntil: { gt: now } } }),
      this.prisma.securityEvent.count({ where: { status: 'OPEN' } }),
    ]);

    return { activeSessionsCount, lockedAccountsCount, openEventsCount };
  }

  async getReadiness(user: AuthUser) {
    assertCanAccessCompanyFromUser(user, null);
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', 'never').trim();
    const accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m').trim();
    const refreshSecretConfigured = Boolean(this.config.get<string>('JWT_REFRESH_SECRET'));
    const accessSecretConfigured = Boolean(this.config.get<string>('JWT_ACCESS_SECRET'));
    const refreshDurationMs = this.parseDuration(refreshExpiresIn);

    const [
      activeUsers,
      usersWithSecurityProfiles,
      twoFactorEnabledUsers,
      forceTwoFactorUsers,
      lockedAccounts,
      activeSessions,
      expiredActiveSessions,
      revokedSessions24h,
      expiredUnrevokedRefreshTokens,
      roles,
      permissions,
      rolesWithoutPermissions,
      activeUsersWithoutRoles,
      unscopedActiveCompanyUsers,
      openHighCriticalEvents,
      highCriticalEvents24h,
      refreshReuseEvents24h,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null, status: UserStatus.ACTIVE } }),
      this.prisma.userSecurityProfile.count({}),
      this.prisma.userSecurityProfile.count({ where: { twoFactorEnabled: true } }),
      this.prisma.userSecurityProfile.count({ where: { forceTwoFactorSetup: true } }),
      this.prisma.user.count({
        where: { deletedAt: null, lockedUntil: { gt: now } },
      }),
      this.prisma.activeSession.count({ where: { status: ActiveSessionStatus.ACTIVE } }),
      this.prisma.activeSession.count({
        where: { status: ActiveSessionStatus.ACTIVE, expiresAt: { lt: now } },
      }),
      this.prisma.activeSession.count({
        where: {
          status: ActiveSessionStatus.REVOKED,
          revokedAt: { gte: last24h },
        },
      }),
      this.prisma.refreshToken.count({
        where: { revokedAt: null, expiresAt: { lt: now } },
      }),
      this.prisma.role.count({}),
      this.prisma.permission.count({}),
      this.prisma.role.count({
        where: { rolePermissions: { none: {} } },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, status: UserStatus.ACTIVE, userRoles: { none: {} } },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          status: UserStatus.ACTIVE,
          companyId: null,
          companyAccess: { none: {} },
          userRoles: { some: { role: { scope: { not: 'GROUP' } } } },
        },
      }),
      this.prisma.securityEvent.count({
        where: {
          status: SecurityEventStatus.OPEN,
          severity: { in: [SecurityEventSeverity.HIGH, SecurityEventSeverity.CRITICAL] },
        },
      }),
      this.prisma.securityEvent.count({
        where: {
          createdAt: { gte: last24h },
          severity: { in: [SecurityEventSeverity.HIGH, SecurityEventSeverity.CRITICAL] },
        },
      }),
      this.prisma.securityEvent.count({
        where: {
          createdAt: { gte: last24h },
          eventType: SecurityEventType.SUSPICIOUS_ACTIVITY,
        },
      }),
    ]);

    const twoFactorAdoptionRate =
      usersWithSecurityProfiles > 0
        ? Math.round((twoFactorEnabledUsers / usersWithSecurityProfiles) * 100)
        : 0;

    const checks: SecurityReadinessCheck[] = [
      this.buildTokenPolicyCheck({
        refreshExpiresIn,
        accessExpiresIn,
        refreshSecretConfigured,
        accessSecretConfigured,
        refreshDurationMs,
      }),
      this.buildSessionIntegrityCheck(
        activeSessions,
        expiredActiveSessions,
        revokedSessions24h,
        expiredUnrevokedRefreshTokens,
      ),
      this.buildMfaCheck(
        activeUsers,
        usersWithSecurityProfiles,
        twoFactorEnabledUsers,
        forceTwoFactorUsers,
        lockedAccounts,
        twoFactorAdoptionRate,
      ),
      this.buildAccessControlCheck(
        roles,
        permissions,
        rolesWithoutPermissions,
        activeUsersWithoutRoles,
        unscopedActiveCompanyUsers,
      ),
      this.buildSecurityEventsCheck(
        openHighCriticalEvents,
        highCriticalEvents24h,
        refreshReuseEvents24h,
      ),
    ];

    const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
    const status: SecurityReadinessStatus = checks.some((check) => check.status === 'CRITICAL')
      ? 'CRITICAL'
      : score >= 90
        ? 'READY'
        : 'WARNING';

    return {
      score,
      target: 90,
      status,
      maturity:
        status === 'READY'
          ? 'Production-ready auth, session, and access controls'
          : status === 'WARNING'
            ? 'Secure with access-control follow-up items'
            : 'Authentication or access-control blockers require action',
      updatedAt: now.toISOString(),
      indicators: {
        activeUsers,
        usersWithSecurityProfiles,
        twoFactorEnabledUsers,
        forceTwoFactorUsers,
        twoFactorAdoptionRate,
        lockedAccounts,
        activeSessions,
        expiredActiveSessions,
        revokedSessions24h,
        expiredUnrevokedRefreshTokens,
        roles,
        permissions,
        rolesWithoutPermissions,
        activeUsersWithoutRoles,
        unscopedActiveCompanyUsers,
        openHighCriticalEvents,
        highCriticalEvents24h,
        refreshReuseEvents24h,
      },
      checks,
    };
  }

  private buildTokenPolicyCheck(input: {
    refreshExpiresIn: string;
    accessExpiresIn: string;
    refreshSecretConfigured: boolean;
    accessSecretConfigured: boolean;
    refreshDurationMs: number | null;
  }): SecurityReadinessCheck {
    const persistentRefresh = this.isNonExpiringDuration(input.refreshExpiresIn);
    const longRefresh =
      persistentRefresh ||
      (input.refreshDurationMs !== null && input.refreshDurationMs >= 30 * 24 * 60 * 60 * 1000);
    const status: SecurityReadinessStatus =
      !input.refreshSecretConfigured || !input.accessSecretConfigured
        ? 'CRITICAL'
        : longRefresh
          ? 'READY'
          : 'WARNING';

    return {
      key: 'token-session-policy',
      title: 'Token and session policy',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 85 : 35,
      message:
        status === 'READY'
          ? 'JWT secrets are configured and refresh sessions support persistent logged-in work.'
          : status === 'WARNING'
            ? 'Refresh token lifetime is short for the no-unexpected-logout operating requirement.'
            : 'JWT access or refresh secrets are not configured.',
      details: {
        accessExpiresIn: input.accessExpiresIn,
        refreshExpiresIn: input.refreshExpiresIn,
        persistentRefresh,
        accessSecretConfigured: input.accessSecretConfigured,
        refreshSecretConfigured: input.refreshSecretConfigured,
      },
    };
  }

  private buildSessionIntegrityCheck(
    activeSessions: number,
    expiredActiveSessions: number,
    revokedSessions24h: number,
    expiredUnrevokedRefreshTokens: number,
  ): SecurityReadinessCheck {
    const status: SecurityReadinessStatus =
      expiredActiveSessions > 0
        ? 'CRITICAL'
        : expiredUnrevokedRefreshTokens > 0
          ? 'WARNING'
          : 'READY';

    return {
      key: 'session-integrity',
      title: 'Session revocation and stale-token hygiene',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'Active sessions and refresh-token records are internally consistent.'
          : status === 'WARNING'
            ? 'Expired refresh tokens remain unrevoked and should be pruned.'
            : 'Expired sessions are still marked active and can cause inconsistent access behavior.',
      details: {
        activeSessions,
        expiredActiveSessions,
        revokedSessions24h,
        expiredUnrevokedRefreshTokens,
      },
    };
  }

  private buildMfaCheck(
    activeUsers: number,
    usersWithSecurityProfiles: number,
    twoFactorEnabledUsers: number,
    forceTwoFactorUsers: number,
    lockedAccounts: number,
    twoFactorAdoptionRate: number,
  ): SecurityReadinessCheck {
    const status: SecurityReadinessStatus =
      usersWithSecurityProfiles < activeUsers
        ? 'WARNING'
        : twoFactorAdoptionRate >= 70 || forceTwoFactorUsers > 0
          ? 'READY'
          : 'WARNING';
    return {
      key: 'mfa-account-protection',
      title: 'MFA and account protection',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'MFA coverage or enforcement is in place and account lockout telemetry is visible.'
          : 'MFA adoption/enforcement should be increased for privileged ERP access.',
      details: {
        activeUsers,
        usersWithSecurityProfiles,
        twoFactorEnabledUsers,
        forceTwoFactorUsers,
        lockedAccounts,
        twoFactorAdoptionRate,
      },
    };
  }

  private buildAccessControlCheck(
    roles: number,
    permissions: number,
    rolesWithoutPermissions: number,
    activeUsersWithoutRoles: number,
    unscopedActiveCompanyUsers: number,
  ): SecurityReadinessCheck {
    const status: SecurityReadinessStatus =
      roles === 0 || permissions === 0 || activeUsersWithoutRoles > 0
        ? 'CRITICAL'
        : rolesWithoutPermissions > 0 || unscopedActiveCompanyUsers > 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'rbac-scope-coverage',
      title: 'RBAC and company-scope coverage',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'Roles, permissions, assignments, and company scopes are populated.'
          : status === 'WARNING'
            ? 'Some roles or company-scoped users need access-scope cleanup.'
            : 'Users without roles or missing RBAC seed data block safe access control.',
      details: {
        roles,
        permissions,
        rolesWithoutPermissions,
        activeUsersWithoutRoles,
        unscopedActiveCompanyUsers,
      },
    };
  }

  private buildSecurityEventsCheck(
    openHighCriticalEvents: number,
    highCriticalEvents24h: number,
    refreshReuseEvents24h: number,
  ): SecurityReadinessCheck {
    const status: SecurityReadinessStatus =
      refreshReuseEvents24h > 0 ? 'CRITICAL' : openHighCriticalEvents > 0 ? 'WARNING' : 'READY';
    return {
      key: 'security-event-response',
      title: 'Security event response',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 50,
      message:
        status === 'READY'
          ? 'No unresolved high/critical security events are blocking production readiness.'
          : status === 'WARNING'
            ? 'High or critical security events are open and need review.'
            : 'Suspicious refresh-token reuse was detected in the last 24 hours.',
      details: { openHighCriticalEvents, highCriticalEvents24h, refreshReuseEvents24h },
    };
  }

  private isNonExpiringDuration(duration: string): boolean {
    return ['never', 'none', 'no-expiry', 'no_expiry', '0'].includes(duration.toLowerCase());
  }

  private parseDuration(duration: string): number | null {
    if (this.isNonExpiringDuration(duration)) return null;
    const match = /^(\d+)([smhdw])$/.exec(duration);
    if (!match) return 3650 * 24 * 60 * 60 * 1000;
    const n = parseInt(match[1], 10);
    const ms: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 7 * 86_400_000,
    };
    return n * ms[match[2]];
  }
}
