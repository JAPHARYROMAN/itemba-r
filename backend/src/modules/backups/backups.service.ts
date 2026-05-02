import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getDashboard() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [activeJobs, recentRuns, failedCount] = await Promise.all([
      this.prisma.backupJob.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, backupJobCode: true, name: true, backupType: true, schedule: true, lastRunAt: true, nextRunAt: true, status: true },
      }),
      this.prisma.backupRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, backupRunNumber: true, backupJobId: true, backupType: true, status: true, startedAt: true, completedAt: true, fileSizeBytes: true },
      }),
      this.prisma.backupRun.count({
        where: { status: 'FAILED', createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    const lastSuccessful = await this.prisma.backupRun.findMany({
      where: { status: 'COMPLETED' },
      distinct: ['backupType'],
      orderBy: { completedAt: 'desc' },
      select: { backupType: true, completedAt: true, fileSizeBytes: true },
    });

    return {
      activeJobs,
      recentRuns,
      lastSuccessfulByType: lastSuccessful,
      failedRunsLast7Days: failedCount,
    };
  }
}
