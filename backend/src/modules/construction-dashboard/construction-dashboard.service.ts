import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class ConstructionDashboardService {
  constructor(
    private prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(companyId: string | undefined, user: AuthUser) {
    const where: any = {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };
    const todayStart = startOfDay(new Date());

    const [
      totalProjects,
      activeProjects,
      plannedProjects,
      onHoldProjects,
      completedProjects,
      overdueProjects,
      projectFinancials,
      activeSites,
      inactiveSites,
      activeSubcontractors,
      subcontractorFinancials,
      pendingProgress,
      approvedProgress,
      averageProgress,
      materialIssuesPending,
      totalBillings,
      billingsSent,
      billingFinancials,
      projectStatusRows,
      siteStatusRows,
      progressStatusRows,
      billingStatusRows,
      recentProjects,
      recentProgressRecords,
      recentBillings,
    ] = await Promise.all([
      this.prisma.constructionProject.count({ where }),
      this.prisma.constructionProject.count({ where: { ...where, status: 'ACTIVE' } }),
      this.prisma.constructionProject.count({ where: { ...where, status: 'PLANNED' } }),
      this.prisma.constructionProject.count({ where: { ...where, status: 'ON_HOLD' } }),
      this.prisma.constructionProject.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.constructionProject.count({
        where: {
          ...where,
          expectedEndDate: { lt: todayStart },
          status: { in: ['PLANNED', 'ACTIVE', 'ON_HOLD'] },
        },
      }),
      this.prisma.constructionProject.aggregate({
        where,
        _sum: {
          contractValue: true,
          budgetAmount: true,
          actualCost: true,
          billedAmount: true,
          receivedAmount: true,
        },
      }),
      this.prisma.constructionSite.count({ where: { ...where, status: 'ACTIVE' } }),
      this.prisma.constructionSite.count({ where: { ...where, status: 'INACTIVE' } }),
      this.prisma.subcontractorRecord.count({ where: { ...where, status: 'ACTIVE' } }),
      this.prisma.subcontractorRecord.aggregate({
        where,
        _sum: { contractValue: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.projectProgressRecord.count({ where: { ...where, status: 'SUBMITTED' } }),
      this.prisma.projectProgressRecord.count({ where: { ...where, status: 'APPROVED' } }),
      this.prisma.projectProgressRecord.aggregate({
        where,
        _avg: { percentComplete: true },
      }),
      this.prisma.projectMaterialIssue.count({
        where: { ...where, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
      }),
      this.prisma.projectBilling.count({ where }),
      this.prisma.projectBilling.count({
        where: { ...where, status: { in: ['SENT', 'APPROVED', 'PARTIALLY_PAID'] } },
      }),
      this.prisma.projectBilling.aggregate({
        where,
        _sum: { amount: true },
      }),
      this.prisma.constructionProject.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.constructionSite.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.projectProgressRecord.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.projectBilling.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.constructionProject.findMany({
        where,
        select: {
          id: true,
          projectCode: true,
          projectName: true,
          projectType: true,
          status: true,
          contractValue: true,
          budgetAmount: true,
          actualCost: true,
          billedAmount: true,
          receivedAmount: true,
          expectedEndDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.projectProgressRecord.findMany({
        where,
        select: {
          id: true,
          progressNumber: true,
          projectId: true,
          progressDate: true,
          percentComplete: true,
          status: true,
          description: true,
        },
        orderBy: { progressDate: 'desc' },
        take: 8,
      }),
      this.prisma.projectBilling.findMany({
        where,
        select: {
          id: true,
          billingNumber: true,
          projectId: true,
          billingDate: true,
          amount: true,
          currency: true,
          status: true,
        },
        orderBy: { billingDate: 'desc' },
        take: 8,
      }),
    ]);

    const contractValue = toNumber(projectFinancials._sum.contractValue);
    const actualCost = toNumber(projectFinancials._sum.actualCost);
    const billedAmount = toNumber(projectFinancials._sum.billedAmount);
    const receivedAmount = toNumber(projectFinancials._sum.receivedAmount);

    return {
      projects: {
        total: totalProjects,
        active: activeProjects,
        planned: plannedProjects,
        onHold: onHoldProjects,
        completed: completedProjects,
        overdue: overdueProjects,
        completionRate: percentage(completedProjects, totalProjects),
      },
      activeSites,
      inactiveSites,
      activeSubcontractors,
      pendingProgressApprovals: pendingProgress,
      totalBillings,
      billingsSent,
      materialIssuesPending,
      financials: {
        contractValue,
        budgetAmount: toNumber(projectFinancials._sum.budgetAmount),
        actualCost,
        billedAmount,
        receivedAmount,
        billingCoverageRate: percentage(billedAmount, contractValue),
        collectionRate: percentage(receivedAmount, billedAmount),
      },
      subcontractors: {
        active: activeSubcontractors,
        contractValue: toNumber(subcontractorFinancials._sum.contractValue),
        paidAmount: toNumber(subcontractorFinancials._sum.paidAmount),
        outstandingAmount: toNumber(subcontractorFinancials._sum.outstandingAmount),
      },
      progress: {
        submitted: pendingProgress,
        approved: approvedProgress,
        averagePercentComplete: round1(toNumber(averageProgress._avg.percentComplete)),
      },
      billing: {
        totalRecords: totalBillings,
        sentOrApproved: billingsSent,
        totalAmount: toNumber(billingFinancials._sum.amount),
      },
      projectStatusBreakdown: countBy(projectStatusRows as GroupCount[], 'status'),
      siteStatusBreakdown: countBy(siteStatusRows as GroupCount[], 'status'),
      progressStatusBreakdown: countBy(progressStatusRows as GroupCount[], 'status'),
      billingStatusBreakdown: countBy(billingStatusRows as GroupCount[], 'status'),
      recentProjects,
      recentProgressRecords,
      recentBillings,
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

function round1(value: number) {
  return Math.round(value * 10) / 10;
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
