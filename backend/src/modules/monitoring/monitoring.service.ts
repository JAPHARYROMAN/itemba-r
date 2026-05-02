import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getDashboard() {
    const [
      healthChecks,
      recentErrors,
      recentMetrics,
      backupSummary,
    ] = await Promise.all([
      this.prisma.systemHealthCheck.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { lastCheckedAt: 'desc' },
      }),
      this.prisma.errorLog.findMany({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] as any } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, errorNumber: true, module: true, errorType: true,
          message: true, severity: true, status: true, createdAt: true,
        },
      }),
      this.prisma.systemMetric.findMany({
        orderBy: { recordedAt: 'desc' },
        take: 20,
      }),
      this.prisma.backupJob.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true, backupType: true, lastRunAt: true, nextRunAt: true, status: true },
        take: 10,
      }),
    ]);

    return {
      healthChecks,
      recentErrors,
      recentMetrics,
      backupSummary,
    };
  }
}
