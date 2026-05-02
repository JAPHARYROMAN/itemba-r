import { Injectable } from '@nestjs/common';
import { CommunicationStatus, CustomerStatus, SupplierStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

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
