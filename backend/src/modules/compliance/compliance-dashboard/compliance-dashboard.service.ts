import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../../common/services';
import { PrismaService } from '../../../prisma/prisma.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class ComplianceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(user: AuthUser, query: any = {}) {
    const { companyId } = query;
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const filter: any = { ...companyWhere, deletedAt: null };

    const today = new Date();
    const todayStart = startOfDay(today);
    const in30Days = addDays(todayStart, 30);
    const in60Days = addDays(todayStart, 60);

    const [
      totalObligations,
      overdueObligations,
      upcomingObligations,
      criticalObligations,
      completedObligations,
      missingDocuments,
      expiringDocuments,
      availableDocuments,
      openTaxReturns,
      submittedTaxReturns,
      taxReturnOutstanding,
      activeLicenses,
      expiringLicenses,
      expiredLicenses,
      activeOshaRegistrations,
      expiringOshaRegistrations,
      complianceEventsLast30Days,
      obligationStatusRows,
      obligationPriorityRows,
      documentStatusRows,
      taxReturnStatusRows,
      licenseStatusRows,
      recentObligations,
      upcomingDocumentRenewals,
      recentComplianceEvents,
    ] = await Promise.all([
      this.prisma.complianceObligation.count({ where: filter }),
      this.prisma.complianceObligation.count({
        where: {
          ...filter,
          dueDate: { lt: todayStart },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'WAIVED'] },
        },
      }),
      this.prisma.complianceObligation.count({
        where: {
          ...filter,
          dueDate: { gte: todayStart, lte: in30Days },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'WAIVED'] },
        },
      }),
      this.prisma.complianceObligation.count({
        where: {
          ...filter,
          priority: 'CRITICAL',
          status: { notIn: ['COMPLETED', 'CANCELLED', 'WAIVED'] },
        },
      }),
      this.prisma.complianceObligation.count({
        where: { ...filter, status: 'COMPLETED' },
      }),
      this.prisma.complianceDocumentStatus.count({
        where: { ...(companyWhere as any), status: 'MISSING' },
      }),
      this.prisma.complianceDocumentStatus.count({
        where: {
          ...(companyWhere as any),
          status: { in: ['EXPIRED', 'EXPIRING_SOON'] },
        },
      }),
      this.prisma.complianceDocumentStatus.count({
        where: { ...(companyWhere as any), status: 'AVAILABLE' },
      }),
      this.prisma.taxReturn.count({
        where: { ...filter, status: { notIn: ['PAID', 'CLOSED', 'CANCELLED'] } },
      }),
      this.prisma.taxReturn.count({
        where: { ...filter, status: { in: ['SUBMITTED', 'APPROVED'] } },
      }),
      this.prisma.taxReturn.aggregate({
        where: { ...filter, status: { notIn: ['PAID', 'CLOSED', 'CANCELLED'] } },
        _sum: { outstandingAmount: true, totalDue: true },
      }),
      this.prisma.businessLicense.count({
        where: { ...filter, status: 'ACTIVE' },
      }),
      this.prisma.businessLicense.count({
        where: {
          ...filter,
          status: { in: ['ACTIVE', 'PENDING_RENEWAL'] },
          expiryDate: { gte: todayStart, lte: in60Days },
        },
      }),
      this.prisma.businessLicense.count({
        where: { ...filter, status: 'EXPIRED' },
      }),
      this.prisma.oshaRegistration.count({
        where: { ...filter, status: 'ACTIVE' },
      }),
      this.prisma.oshaRegistration.count({
        where: {
          ...filter,
          status: { in: ['ACTIVE', 'PENDING_RENEWAL'] },
          expiresAt: { gte: todayStart, lte: in60Days },
        },
      }),
      this.prisma.complianceEvent.count({
        where: { ...filter, eventDate: { gte: addDays(todayStart, -30) } },
      }),
      this.prisma.complianceObligation.groupBy({
        by: ['status'],
        where: filter,
        _count: { _all: true },
      }),
      this.prisma.complianceObligation.groupBy({
        by: ['priority'],
        where: filter,
        _count: { _all: true },
      }),
      this.prisma.complianceDocumentStatus.groupBy({
        by: ['status'],
        where: { ...(companyWhere as any) },
        _count: { _all: true },
      }),
      this.prisma.taxReturn.groupBy({
        by: ['status'],
        where: filter,
        _count: { _all: true },
      }),
      this.prisma.businessLicense.groupBy({
        by: ['status'],
        where: filter,
        _count: { _all: true },
      }),
      this.prisma.complianceObligation.findMany({
        where: {
          ...filter,
          status: { notIn: ['COMPLETED', 'CANCELLED', 'WAIVED'] },
        },
        select: {
          id: true,
          obligationCode: true,
          title: true,
          obligationType: true,
          priority: true,
          status: true,
          dueDate: true,
          responsibleUserId: true,
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      this.prisma.complianceDocumentStatus.findMany({
        where: {
          ...(companyWhere as any),
          OR: [
            { status: { in: ['EXPIRED', 'EXPIRING_SOON'] } },
            { expiryDate: { gte: todayStart, lte: in60Days } },
            { renewalDate: { gte: todayStart, lte: in60Days } },
          ],
        },
        select: {
          id: true,
          companyId: true,
          requirementId: true,
          status: true,
          expiryDate: true,
          renewalDate: true,
        },
        orderBy: [{ expiryDate: 'asc' }, { renewalDate: 'asc' }],
        take: 10,
      }),
      this.prisma.complianceEvent.findMany({
        where: filter,
        select: {
          id: true,
          eventNumber: true,
          eventType: true,
          title: true,
          eventDate: true,
          complianceObligationId: true,
        },
        orderBy: { eventDate: 'desc' },
        take: 10,
      }),
    ]);

    return {
      overdue_obligations: overdueObligations,
      upcoming_obligations: upcomingObligations,
      missing_documents: missingDocuments,
      open_returns: openTaxReturns,
      overdueObligations,
      upcomingObligations,
      missingDocuments,
      openTaxReturns,
      expiringDocuments,
      totalObligations,
      criticalObligations,
      completedObligations,
      completionRate: percentage(completedObligations, totalObligations),
      documents: {
        missing: missingDocuments,
        expiring: expiringDocuments,
        available: availableDocuments,
      },
      taxReturns: {
        open: openTaxReturns,
        submittedOrApproved: submittedTaxReturns,
        outstandingAmount: toNumber(taxReturnOutstanding._sum.outstandingAmount),
        totalDue: toNumber(taxReturnOutstanding._sum.totalDue),
      },
      licenses: {
        active: activeLicenses,
        expiringWithin60Days: expiringLicenses,
        expired: expiredLicenses,
      },
      osha: {
        activeRegistrations: activeOshaRegistrations,
        expiringWithin60Days: expiringOshaRegistrations,
      },
      events: {
        last30Days: complianceEventsLast30Days,
      },
      obligationStatusBreakdown: countBy(obligationStatusRows as GroupCount[], 'status'),
      obligationPriorityBreakdown: countBy(obligationPriorityRows as GroupCount[], 'priority'),
      documentStatusBreakdown: countBy(documentStatusRows as GroupCount[], 'status'),
      taxReturnStatusBreakdown: countBy(taxReturnStatusRows as GroupCount[], 'status'),
      licenseStatusBreakdown: countBy(licenseStatusRows as GroupCount[], 'status'),
      recentObligations,
      upcomingDocumentRenewals,
      recentComplianceEvents,
    };
  }
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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
