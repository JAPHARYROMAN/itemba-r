import { Injectable } from '@nestjs/common';
import { CommunicationStatus, CustomerStatus, SupplierStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;
type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface CrmReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const where: any = { deletedAt: null, ...companyWhere };

    const communicationWhere = { ...where };
    const followUpDueDate = endOfDay(new Date());

    const [
      totalCustomers,
      activeCustomers,
      blockedCustomers,
      inactiveCustomers,
      totalSuppliers,
      activeSuppliers,
      blockedSuppliers,
      inactiveSuppliers,
      openCommunications,
      followUpsDue,
      overdueFollowUps,
      activeSegments,
      totalSegments,
      contactPeople,
      customerBalances,
      supplierBalances,
      highRiskCreditProfiles,
      supplierRiskProfiles,
      customerStatusRows,
      supplierStatusRows,
      communicationStatusRows,
      communicationTypeRows,
      recentCustomers,
      recentSuppliers,
      recentCommunications,
      largestCustomerBalances,
      largestSupplierBalances,
    ] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.count({ where: { ...where, status: CustomerStatus.ACTIVE } }),
      this.prisma.customer.count({ where: { ...where, status: CustomerStatus.BLOCKED } }),
      this.prisma.customer.count({ where: { ...where, status: CustomerStatus.INACTIVE } }),
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.count({ where: { ...where, status: SupplierStatus.ACTIVE } }),
      this.prisma.supplier.count({ where: { ...where, status: SupplierStatus.BLOCKED } }),
      this.prisma.supplier.count({ where: { ...where, status: SupplierStatus.INACTIVE } }),
      this.prisma.communicationLog.count({
        where: { ...communicationWhere, status: CommunicationStatus.OPEN },
      }),
      this.prisma.communicationLog.count({
        where: {
          ...communicationWhere,
          followUpRequired: true,
          followUpDate: { lte: followUpDueDate },
          status: { in: [CommunicationStatus.OPEN, CommunicationStatus.FOLLOWED_UP] },
        },
      }),
      this.prisma.communicationLog.count({
        where: {
          ...communicationWhere,
          followUpRequired: true,
          followUpDate: { lt: startOfDay(new Date()) },
          status: { in: [CommunicationStatus.OPEN, CommunicationStatus.FOLLOWED_UP] },
        },
      }),
      this.prisma.customerSegment.count({ where: { ...where, isActive: true } }),
      this.prisma.customerSegment.count({ where }),
      this.prisma.contactPerson.count({ where }),
      this.prisma.customer.aggregate({
        where,
        _sum: { currentBalance: true, creditLimit: true },
      }),
      this.prisma.supplier.aggregate({
        where,
        _sum: { currentBalance: true, creditLimit: true },
      }),
      this.prisma.customerCreditProfile.count({
        where: {
          ...companyWhere,
          deletedAt: null,
          OR: [
            { riskRating: { in: ['HIGH', 'BLOCKED'] } },
            { creditStatus: { in: ['BLOCKED', 'REVIEW_REQUIRED'] } },
          ],
        },
      }),
      this.prisma.supplierPerformanceProfile.count({
        where: {
          ...companyWhere,
          deletedAt: null,
          OR: [{ rating: { in: ['AVERAGE', 'POOR'] } }, { disputeCount: { gt: 0 } }],
        },
      }),
      this.prisma.customer.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.supplier.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.communicationLog.groupBy({
        by: ['status'],
        where: communicationWhere,
        _count: { _all: true },
      }),
      this.prisma.communicationLog.groupBy({
        by: ['communicationType'],
        where: communicationWhere,
        _count: { _all: true },
      }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          customerCode: true,
          name: true,
          status: true,
          currentBalance: true,
          creditLimit: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.supplier.findMany({
        where,
        select: {
          id: true,
          supplierCode: true,
          name: true,
          status: true,
          currentBalance: true,
          creditLimit: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.communicationLog.findMany({
        where: communicationWhere,
        select: {
          id: true,
          communicationNumber: true,
          entityType: true,
          entityId: true,
          communicationType: true,
          direction: true,
          subject: true,
          status: true,
          followUpRequired: true,
          followUpDate: true,
          communicationDate: true,
        },
        orderBy: { communicationDate: 'desc' },
        take: 10,
      }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          customerCode: true,
          name: true,
          status: true,
          currentBalance: true,
          creditLimit: true,
        },
        orderBy: { currentBalance: 'desc' },
        take: 8,
      }),
      this.prisma.supplier.findMany({
        where,
        select: {
          id: true,
          supplierCode: true,
          name: true,
          status: true,
          currentBalance: true,
          creditLimit: true,
        },
        orderBy: { currentBalance: 'desc' },
        take: 8,
      }),
    ]);

    return {
      totalCustomers,
      totalSuppliers,
      openCommunications,
      activeSegments,
      customers: {
        total: totalCustomers,
        active: activeCustomers,
        blocked: blockedCustomers,
        inactive: inactiveCustomers,
        activeRate: percentage(activeCustomers, totalCustomers),
        creditLimit: toNumber(customerBalances._sum.creditLimit),
        outstandingBalance: toNumber(customerBalances._sum.currentBalance),
      },
      suppliers: {
        total: totalSuppliers,
        active: activeSuppliers,
        blocked: blockedSuppliers,
        inactive: inactiveSuppliers,
        activeRate: percentage(activeSuppliers, totalSuppliers),
        creditLimit: toNumber(supplierBalances._sum.creditLimit),
        outstandingBalance: toNumber(supplierBalances._sum.currentBalance),
      },
      relationshipOps: {
        contactPeople,
        totalSegments,
        activeSegments,
        openCommunications,
        followUpsDue,
        overdueFollowUps,
        highRiskCreditProfiles,
        supplierRiskProfiles,
      },
      customerStatusBreakdown: countBy(customerStatusRows as GroupCount[], 'status'),
      supplierStatusBreakdown: countBy(supplierStatusRows as GroupCount[], 'status'),
      communicationStatusBreakdown: countBy(communicationStatusRows as GroupCount[], 'status'),
      communicationTypeBreakdown: countBy(
        communicationTypeRows as GroupCount[],
        'communicationType',
      ),
      recentCustomers,
      recentSuppliers,
      recentCommunications,
      largestCustomerBalances,
      largestSupplierBalances,
    };
  }

  async getReadiness(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const where: any = { deletedAt: null, ...companyWhere };
    const now = new Date();
    const todayStart = startOfDay(now);
    const fortyFiveDaysAgo = new Date(now);
    fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);
    const staleReviewDate = new Date(now);
    staleReviewDate.setDate(staleReviewDate.getDate() - 90);

    const [
      totalCustomers,
      activeCustomers,
      blockedCustomers,
      customersMissingContact,
      customersMissingTin,
      totalSuppliers,
      activeSuppliers,
      blockedSuppliers,
      suppliersMissingContact,
      suppliersMissingTin,
      contactPeople,
      activeSegments,
      creditProfiles,
      highRiskCreditProfiles,
      staleCreditProfiles,
      supplierPerformanceProfiles,
      supplierRiskProfiles,
      staleSupplierPerformanceProfiles,
      openCommunications,
      overdueFollowUps,
      recentCustomerStatementRuns,
      recentSupplierStatementRuns,
    ] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.count({ where: { ...where, status: CustomerStatus.ACTIVE } }),
      this.prisma.customer.count({ where: { ...where, status: CustomerStatus.BLOCKED } }),
      this.prisma.customer.count({
        where: {
          ...where,
          OR: [
            { phone: null },
            { phone: '' },
            { email: null },
            { email: '' },
            { contactPerson: null },
            { contactPerson: '' },
          ],
        },
      }),
      this.prisma.customer.count({
        where: { ...where, OR: [{ tin: null }, { tin: '' }] },
      }),
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.count({ where: { ...where, status: SupplierStatus.ACTIVE } }),
      this.prisma.supplier.count({ where: { ...where, status: SupplierStatus.BLOCKED } }),
      this.prisma.supplier.count({
        where: {
          ...where,
          OR: [
            { phone: null },
            { phone: '' },
            { email: null },
            { email: '' },
            { contactPerson: null },
            { contactPerson: '' },
          ],
        },
      }),
      this.prisma.supplier.count({
        where: { ...where, OR: [{ tin: null }, { tin: '' }] },
      }),
      this.prisma.contactPerson.count({ where }),
      this.prisma.customerSegment.count({ where: { ...where, isActive: true } }),
      this.prisma.customerCreditProfile.count({ where: { ...companyWhere, deletedAt: null } }),
      this.prisma.customerCreditProfile.count({
        where: {
          ...companyWhere,
          deletedAt: null,
          OR: [
            { riskRating: { in: ['HIGH', 'BLOCKED'] } },
            { creditStatus: { in: ['BLOCKED', 'REVIEW_REQUIRED'] } },
          ],
        },
      }),
      this.prisma.customerCreditProfile.count({
        where: {
          ...companyWhere,
          deletedAt: null,
          OR: [{ lastReviewedAt: null }, { lastReviewedAt: { lt: staleReviewDate } }],
        },
      }),
      this.prisma.supplierPerformanceProfile.count({ where: { ...companyWhere, deletedAt: null } }),
      this.prisma.supplierPerformanceProfile.count({
        where: {
          ...companyWhere,
          deletedAt: null,
          OR: [{ rating: { in: ['AVERAGE', 'POOR'] } }, { disputeCount: { gt: 0 } }],
        },
      }),
      this.prisma.supplierPerformanceProfile.count({
        where: {
          ...companyWhere,
          deletedAt: null,
          OR: [{ lastReviewedAt: null }, { lastReviewedAt: { lt: staleReviewDate } }],
        },
      }),
      this.prisma.communicationLog.count({
        where: { ...where, status: CommunicationStatus.OPEN },
      }),
      this.prisma.communicationLog.count({
        where: {
          ...where,
          followUpRequired: true,
          followUpDate: { lt: todayStart },
          status: { in: [CommunicationStatus.OPEN, CommunicationStatus.FOLLOWED_UP] },
        },
      }),
      this.prisma.customerStatementRun.count({
        where: { ...companyWhere, generatedAt: { gte: fortyFiveDaysAgo } },
      }),
      this.prisma.supplierStatementRun.count({
        where: { ...companyWhere, generatedAt: { gte: fortyFiveDaysAgo } },
      }),
    ]);

    const checks: CrmReadinessCheck[] = [
      this.buildRelationshipFoundationCheck(
        totalCustomers,
        activeCustomers,
        blockedCustomers,
        totalSuppliers,
        activeSuppliers,
        blockedSuppliers,
      ),
      this.buildMasterDataHygieneCheck(
        totalCustomers,
        customersMissingContact,
        customersMissingTin,
        totalSuppliers,
        suppliersMissingContact,
        suppliersMissingTin,
        contactPeople,
      ),
      this.buildRiskControlCheck(
        totalCustomers,
        creditProfiles,
        highRiskCreditProfiles,
        staleCreditProfiles,
        totalSuppliers,
        supplierPerformanceProfiles,
        supplierRiskProfiles,
        staleSupplierPerformanceProfiles,
      ),
      this.buildEngagementFollowUpCheck(openCommunications, overdueFollowUps),
      this.buildStatementEvidenceCheck(
        totalCustomers,
        totalSuppliers,
        recentCustomerStatementRuns,
        recentSupplierStatementRuns,
      ),
      this.buildSegmentationCheck(activeSegments, contactPeople),
    ];

    const score = averageScore(checks);
    const status: ReadinessStatus = checks.some((check) => check.status === 'CRITICAL')
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
          ? 'CRM/SRM controls are above the 90% readiness threshold'
          : status === 'WARNING'
            ? 'CRM/SRM is operational with hygiene or review warnings'
            : 'CRM/SRM master-data or risk blockers require action',
      updatedAt: new Date().toISOString(),
      indicators: {
        totalCustomers,
        activeCustomers,
        blockedCustomers,
        customersMissingContact,
        customersMissingTin,
        totalSuppliers,
        activeSuppliers,
        blockedSuppliers,
        suppliersMissingContact,
        suppliersMissingTin,
        contactPeople,
        activeSegments,
        creditProfiles,
        highRiskCreditProfiles,
        staleCreditProfiles,
        supplierPerformanceProfiles,
        supplierRiskProfiles,
        staleSupplierPerformanceProfiles,
        openCommunications,
        overdueFollowUps,
        recentCustomerStatementRuns,
        recentSupplierStatementRuns,
      },
      checks,
    };
  }

  private buildRelationshipFoundationCheck(
    totalCustomers: number,
    activeCustomers: number,
    blockedCustomers: number,
    totalSuppliers: number,
    activeSuppliers: number,
    blockedSuppliers: number,
  ): CrmReadinessCheck {
    const status: ReadinessStatus =
      totalCustomers === 0 && totalSuppliers === 0
        ? 'WARNING'
        : activeCustomers === 0 && totalCustomers > 0
          ? 'CRITICAL'
          : activeSuppliers === 0 && totalSuppliers > 0
            ? 'CRITICAL'
            : 'READY';
    return {
      key: 'relationship-foundation',
      title: 'Customer and supplier foundation',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 55,
      message:
        status === 'READY'
          ? 'Active customer and supplier master records are available.'
          : status === 'WARNING'
            ? 'No customer or supplier relationship records exist in scope yet.'
            : 'Relationship records exist but active customer/supplier coverage is missing.',
      details: {
        totalCustomers,
        activeCustomers,
        blockedCustomers,
        totalSuppliers,
        activeSuppliers,
        blockedSuppliers,
      },
    };
  }

  private buildMasterDataHygieneCheck(
    totalCustomers: number,
    customersMissingContact: number,
    customersMissingTin: number,
    totalSuppliers: number,
    suppliersMissingContact: number,
    suppliersMissingTin: number,
    contactPeople: number,
  ): CrmReadinessCheck {
    const totalParties = totalCustomers + totalSuppliers;
    const missingContact = customersMissingContact + suppliersMissingContact;
    const missingTin = customersMissingTin + suppliersMissingTin;
    const missingContactRate =
      totalParties > 0 ? Math.round((missingContact / totalParties) * 100) : 0;
    const status: ReadinessStatus =
      missingContactRate > 25
        ? 'CRITICAL'
        : missingContactRate > 10 || missingTin > 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'master-data-hygiene',
      title: 'Relationship master-data hygiene',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 55,
      message:
        status === 'READY'
          ? 'Customer and supplier records have usable contact and statutory metadata.'
          : status === 'WARNING'
            ? 'Some customer/supplier records need contact or TIN cleanup.'
            : 'A large share of relationship records are missing contact data.',
      details: {
        missingContact,
        missingContactRate,
        missingTin,
        contactPeople,
      },
    };
  }

  private buildRiskControlCheck(
    totalCustomers: number,
    creditProfiles: number,
    highRiskCreditProfiles: number,
    staleCreditProfiles: number,
    totalSuppliers: number,
    supplierPerformanceProfiles: number,
    supplierRiskProfiles: number,
    staleSupplierPerformanceProfiles: number,
  ): CrmReadinessCheck {
    const missingCustomerProfiles = Math.max(totalCustomers - creditProfiles, 0);
    const missingSupplierProfiles = Math.max(totalSuppliers - supplierPerformanceProfiles, 0);
    const status: ReadinessStatus =
      highRiskCreditProfiles > 0 || supplierRiskProfiles > 0
        ? 'WARNING'
        : staleCreditProfiles > 0 || staleSupplierPerformanceProfiles > 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'credit-supplier-risk',
      title: 'Credit and supplier risk controls',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Credit and supplier performance profiles are current with no active high-risk flags.'
          : 'Risk profiles or stale reviews need relationship owner attention.',
      details: {
        creditProfiles,
        missingCustomerProfiles,
        highRiskCreditProfiles,
        staleCreditProfiles,
        supplierPerformanceProfiles,
        missingSupplierProfiles,
        supplierRiskProfiles,
        staleSupplierPerformanceProfiles,
      },
    };
  }

  private buildEngagementFollowUpCheck(
    openCommunications: number,
    overdueFollowUps: number,
  ): CrmReadinessCheck {
    const status: ReadinessStatus = overdueFollowUps > 0 ? 'WARNING' : 'READY';
    return {
      key: 'engagement-follow-up',
      title: 'Communication and follow-up control',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Open communications have no overdue follow-up blockers.'
          : 'Some relationship follow-ups are overdue and should be closed.',
      details: { openCommunications, overdueFollowUps },
    };
  }

  private buildStatementEvidenceCheck(
    totalCustomers: number,
    totalSuppliers: number,
    recentCustomerStatementRuns: number,
    recentSupplierStatementRuns: number,
  ): CrmReadinessCheck {
    const needsCustomerStatements = totalCustomers > 0 && recentCustomerStatementRuns === 0;
    const needsSupplierStatements = totalSuppliers > 0 && recentSupplierStatementRuns === 0;
    const status: ReadinessStatus =
      needsCustomerStatements || needsSupplierStatements ? 'WARNING' : 'READY';
    return {
      key: 'statement-evidence',
      title: 'Customer and supplier statement evidence',
      status,
      score: status === 'READY' ? 100 : 88,
      message:
        status === 'READY'
          ? 'Recent customer and supplier statements are available for relationship evidence.'
          : 'Generate recent statements to support AR/AP relationship review.',
      details: { recentCustomerStatementRuns, recentSupplierStatementRuns },
    };
  }

  private buildSegmentationCheck(activeSegments: number, contactPeople: number): CrmReadinessCheck {
    const status: ReadinessStatus = activeSegments === 0 && contactPeople > 0 ? 'WARNING' : 'READY';
    return {
      key: 'segmentation-contact-depth',
      title: 'Segmentation and contact depth',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Segmentation and contact depth are visible for CRM/SRM analysis.'
          : 'Contact records exist, but no active customer segment is configured.',
      details: { activeSegments, contactPeople },
    };
  }
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
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

function averageScore(checks: CrmReadinessCheck[]) {
  if (checks.length === 0) return 0;
  return Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
}
