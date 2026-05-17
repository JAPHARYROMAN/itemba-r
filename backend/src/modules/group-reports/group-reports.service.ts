import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

// SalesOrderStatus is { DRAFT, CONFIRMED, PARTIALLY_PAID, PAID, CANCELLED, VOIDED }.
// Reference the enum so an extra/missing value is a compile error rather than
// a runtime "Expected SalesOrderStatus" rejection.
const CONFIRMED_SALES_STATUSES = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PARTIALLY_PAID,
  SalesOrderStatus.PAID,
] as const;

@Injectable()
export class GroupReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /**
   * Group Sales — confirmed SalesOrder revenue summed across every company,
   * with breakdowns by company and by division. Optional date window.
   *
   * Useful as a single-shot "where is revenue happening this month" view that
   * cuts across sector report pages (Westsides POS, hospitality folios,
   * petroleum, Itemba services all surface as SalesOrders).
   */
  async groupSales(user: AuthUser, dateFrom?: string, dateTo?: string) {
    this.companyScope.assertGroupScoped(user, 'view group sales reports');
    const where: any = {
      deletedAt: null,
      status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
    };
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = new Date(dateFrom);
      if (dateTo) where.orderDate.lte = new Date(dateTo);
    }

    const [byCompanyRaw, byDivisionRaw, byBranchRaw, totals] = await Promise.all([
      this.prisma.salesOrder.groupBy({
        by: ['companyId'],
        where,
        _count: { id: true },
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['companyId', 'divisionId'],
        where,
        _count: { id: true },
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['companyId', 'divisionId', 'branchId'],
        where,
        _count: { id: true },
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.salesOrder.aggregate({
        where,
        _count: { id: true },
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
    ]);

    const companyIds = byCompanyRaw.map((r) => r.companyId);
    const divisionIds = byDivisionRaw.map((r) => r.divisionId).filter((x): x is string => !!x);
    const branchIds = byBranchRaw.map((r) => r.branchId).filter((x): x is string => !!x);

    const [companies, divisions, branches] = await Promise.all([
      companyIds.length
        ? this.prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([]),
      divisionIds.length
        ? this.prisma.division.findMany({
            where: { id: { in: divisionIds } },
            select: { id: true, name: true, code: true, companyId: true },
          })
        : Promise.resolve([]),
      branchIds.length
        ? this.prisma.branch.findMany({
            where: { id: { in: branchIds } },
            select: { id: true, name: true, code: true, divisionId: true },
          })
        : Promise.resolve([]),
    ]);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const divisionById = new Map(divisions.map((d) => [d.id, d]));
    const branchById = new Map(branches.map((b) => [b.id, b]));

    return {
      scope: 'GROUP',
      dateFrom,
      dateTo,
      totals: {
        orderCount: totals._count.id,
        totalAmount: Number(totals._sum.totalAmount ?? 0),
        paidAmount: Number(totals._sum.paidAmount ?? 0),
        outstandingAmount: Number(totals._sum.outstandingAmount ?? 0),
      },
      byCompany: byCompanyRaw.map((r) => ({
        companyId: r.companyId,
        companyName: companyById.get(r.companyId)?.name ?? null,
        companyCode: companyById.get(r.companyId)?.code ?? null,
        orderCount: r._count.id,
        totalAmount: Number(r._sum.totalAmount ?? 0),
        paidAmount: Number(r._sum.paidAmount ?? 0),
        outstandingAmount: Number(r._sum.outstandingAmount ?? 0),
      })),
      byDivision: byDivisionRaw.map((r) => ({
        companyId: r.companyId,
        companyName: companyById.get(r.companyId)?.name ?? null,
        divisionId: r.divisionId,
        divisionName: r.divisionId ? (divisionById.get(r.divisionId)?.name ?? null) : 'Unassigned',
        orderCount: r._count.id,
        totalAmount: Number(r._sum.totalAmount ?? 0),
        paidAmount: Number(r._sum.paidAmount ?? 0),
        outstandingAmount: Number(r._sum.outstandingAmount ?? 0),
      })),
      byBranch: byBranchRaw.map((r) => ({
        companyId: r.companyId,
        companyName: companyById.get(r.companyId)?.name ?? null,
        divisionId: r.divisionId,
        divisionName: r.divisionId ? (divisionById.get(r.divisionId)?.name ?? null) : 'Unassigned',
        branchId: r.branchId,
        branchName: r.branchId ? (branchById.get(r.branchId)?.name ?? null) : 'Unassigned',
        orderCount: r._count.id,
        totalAmount: Number(r._sum.totalAmount ?? 0),
        paidAmount: Number(r._sum.paidAmount ?? 0),
        outstandingAmount: Number(r._sum.outstandingAmount ?? 0),
      })),
    };
  }

  /**
   * Group Activity Feed — recent material events across every sector,
   * sourced from AuditLog. Filters out LOW-severity housekeeping noise so
   * what's left is the kind of thing an exec reviewer actually wants:
   * approvals, posts, settlements, closes.
   */
  async groupActivityFeed(user: AuthUser, limit = 50, severity?: string) {
    this.companyScope.assertGroupScoped(user, 'view group activity reports');
    const where: any = {};
    if (severity) where.severity = severity;

    const events = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 50, 1), 250),
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        company: { select: { id: true, name: true, code: true } },
      },
    });

    return {
      scope: 'GROUP',
      total: events.length,
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        severity: e.severity,
        when: e.createdAt,
        user: e.user ? { id: e.user.id, name: e.user.fullName ?? e.user.email } : null,
        company: e.company
          ? { id: e.company.id, name: e.company.name, code: e.company.code }
          : null,
      })),
    };
  }

  /**
   * Group Audit Trail — filtered AuditLog rollup with pagination. Designed
   * for compliance reviewers; supports filtering by entity type, action,
   * user, company, and date range.
   */
  async groupAuditTrail(
    user: AuthUser,
    query: {
      companyId?: string;
      userId?: string;
      entityType?: string;
      action?: string;
      severity?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    this.companyScope.assertGroupScoped(user, 'view group audit reports');
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.companyId) where.companyId = query.companyId;
    if (query.userId) where.userId = query.userId;
    if (query.entityType) where.entityType = query.entityType;
    if (query.action) where.action = query.action;
    if (query.severity) where.severity = query.severity;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [data, total, byEntity, byAction] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          company: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.groupBy({
        by: ['entityType'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      scope: 'GROUP',
      page,
      limit,
      total,
      data: data.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        severity: e.severity,
        ipAddress: e.ipAddress,
        when: e.createdAt,
        user: e.user ? { id: e.user.id, name: e.user.fullName ?? e.user.email } : null,
        company: e.company
          ? { id: e.company.id, name: e.company.name, code: e.company.code }
          : null,
      })),
      summary: {
        topEntities: byEntity.map((b) => ({ entityType: b.entityType, count: b._count.id })),
        topActions: byAction.map((b) => ({ action: b.action, count: b._count.id })),
      },
    };
  }
}
