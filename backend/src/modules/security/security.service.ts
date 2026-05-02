import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getDashboard() {
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
    const twoFactorAdoptionRate = totalUsers > 0 ? Math.round((twoFactorEnabled / totalUsers) * 100) : 0;

    return {
      eventsBySeverity,
      activeSessionsCount,
      lockedAccountsCount,
      failedLoginsLast24h: failedLoginsCount,
      twoFactorAdoptionRate,
      recentCriticalEvents,
    };
  }

  async getSummary() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [activeSessionsCount, lockedAccountsCount, openEventsCount] = await Promise.all([
      this.prisma.activeSession.count({ where: { status: 'ACTIVE' } }),
      this.prisma.userSecurityProfile.count({ where: { lockedUntil: { gt: now } } }),
      this.prisma.securityEvent.count({ where: { status: 'OPEN' } }),
    ]);

    return { activeSessionsCount, lockedAccountsCount, openEventsCount };
  }
}
