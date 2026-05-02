import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { QueryDashboardDto } from './dto/query-dashboard.dto';

// SalesOrderStatus enum is { DRAFT, CONFIRMED, PARTIALLY_PAID, PAID, CANCELLED, VOIDED }.
// "CLOSED" was a stale value carried over from an earlier draft of the enum
// and caused Prisma to reject the whole `status: { in: [...] }` clause at
// runtime ("Invalid value for argument `in`. Expected SalesOrderStatus.").
// Use the actual enum constants so type-safety catches future drift.
const CONFIRMED_SALES_STATUSES = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PARTIALLY_PAID,
  SalesOrderStatus.PAID,
] as const;
const LOW_STOCK_THRESHOLD = 10;

@Injectable()
export class WestsidesDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: QueryDashboardDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const next30Days = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const branchFilter = branchId ? { branchId } : {};

    const [
      todaySalesResult,
      monthSalesResult,
      pendingDeliveries,
      activeQuotations,
      lowStockItems,
      expiringBatches,
      pendingStockDamage,
      creditReceivablesResult,
    ] = await Promise.all([
      // Sales now sourced from SalesOrder (POS module retired in W1).
      this.prisma.salesOrder.aggregate({
        where: {
          ...companyWhere,
          ...branchFilter,
          status: { in: CONFIRMED_SALES_STATUSES as unknown as SalesOrderStatus[] },
          orderDate: { gte: todayStart },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: {
          ...companyWhere,
          ...branchFilter,
          status: { in: CONFIRMED_SALES_STATUSES as unknown as SalesOrderStatus[] },
          orderDate: { gte: monthStart },
          deletedAt: null,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.deliveryNote.count({
        where: { ...companyWhere, ...branchFilter, status: 'DISPATCHED', deletedAt: null },
      }),
      this.prisma.quotation.count({
        where: { ...companyWhere, status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] }, deletedAt: null },
      }),
      this.prisma.inventoryBalance.count({
        where: { ...companyWhere, quantityOnHand: { lt: 10 } },
      }),
      this.prisma.productBatch.count({
        where: {
          ...companyWhere,
          status: 'ACTIVE',
          expiryDate: { lte: next30Days, not: null },
          deletedAt: null,
        },
      }),
      this.prisma.stockDamage.count({
        where: {
          ...companyWhere,
          ...branchFilter,
          status: { in: ['SUBMITTED', 'APPROVED'] },
          deletedAt: null,
        },
      }),
      this.prisma.receivable.aggregate({
        where: { ...companyWhere, status: { in: ['OPEN', 'OVERDUE'] as any } },
        _sum: { amount: true },
      }),
    ]);

    return {
      todaySales: todaySalesResult._sum?.totalAmount ?? 0,
      monthSales: monthSalesResult._sum?.totalAmount ?? 0,
      pendingDeliveries,
      activeQuotations,
      lowStockItems,
      expiringBatches,
      pendingStockDamage,
      creditReceivables: creditReceivablesResult._sum?.amount ?? 0,
    };
  }

  /**
   * The Westsides Cockpit — single-shot aggregate across every dimension a
   * commercial manager wants on one screen: KPIs, per-division split, stock
   * health, room occupancy, AR aging, top performers today, and a recent-
   * activity feed.
   *
   * One round-trip; computed concurrently. Auto-refreshes every 30s on the
   * frontend (opt-in) but cheap enough to call on demand.
   */
  async cockpit(query: { companyId: string; branchId?: string }, user?: AuthUser) {
    if (!query.companyId) return null;
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, query.companyId);
    }
    const { companyId, branchId } = query;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 3600 * 1000);
    const branchFilter = branchId ? { branchId } : {};

    const salesWhereToday: any = {
      companyId,
      ...branchFilter,
      status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
      orderDate: { gte: todayStart, lt: tomorrowStart },
      deletedAt: null,
    };
    const salesWhereYesterday: any = {
      ...salesWhereToday,
      orderDate: { gte: yesterdayStart, lt: todayStart },
    };

    const [
      todayAgg,
      yesterdayAgg,
      byDivisionRaw,
      arAll,
      arOverdue,
      lowStockCount,
      outOfStockCount,
      criticalSkus,
      rooms,
      bookings,
      openFolios,
      topSalespersonsRaw,
      topProductsRaw,
      recentSales,
      recentCharges,
    ] = await Promise.all([
      // Today aggregate.
      this.prisma.salesOrder.aggregate({
        where: salesWhereToday,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
        _count: { id: true },
      }),
      // Yesterday aggregate (delta tile).
      this.prisma.salesOrder.aggregate({
        where: salesWhereYesterday,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Per-division revenue split (today).
      this.prisma.salesOrder.groupBy({
        by: ['divisionId'],
        where: salesWhereToday,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // AR all-time outstanding (regardless of branch — receivables are
      // company-level).
      this.prisma.receivable.aggregate({
        where: { companyId, status: { in: ['OPEN', 'OVERDUE'] as any }, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      // AR overdue subset.
      this.prisma.receivable.aggregate({
        where: { companyId, status: 'OVERDUE' as any, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      // Stock health — low + out counts.
      this.prisma.inventoryBalance.count({
        where: { companyId, quantityOnHand: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
      }),
      this.prisma.inventoryBalance.count({
        where: { companyId, quantityOnHand: { lte: 0 } },
      }),
      // 5 most-critical SKUs (lowest stock, joined with name).
      this.prisma.inventoryBalance.findMany({
        where: { companyId, quantityOnHand: { lte: LOW_STOCK_THRESHOLD } },
        orderBy: { quantityOnHand: 'asc' },
        take: 5,
        include: {
          product: { select: { name: true, sku: true } },
          inventoryLocation: { select: { name: true } },
        },
      }),
      // Room state counts (group by status).
      this.prisma.room.groupBy({
        by: ['status'],
        where: { companyId, deletedAt: null },
        _count: { id: true },
      }),
      // Currently checked-in bookings (in-house guests).
      this.prisma.roomBooking.count({
        where: { companyId, status: 'CHECKED_IN' as any, deletedAt: null },
      }),
      // Open folios + their running tab totals.
      this.prisma.guestFolio.aggregate({
        where: { companyId, status: 'OPEN', deletedAt: null },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Top 5 salespersons today.
      this.prisma.salesOrder.groupBy({
        by: ['salespersonId'],
        where: { ...salesWhereToday, salespersonId: { not: null } },
        _sum: { totalAmount: true },
        _count: { id: true },
        orderBy: { _sum: { totalAmount: 'desc' } },
        take: 5,
      }),
      // Top 5 SKUs today (by line revenue).
      this.prisma.salesOrderLine.groupBy({
        by: ['productId'],
        where: { salesOrder: salesWhereToday },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
      // Recent sales (last 8 confirmed).
      this.prisma.salesOrder.findMany({
        where: salesWhereToday,
        orderBy: { orderDate: 'desc' },
        take: 8,
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          totalAmount: true,
          paymentMethod: true,
          customer: { select: { name: true } },
          customerName: true,
          salesperson: { select: { fullName: true } },
        },
      }),
      // Recent folio charges (last 8 across open folios) — proxy for "what
      // hospitality activity happened recently".
      this.prisma.folioCharge.findMany({
        where: { folio: { companyId, status: 'OPEN' } },
        orderBy: { postedAt: 'desc' },
        take: 8,
        include: {
          folio: { select: { folioNumber: true, guest: { select: { fullName: true } } } },
        },
      }),
    ]);

    // ── AR aging bucket query — separate Promise.all to keep above sane.
    const today00 = new Date(todayStart);
    const day = (n: number) => new Date(today00.getTime() - n * 24 * 3600 * 1000);
    const [arCurrent, ar1to30, ar31to60, ar61to90, ar90plus] = await Promise.all([
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          status: { in: ['OPEN', 'OVERDUE'] as any },
          deletedAt: null,
          dueDate: { gte: today00 },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          status: { in: ['OPEN', 'OVERDUE'] as any },
          deletedAt: null,
          dueDate: { gte: day(30), lt: today00 },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          status: { in: ['OPEN', 'OVERDUE'] as any },
          deletedAt: null,
          dueDate: { gte: day(60), lt: day(30) },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          status: { in: ['OPEN', 'OVERDUE'] as any },
          deletedAt: null,
          dueDate: { gte: day(90), lt: day(60) },
        },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          status: { in: ['OPEN', 'OVERDUE'] as any },
          deletedAt: null,
          dueDate: { lt: day(90) },
        },
        _sum: { outstandingAmount: true },
      }),
    ]);

    // ── Resolve names for groupBy results.
    const divisionIds = byDivisionRaw.map((d) => d.divisionId).filter((x): x is string => !!x);
    const divisions =
      divisionIds.length > 0
        ? await this.prisma.division.findMany({
            where: { id: { in: divisionIds } },
            select: { id: true, name: true, code: true },
          })
        : [];
    const divisionById = new Map(divisions.map((d) => [d.id, d]));

    const salespersonIds = topSalespersonsRaw
      .map((s) => s.salespersonId)
      .filter((x): x is string => !!x);
    const salespersons =
      salespersonIds.length > 0
        ? await this.prisma.employee.findMany({
            where: { id: { in: salespersonIds } },
            select: { id: true, fullName: true, employeeCode: true },
          })
        : [];
    const salespersonById = new Map(salespersons.map((e) => [e.id, e]));

    const productIds = topProductsRaw.map((p) => p.productId);
    const products =
      productIds.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, sku: true },
          })
        : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    // ── Room occupancy.
    const roomTotal = rooms.reduce((s, r) => s + r._count.id, 0);
    const roomByStatus = (status: string) => rooms.find((r) => r.status === status)?._count.id ?? 0;
    const occupancyRate = roomTotal > 0 ? (roomByStatus('OCCUPIED') / roomTotal) * 100 : 0;

    // ── Day-over-day delta.
    const todaySales = Number(todayAgg._sum.totalAmount ?? 0);
    const yesterdaySales = Number(yesterdayAgg._sum.totalAmount ?? 0);
    const dayDelta =
      yesterdaySales > 0
        ? ((todaySales - yesterdaySales) / yesterdaySales) * 100
        : todaySales > 0
          ? 100
          : 0;

    return {
      asOf: now.toISOString(),
      kpis: {
        todaySales,
        todayCount: todayAgg._count.id,
        avgTicket: todayAgg._count.id > 0 ? todaySales / todayAgg._count.id : 0,
        cashCollected: Number(todayAgg._sum.paidAmount ?? 0),
        outstandingAR: Number(arAll._sum.outstandingAmount ?? 0),
        openFoliosCount: openFolios._count.id,
        openFoliosTotal: Number(openFolios._sum.totalAmount ?? 0),
      },
      yesterday: {
        sales: yesterdaySales,
        count: yesterdayAgg._count.id,
        deltaPct: dayDelta,
      },
      byDivision: byDivisionRaw.map((d) => ({
        divisionId: d.divisionId,
        name: d.divisionId ? (divisionById.get(d.divisionId)?.name ?? null) : 'Unassigned',
        code: d.divisionId ? (divisionById.get(d.divisionId)?.code ?? null) : null,
        count: d._count.id,
        revenue: Number(d._sum.totalAmount ?? 0),
      })),
      stock: {
        outOfStock: outOfStockCount,
        lowStock: lowStockCount,
        criticalSkus: criticalSkus.map((b) => ({
          productId: b.productId,
          productName: b.product.name,
          sku: b.product.sku,
          locationName: b.inventoryLocation.name,
          quantityOnHand: Number(b.quantityOnHand),
        })),
      },
      rooms: {
        total: roomTotal,
        occupied: roomByStatus('OCCUPIED'),
        available: roomByStatus('AVAILABLE'),
        dirty: roomByStatus('DIRTY'),
        outOfOrder: roomByStatus('OUT_OF_ORDER'),
        occupancyRate,
        inHouseGuests: bookings,
      },
      arAging: {
        current: Number(arCurrent._sum.outstandingAmount ?? 0),
        days1to30: Number(ar1to30._sum.outstandingAmount ?? 0),
        days31to60: Number(ar31to60._sum.outstandingAmount ?? 0),
        days61to90: Number(ar61to90._sum.outstandingAmount ?? 0),
        days90plus: Number(ar90plus._sum.outstandingAmount ?? 0),
        overdueCount: arOverdue._count.id,
        overdueAmount: Number(arOverdue._sum.outstandingAmount ?? 0),
      },
      topSalespersons: topSalespersonsRaw.map((s) => ({
        id: s.salespersonId,
        name: s.salespersonId
          ? (salespersonById.get(s.salespersonId)?.fullName ??
            salespersonById.get(s.salespersonId)?.employeeCode ??
            null)
          : null,
        count: s._count.id,
        revenue: Number(s._sum.totalAmount ?? 0),
      })),
      topProducts: topProductsRaw.map((p) => ({
        productId: p.productId,
        name: productById.get(p.productId)?.name ?? 'Unknown',
        sku: productById.get(p.productId)?.sku ?? null,
        quantity: Number(p._sum.quantity ?? 0),
        revenue: Number(p._sum.lineTotal ?? 0),
      })),
      activity: {
        recentSales: recentSales.map((o) => ({
          id: o.id,
          kind: 'SALE' as const,
          when: o.orderDate,
          headline: `Sale ${o.salesOrderNumber} — ${o.customer?.name ?? o.customerName ?? 'Walk-in'}`,
          subline: `${o.salesperson?.fullName ?? '—'} · ${o.paymentMethod}`,
          amount: Number(o.totalAmount),
        })),
        recentCharges: recentCharges.map((c) => ({
          id: c.id,
          kind: 'FOLIO_CHARGE' as const,
          when: c.postedAt,
          headline: `${c.chargeType} — ${c.folio.guest.fullName} (${c.folio.folioNumber})`,
          subline: c.description,
          amount: Number(c.amount),
        })),
      },
    };
  }
}
