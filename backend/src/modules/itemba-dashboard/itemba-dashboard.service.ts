import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
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
export class ItembaDashboardService {
  constructor(
    private prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(companyId: string | undefined, user: AuthUser) {
    const where = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const deletedWhere = { ...where, deletedAt: null };

    const [
      totalVehicles,
      activeTrips,
      totalFarms,
      activeProjects,
      totalLaborRecords,
      unpaidLaborCount,
    ] = await this.prisma.$transaction([
      this.prisma.vehicle.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.trip.count({ where: { ...deletedWhere, status: { in: ['DISPATCHED', 'IN_TRANSIT'] } } }),
      this.prisma.farm.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.constructionProject.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.laborRecord.count({ where: deletedWhere }),
      this.prisma.laborRecord.count({ where: { ...deletedWhere, paymentStatus: 'UNPAID' } }),
    ]);

    return {
      logistics: { totalActiveVehicles: totalVehicles, activeTrips },
      agriculture: { totalActiveFarms: totalFarms },
      construction: { totalActiveProjects: activeProjects },
      labor: { totalLaborRecords, unpaidLaborCount },
    };
  }

  /**
   * The Itemba Cockpit — single-shot capstone aggregate spanning all three
   * Itemba sub-divisions (construction, logistics, agriculture). Mirrors the
   * Westsides cockpit shape so the frontend can lean on the same patterns:
   * KPIs, per-division revenue split, sub-division panels, AR/AP aging, and
   * a recent-activity feed.
   *
   * One round-trip; computed concurrently. Cheap enough for on-demand calls
   * and the 30-second auto-refresh on the cockpit page.
   */
  async cockpit(query: { companyId: string; divisionId?: string }, user?: AuthUser) {
    if (!query.companyId) return null;
    const { companyId, divisionId } = query;
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 3600 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const divFilter = divisionId ? { divisionId } : {};

    const salesWhereMTD: any = {
      companyId,
      ...divFilter,
      status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
      orderDate: { gte: monthStart },
      deletedAt: null,
    };

    const [
      // KPIs — counts.
      activeProjectsCount,
      activeTripsCount,
      activeFarmsCount,
      activeCropSeasonsCount,
      // KPIs — money.
      mtdSalesAgg,
      arOutstandingAgg,
      apOutstandingAgg,
      // Per-division revenue split (MTD).
      byDivisionRaw,
      // Construction panel.
      projectsByStatus,
      projectAggregate,
      topProjects,
      // Logistics panel.
      fleetTotal,
      tripsByStatus,
      tripsClosedToday,
      tripsRevenueMTD,
      tripsCostMTD,
      tripsFuelCostMTD,
      topRoutesRaw,
      // Agriculture panel.
      cropSeasonsByStatus,
      cropYieldAgg,
      recentHarvests,
      // Activity feed.
      recentTrips,
      recentBillings,
      recentSubcontractorClaims,
      // AR/AP raw counts for cards.
      arOverdueAgg,
      apOverdueAgg,
    ] = await Promise.all([
      this.prisma.constructionProject.count({
        where: { companyId, ...divFilter, status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.trip.count({
        where: { companyId, ...divFilter, status: { in: ['DISPATCHED', 'IN_TRANSIT'] }, deletedAt: null },
      }),
      this.prisma.farm.count({
        where: { companyId, ...divFilter, status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.cropSeason.count({
        where: {
          companyId,
          ...divFilter,
          status: { in: ['LAND_PREPARATION', 'PLANTED', 'GROWING', 'HARVESTING'] },
          deletedAt: null,
        },
      }),
      this.prisma.salesOrder.aggregate({
        where: salesWhereMTD,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.receivable.aggregate({
        where: { companyId, status: { in: ['OPEN', 'OVERDUE'] as any }, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.payable.aggregate({
        where: { companyId, status: { in: ['OPEN', 'PARTIALLY_PAID'] as any }, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['divisionId'],
        where: salesWhereMTD,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Construction.
      this.prisma.constructionProject.groupBy({
        by: ['status'],
        where: { companyId, ...divFilter, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.constructionProject.aggregate({
        where: { companyId, ...divFilter, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] } },
        _sum: { contractValue: true, billedAmount: true, receivedAmount: true, actualCost: true },
      }),
      this.prisma.constructionProject.findMany({
        where: { companyId, ...divFilter, deletedAt: null, status: 'ACTIVE' },
        orderBy: { contractValue: 'desc' },
        take: 5,
        select: {
          id: true,
          projectCode: true,
          projectName: true,
          status: true,
          contractValue: true,
          billedAmount: true,
          receivedAmount: true,
          actualCost: true,
          currency: true,
          division: { select: { id: true, name: true, code: true } },
        },
      }),
      // Logistics.
      this.prisma.vehicle.count({
        where: { companyId, ...divFilter, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.trip.groupBy({
        by: ['status'],
        where: { companyId, ...divFilter, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.trip.count({
        where: {
          companyId,
          ...divFilter,
          deletedAt: null,
          status: { in: ['COMPLETED', 'CLOSED'] },
          actualReturnDate: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      this.prisma.trip.aggregate({
        where: {
          companyId,
          ...divFilter,
          deletedAt: null,
          tripDate: { gte: monthStart },
        },
        _sum: { revenueAmount: true },
      }),
      this.prisma.tripExpense.aggregate({
        where: {
          deletedAt: null,
          trip: { companyId, ...divFilter, deletedAt: null, tripDate: { gte: monthStart } },
        },
        _sum: { amount: true },
      }),
      this.prisma.tripFuelUsage.aggregate({
        where: {
          deletedAt: null,
          trip: { companyId, ...divFilter, deletedAt: null, tripDate: { gte: monthStart } },
        },
        _sum: { totalCost: true },
      }),
      this.prisma.trip.groupBy({
        by: ['origin', 'destination'],
        where: { companyId, ...divFilter, deletedAt: null, tripDate: { gte: monthStart } },
        _sum: { revenueAmount: true },
        _count: { id: true },
        orderBy: { _sum: { revenueAmount: 'desc' } },
        take: 5,
      }),
      // Agriculture.
      this.prisma.cropSeason.groupBy({
        by: ['status'],
        where: { companyId, ...divFilter, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.cropSeason.aggregate({
        where: { companyId, ...divFilter, deletedAt: null },
        _sum: { actualYield: true, expectedYield: true, actualCost: true, revenueAmount: true },
      }),
      this.prisma.harvestRecord.findMany({
        where: { companyId, ...divFilter, deletedAt: null, status: 'POSTED' },
        orderBy: { harvestDate: 'desc' },
        take: 5,
        select: {
          id: true,
          harvestNumber: true,
          harvestDate: true,
          quantity: true,
          estimatedTotalValue: true,
          farm: { select: { name: true } },
          product: { select: { name: true } },
          unit: { select: { symbol: true } },
        },
      }),
      // Activity feed — recent trips (last 5 closed/in-transit).
      this.prisma.trip.findMany({
        where: {
          companyId,
          ...divFilter,
          deletedAt: null,
          status: { in: ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CLOSED'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          tripNumber: true,
          status: true,
          origin: true,
          destination: true,
          tripDate: true,
          revenueAmount: true,
          customerName: true,
          updatedAt: true,
        },
      }),
      this.prisma.projectBilling.findMany({
        where: {
          companyId,
          ...divFilter,
          deletedAt: null,
          status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          billingNumber: true,
          status: true,
          amount: true,
          updatedAt: true,
          project: { select: { projectCode: true, projectName: true } },
        },
      }),
      this.prisma.subcontractorRecord.findMany({
        where: {
          companyId,
          ...divFilter,
          deletedAt: null,
          paidAmount: { gt: 0 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          subcontractorCode: true,
          name: true,
          paidAmount: true,
          outstandingAmount: true,
          updatedAt: true,
          project: { select: { projectCode: true, projectName: true } },
        },
      }),
      this.prisma.receivable.aggregate({
        where: { companyId, status: 'OVERDUE' as any, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
      this.prisma.payable.aggregate({
        where: { companyId, status: 'OVERDUE' as any, deletedAt: null },
        _sum: { outstandingAmount: true },
        _count: { id: true },
      }),
    ]);

    // ── AR aging buckets (5 standard).
    const today00 = new Date(todayStart);
    const day = (n: number) => new Date(today00.getTime() - n * 24 * 3600 * 1000);
    const arWhereBase = {
      companyId,
      status: { in: ['OPEN', 'OVERDUE'] as any },
      deletedAt: null,
    };
    const apWhereBase = {
      companyId,
      status: { in: ['OPEN', 'PARTIALLY_PAID'] as any },
      deletedAt: null,
    };
    const [arCurrent, ar1to30, ar31to60, ar61to90, ar90plus, apCurrent, ap1to30, ap31to60, ap61to90, ap90plus] = await Promise.all([
      this.prisma.receivable.aggregate({ where: { ...arWhereBase, dueDate: { gte: today00 } }, _sum: { outstandingAmount: true } }),
      this.prisma.receivable.aggregate({ where: { ...arWhereBase, dueDate: { gte: day(30), lt: today00 } }, _sum: { outstandingAmount: true } }),
      this.prisma.receivable.aggregate({ where: { ...arWhereBase, dueDate: { gte: day(60), lt: day(30) } }, _sum: { outstandingAmount: true } }),
      this.prisma.receivable.aggregate({ where: { ...arWhereBase, dueDate: { gte: day(90), lt: day(60) } }, _sum: { outstandingAmount: true } }),
      this.prisma.receivable.aggregate({ where: { ...arWhereBase, dueDate: { lt: day(90) } }, _sum: { outstandingAmount: true } }),
      this.prisma.payable.aggregate({ where: { ...apWhereBase, dueDate: { gte: today00 } }, _sum: { outstandingAmount: true } }),
      this.prisma.payable.aggregate({ where: { ...apWhereBase, dueDate: { gte: day(30), lt: today00 } }, _sum: { outstandingAmount: true } }),
      this.prisma.payable.aggregate({ where: { ...apWhereBase, dueDate: { gte: day(60), lt: day(30) } }, _sum: { outstandingAmount: true } }),
      this.prisma.payable.aggregate({ where: { ...apWhereBase, dueDate: { gte: day(90), lt: day(60) } }, _sum: { outstandingAmount: true } }),
      this.prisma.payable.aggregate({ where: { ...apWhereBase, dueDate: { lt: day(90) } }, _sum: { outstandingAmount: true } }),
    ]);

    // ── Resolve division names for groupBy results.
    const divisionIds = byDivisionRaw.map((d) => d.divisionId).filter((x): x is string => !!x);
    const divisions = divisionIds.length > 0
      ? await this.prisma.division.findMany({
          where: { id: { in: divisionIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const divisionById = new Map(divisions.map((d) => [d.id, d]));

    // ── Status-bucket helpers.
    const projectStatusCount = (s: string) =>
      projectsByStatus.find((p) => p.status === s)?._count.id ?? 0;
    const tripStatusCount = (s: string) =>
      tripsByStatus.find((t) => t.status === s)?._count.id ?? 0;
    const cropStatusCount = (s: string) =>
      cropSeasonsByStatus.find((c) => c.status === s)?._count.id ?? 0;

    const tripsRevenue = Number(tripsRevenueMTD._sum.revenueAmount ?? 0);
    const tripsCost =
      Number(tripsCostMTD._sum.amount ?? 0) + Number(tripsFuelCostMTD._sum.totalCost ?? 0);

    return {
      asOf: now.toISOString(),
      kpis: {
        activeProjects: activeProjectsCount,
        activeTrips: activeTripsCount,
        activeFarms: activeFarmsCount,
        activeCropSeasons: activeCropSeasonsCount,
        revenueMTD: Number(mtdSalesAgg._sum.totalAmount ?? 0),
        revenueOrderCount: mtdSalesAgg._count.id,
        cashCollectedMTD: Number(mtdSalesAgg._sum.paidAmount ?? 0),
        arOutstanding: Number(arOutstandingAgg._sum.outstandingAmount ?? 0),
        arOpenCount: arOutstandingAgg._count.id,
        apOutstanding: Number(apOutstandingAgg._sum.outstandingAmount ?? 0),
        apOpenCount: apOutstandingAgg._count.id,
      },
      byDivision: byDivisionRaw.map((d) => ({
        divisionId: d.divisionId,
        name: d.divisionId ? (divisionById.get(d.divisionId)?.name ?? null) : 'Unassigned',
        code: d.divisionId ? (divisionById.get(d.divisionId)?.code ?? null) : null,
        count: d._count.id,
        revenue: Number(d._sum.totalAmount ?? 0),
      })),
      construction: {
        active: projectStatusCount('ACTIVE'),
        planned: projectStatusCount('PLANNED'),
        onHold: projectStatusCount('ON_HOLD'),
        completed: projectStatusCount('COMPLETED'),
        closed: projectStatusCount('CLOSED'),
        contractValueTotal: Number(projectAggregate._sum.contractValue ?? 0),
        billedTotal: Number(projectAggregate._sum.billedAmount ?? 0),
        receivedTotal: Number(projectAggregate._sum.receivedAmount ?? 0),
        actualCostTotal: Number(projectAggregate._sum.actualCost ?? 0),
        topProjects: topProjects.map((p) => {
          const billed = Number(p.billedAmount);
          const cost = Number(p.actualCost);
          const contract = Number(p.contractValue ?? 0);
          return {
            id: p.id,
            code: p.projectCode,
            name: p.projectName,
            status: p.status,
            divisionName: p.division?.name ?? null,
            currency: p.currency,
            contractValue: contract,
            billed,
            received: Number(p.receivedAmount),
            actualCost: cost,
            profitToDate: billed - cost,
            billedPct: contract > 0 ? (billed / contract) * 100 : 0,
          };
        }),
      },
      logistics: {
        fleetTotal,
        plannedTrips: tripStatusCount('PLANNED'),
        activeTrips: tripStatusCount('DISPATCHED') + tripStatusCount('IN_TRANSIT'),
        completedTrips: tripStatusCount('COMPLETED'),
        closedTrips: tripStatusCount('CLOSED'),
        cancelledTrips: tripStatusCount('CANCELLED'),
        completedToday: tripsClosedToday,
        revenueMTD: tripsRevenue,
        costMTD: tripsCost,
        profitMTD: tripsRevenue - tripsCost,
        profitMarginMTD: tripsRevenue > 0 ? ((tripsRevenue - tripsCost) / tripsRevenue) * 100 : 0,
        topRoutes: topRoutesRaw.map((r) => ({
          origin: r.origin,
          destination: r.destination,
          count: r._count.id,
          revenue: Number(r._sum.revenueAmount ?? 0),
        })),
      },
      agriculture: {
        farmsActive: activeFarmsCount,
        cropsPlanned: cropStatusCount('PLANNED'),
        cropsInSeason:
          cropStatusCount('LAND_PREPARATION') +
          cropStatusCount('PLANTED') +
          cropStatusCount('GROWING') +
          cropStatusCount('HARVESTING'),
        cropsHarvested: cropStatusCount('HARVESTED'),
        cropsClosed: cropStatusCount('CLOSED'),
        totalActualYield: Number(cropYieldAgg._sum.actualYield ?? 0),
        totalExpectedYield: Number(cropYieldAgg._sum.expectedYield ?? 0),
        totalSeasonCost: Number(cropYieldAgg._sum.actualCost ?? 0),
        totalSeasonRevenue: Number(cropYieldAgg._sum.revenueAmount ?? 0),
        recentHarvests: recentHarvests.map((h) => ({
          id: h.id,
          harvestNumber: h.harvestNumber,
          harvestDate: h.harvestDate,
          farmName: h.farm.name,
          productName: h.product?.name ?? null,
          quantity: Number(h.quantity),
          unit: h.unit?.symbol ?? null,
          totalValue: Number(h.estimatedTotalValue ?? 0),
        })),
      },
      arAging: {
        current: Number(arCurrent._sum.outstandingAmount ?? 0),
        days1to30: Number(ar1to30._sum.outstandingAmount ?? 0),
        days31to60: Number(ar31to60._sum.outstandingAmount ?? 0),
        days61to90: Number(ar61to90._sum.outstandingAmount ?? 0),
        days90plus: Number(ar90plus._sum.outstandingAmount ?? 0),
        overdueCount: arOverdueAgg._count.id,
        overdueAmount: Number(arOverdueAgg._sum.outstandingAmount ?? 0),
      },
      apAging: {
        current: Number(apCurrent._sum.outstandingAmount ?? 0),
        days1to30: Number(ap1to30._sum.outstandingAmount ?? 0),
        days31to60: Number(ap31to60._sum.outstandingAmount ?? 0),
        days61to90: Number(ap61to90._sum.outstandingAmount ?? 0),
        days90plus: Number(ap90plus._sum.outstandingAmount ?? 0),
        overdueCount: apOverdueAgg._count.id,
        overdueAmount: Number(apOverdueAgg._sum.outstandingAmount ?? 0),
      },
      activity: {
        recentTrips: recentTrips.map((t) => ({
          id: t.id,
          kind: 'TRIP' as const,
          when: t.updatedAt,
          headline: `${t.tripNumber} — ${t.origin} → ${t.destination}`,
          subline: `${t.status} · ${t.customerName ?? 'Internal'}`,
          amount: Number(t.revenueAmount),
        })),
        recentBillings: recentBillings.map((b) => ({
          id: b.id,
          kind: 'PROJECT_BILLING' as const,
          when: b.updatedAt,
          headline: `${b.billingNumber} — ${b.project?.projectName ?? 'Project'}`,
          subline: `${b.status}`,
          amount: Number(b.amount),
        })),
        recentHarvests: recentHarvests.map((h) => ({
          id: h.id,
          kind: 'HARVEST' as const,
          when: h.harvestDate,
          headline: `${h.harvestNumber} — ${h.farm.name}`,
          subline: `${h.product?.name ?? 'Crop'} · ${Number(h.quantity)} ${h.unit?.symbol ?? ''}`.trim(),
          amount: Number(h.estimatedTotalValue ?? 0),
        })),
        recentSubcontractorPayments: recentSubcontractorClaims.map((s) => ({
          id: s.id,
          kind: 'SUBCONTRACTOR_PAYMENT' as const,
          when: s.updatedAt,
          headline: `${s.subcontractorCode} — ${s.name}`,
          subline: s.project ? `${s.project.projectCode} · ${s.project.projectName}` : '',
          amount: Number(s.paidAmount),
        })),
      },
    };
  }
}
