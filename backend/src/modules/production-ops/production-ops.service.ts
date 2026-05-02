import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductionOpsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalJobsToday,
      failedJobsToday,
      cacheEntryCount,
      latestDeployment,
      activeIssues,
    ] = await Promise.all([
      this.prisma.backgroundJob.count({ where: { createdAt: { gte: today } } }),
      this.prisma.backgroundJob.count({
        where: { status: 'FAILED', createdAt: { gte: today } },
      }),
      this.prisma.cacheEntry.count(),
      this.prisma.deploymentRelease.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dataIsolationTestIssue.count({ where: { status: 'OPEN' } }),
    ]);

    return {
      totalBackgroundJobsToday: totalJobsToday,
      failedJobsToday,
      cacheEntryCount,
      latestDeployment,
      activeDataIsolationIssues: activeIssues,
    };
  }
}
