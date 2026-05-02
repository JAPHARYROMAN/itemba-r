import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class BusinessAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const where: any = {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };

    const todayStart = startOfDay(new Date());
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalRules,
      activeRules,
      inactiveRules,
      pausedRules,
      errorRules,
      rulesDue,
      runsToday,
      recentRuns,
      successfulRuns,
      failedRuns,
      requestedRuns,
      recordsProcessed,
      recordsFailed,
      ruleTypeRows,
      ruleStatusRows,
      runStatusRows,
      latestRuns,
      latestFailedRuns,
      upcomingRules,
    ] = await Promise.all([
      this.prisma.automationRule.count({ where }),
      this.prisma.automationRule.count({ where: { ...where, status: 'ACTIVE' } }),
      this.prisma.automationRule.count({ where: { ...where, status: 'INACTIVE' } }),
      this.prisma.automationRule.count({ where: { ...where, status: 'PAUSED' } }),
      this.prisma.automationRule.count({
        where: { ...where, status: 'ERROR' },
      }),
      this.prisma.automationRule.count({
        where: { ...where, status: 'ACTIVE', nextRunAt: { lte: new Date() } },
      }),
      this.prisma.automationRun.count({
        where: { ...where, createdAt: { gte: todayStart } },
      }),
      this.prisma.automationRun.count({ where: { ...where, createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.automationRun.count({
        where: { ...where, status: 'COMPLETED', createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.automationRun.count({
        where: { ...where, status: 'FAILED', createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.automationRun.count({
        where: { ...where, status: 'REQUESTED', createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.automationRun.aggregate({
        where: { ...where, createdAt: { gte: sevenDaysAgo } },
        _sum: { recordsProcessed: true, recordsCreated: true, recordsFailed: true },
      }),
      this.prisma.automationRun.aggregate({
        where: { ...where, status: 'FAILED', createdAt: { gte: sevenDaysAgo } },
        _sum: { recordsFailed: true },
      }),
      this.prisma.automationRule.groupBy({
        by: ['automationType'],
        where,
        _count: { _all: true },
      }),
      this.prisma.automationRule.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.automationRun.groupBy({
        by: ['status'],
        where: { ...where, createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
      }),
      this.prisma.automationRun.findMany({
        where,
        select: {
          id: true,
          automationRunNumber: true,
          automationRuleId: true,
          runType: true,
          status: true,
          recordsProcessed: true,
          recordsCreated: true,
          recordsFailed: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.automationRun.findMany({
        where: { ...where, status: 'FAILED' },
        select: {
          id: true,
          automationRunNumber: true,
          automationRuleId: true,
          errorMessage: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.automationRule.findMany({
        where: { ...where, status: 'ACTIVE', nextRunAt: { not: null } },
        select: {
          id: true,
          automationRuleCode: true,
          name: true,
          automationType: true,
          triggerType: true,
          nextRunAt: true,
          lastRunAt: true,
        },
        orderBy: { nextRunAt: 'asc' },
        take: 8,
      }),
    ]);

    return {
      activeRules,
      runsToday,
      failedRunsLast7Days: failedRuns,
      totalRules,
      inactiveRules,
      pausedRules,
      errorRules,
      rulesDue,
      recentRuns,
      successfulRuns,
      failedRuns,
      requestedRuns,
      successRate: percentage(successfulRuns, recentRuns),
      failureRate: percentage(failedRuns, recentRuns),
      throughput: {
        recordsProcessed: toNumber(recordsProcessed._sum.recordsProcessed),
        recordsCreated: toNumber(recordsProcessed._sum.recordsCreated),
        recordsFailed: toNumber(recordsProcessed._sum.recordsFailed),
        failedRunRecords: toNumber(recordsFailed._sum.recordsFailed),
      },
      ruleTypeBreakdown: countBy(ruleTypeRows as GroupCount[], 'automationType'),
      ruleStatusBreakdown: countBy(ruleStatusRows as GroupCount[], 'status'),
      runStatusBreakdown: countBy(runStatusRows as GroupCount[], 'status'),
      latestRuns,
      latestFailedRuns,
      upcomingRules,
    };
  }
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}
