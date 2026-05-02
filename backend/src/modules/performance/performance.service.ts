import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObservabilityBudgetService } from '../../common/services';

@Injectable()
export class PerformanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observabilityBudget: ObservabilityBudgetService,
  ) {}

  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalTraces,
      slowTraces,
      failedTracesToday,
      recentTraces,
      avgResult,
      budgetWindowTraces,
    ] = await Promise.all([
      this.prisma.performanceTrace.count(),
      this.prisma.performanceTrace.count({ where: { durationMs: { gt: 2000 } } }),
      this.prisma.performanceTrace.count({
        where: { status: 'FAILED', createdAt: { gte: today } },
      }),
      this.prisma.performanceTrace.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.performanceTrace.aggregate({
        _avg: { durationMs: true },
        where: { createdAt: { gte: today } },
      }),
      this.prisma.performanceTrace.findMany({
        where: { createdAt: { gte: today } },
        orderBy: { durationMs: 'desc' },
        take: 100,
        select: {
          traceType: true,
          durationMs: true,
          status: true,
          path: true,
          operationName: true,
        },
      }),
    ]);

    return {
      totalTraces,
      avgResponseTimeToday: avgResult._avg.durationMs ?? 0,
      slowTraces,
      failedTracesToday,
      recentTraces,
      budgetSummary: this.observabilityBudget.summarizeTraces(budgetWindowTraces),
    };
  }
}
