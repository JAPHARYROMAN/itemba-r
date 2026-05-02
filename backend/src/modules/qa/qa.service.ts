import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class QaService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardSummary() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activeTestSuites,
      activeTestCases,
      testRunsThisMonth,
      latestTestRun,
      recentTestRuns,
      openLaunchBlockers,
      last30DaysRuns,
    ] = await Promise.all([
      this.prisma.qATestSuite.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.qATestCase.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.qATestRun.count({ where: { startedAt: { gte: startOfMonth }, deletedAt: null } }),
      this.prisma.qATestRun.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } }),
      this.prisma.qATestRun.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.launchBlocker.count({ where: { status: 'OPEN', deletedAt: null } }),
      this.prisma.qATestRun.findMany({
        where: { startedAt: { gte: thirtyDaysAgo }, deletedAt: null },
        select: { passedCases: true, failedCases: true, blockedCases: true, totalCases: true },
      }),
    ]);

    const totalCases = last30DaysRuns.reduce((s, r) => s + (r.totalCases ?? 0), 0);
    const passedCases = last30DaysRuns.reduce((s, r) => s + (r.passedCases ?? 0), 0);
    const failedCases = last30DaysRuns.reduce((s, r) => s + (r.failedCases ?? 0), 0);
    const blockedCases = last30DaysRuns.reduce((s, r) => s + (r.blockedCases ?? 0), 0);
    const passRate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;

    const criticalFailedCases = await this.prisma.qATestResult.count({
      where: {
        status: 'FAILED',
        createdAt: { gte: thirtyDaysAgo },
        testCase: { priority: 'CRITICAL' },
      },
    });

    return {
      activeTestSuites,
      activeTestCases,
      testRunsThisMonth,
      latestTestRun,
      passRate,
      failedCases,
      blockedCases,
      criticalFailedCases,
      openLaunchBlockers,
      recentTestRuns,
    };
  }
}
