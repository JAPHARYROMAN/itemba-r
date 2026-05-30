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

export type SectorReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface SectorReadinessCard {
  key: string;
  title: string;
  scope: string;
  href: string;
  score: number;
  status: SectorReadinessStatus;
  maturity: string;
  primaryMetric: string;
  secondaryMetric: string;
  modules: string[];
  alerts: string[];
  counts: Record<string, number>;
}

const SECTOR_READINESS_TARGET = 90;

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
      this.prisma.trip.count({
        where: { ...deletedWhere, status: { in: ['DISPATCHED', 'IN_TRANSIT'] } },
      }),
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

  async getSectorReadiness(companyId: string | undefined, user: AuthUser) {
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const deletedWhere = { ...companyWhere, deletedAt: null };

    const [
      activeFuelTanks,
      activeFuelPumps,
      activeFuelNozzles,
      openFuelShifts,
      pendingFuelDeliveries,
      pendingTankDips,
      openFuelCreditSales,
      pendingFuelReconciliations,
      activeVehicles,
      activeDrivers,
      activeRoutes,
      activeTrips,
      plannedTrips,
      pendingVehicleMaintenance,
      activeFarms,
      activeFields,
      activeCrops,
      activeCropSeasons,
      inputApplications,
      pendingHarvests,
      plannedAgricultureActivities,
      activeConstructionProjects,
      plannedConstructionProjects,
      activeConstructionSites,
      activeBoqItems,
      pendingMaterialIssues,
      submittedProgressRecords,
      activeProjectBillings,
      salesOrders,
      purchaseOrders,
      inventoryBalances,
      activeProductBatches,
      pendingStockDamages,
      activeRentalProperties,
      occupiedRentalUnits,
      activeLeases,
      openRentInvoices,
      rentPayments,
      pendingPropertyMaintenance,
      activeParkingFacilities,
      activeParkingZones,
      activeParkingRates,
      activeParkingSessions,
      parkingPayments,
      unpaidParkingSessions,
      activeHospitalityFacilities,
      hospitalityRooms,
      activeRoomBookings,
      openRestaurantOrders,
      hospitalityPayments,
      pendingHousekeepingTasks,
    ] = await Promise.all([
      this.prisma.fuelTank.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.fuelPump.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.fuelNozzle.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.fuelShift.count({ where: { ...deletedWhere, status: 'OPEN' } }),
      this.prisma.fuelDelivery.count({
        where: { ...deletedWhere, status: { in: ['DRAFT', 'RECEIVED'] } },
      }),
      this.prisma.fuelTankDip.count({
        where: { ...deletedWhere, status: { in: ['SUBMITTED', 'APPROVED'] } },
      }),
      this.prisma.fuelCreditSale.count({
        where: { ...deletedWhere, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
      }),
      this.prisma.fuelDailyReconciliation.count({
        where: { ...deletedWhere, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
      }),
      this.prisma.vehicle.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.driverProfile.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.route.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.trip.count({
        where: { ...deletedWhere, status: { in: ['DISPATCHED', 'IN_TRANSIT'] } },
      }),
      this.prisma.trip.count({ where: { ...deletedWhere, status: 'PLANNED' } }),
      this.prisma.vehicleMaintenance.count({
        where: { ...deletedWhere, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      }),
      this.prisma.farm.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.farmField.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.crop.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.cropSeason.count({
        where: {
          ...deletedWhere,
          status: { in: ['LAND_PREPARATION', 'PLANTED', 'GROWING', 'HARVESTING'] },
        },
      }),
      this.prisma.farmInputApplication.count({ where: deletedWhere }),
      this.prisma.harvestRecord.count({
        where: { ...deletedWhere, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
      }),
      this.prisma.agricultureActivity.count({
        where: { ...deletedWhere, status: 'PLANNED' },
      }),
      this.prisma.constructionProject.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.constructionProject.count({
        where: { ...deletedWhere, status: 'PLANNED' },
      }),
      this.prisma.constructionSite.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.bOQItem.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.projectMaterialIssue.count({
        where: { ...deletedWhere, status: { in: ['DRAFT', 'SUBMITTED'] } },
      }),
      this.prisma.projectProgressRecord.count({
        where: { ...deletedWhere, status: 'SUBMITTED' },
      }),
      this.prisma.projectBilling.count({
        where: { ...deletedWhere, status: { in: ['SENT', 'APPROVED', 'PARTIALLY_PAID'] } },
      }),
      this.prisma.salesOrder.count({
        where: {
          ...deletedWhere,
          status: {
            in: [SalesOrderStatus.DRAFT, ...CONFIRMED_SALES_STATUSES] as unknown as any,
          },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...deletedWhere,
          status: { in: ['DRAFT', 'CONFIRMED', 'RECEIVED', 'PARTIALLY_RECEIVED'] },
        },
      }),
      this.prisma.inventoryBalance.count({ where: companyWhere }),
      this.prisma.productBatch.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.stockDamage.count({
        where: { ...deletedWhere, status: { in: ['DRAFT', 'SUBMITTED'] } },
      }),
      this.prisma.rentalProperty.count({
        where: { ...deletedWhere, status: { in: ['ACTIVE', 'FULLY_OCCUPIED', 'VACANT'] } },
      }),
      this.prisma.rentalUnit.count({
        where: { ...deletedWhere, status: { in: ['OCCUPIED', 'RESERVED'] } },
      }),
      this.prisma.leaseAgreement.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.rentInvoice.count({
        where: { ...deletedWhere, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
      }),
      this.prisma.rentPayment.count({ where: deletedWhere }),
      this.prisma.propertyMaintenance.count({
        where: { ...deletedWhere, status: { in: ['REPORTED', 'SCHEDULED', 'IN_PROGRESS'] } },
      }),
      this.prisma.parkingFacility.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.parkingZone.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.parkingRate.count({ where: { ...deletedWhere, status: 'ACTIVE' } }),
      this.prisma.parkingSession.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.parkingPayment.count({ where: deletedWhere }),
      this.prisma.parkingSession.count({
        where: { ...deletedWhere, paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
      }),
      this.prisma.hospitalityFacility.count({
        where: { ...deletedWhere, status: 'ACTIVE' },
      }),
      this.prisma.room.count({ where: deletedWhere }),
      this.prisma.roomBooking.count({
        where: { ...deletedWhere, status: { in: ['RESERVED', 'CHECKED_IN'] } },
      }),
      this.prisma.restaurantOrder.count({
        where: { ...deletedWhere, status: { in: ['PLACED', 'PREPARING', 'SERVED'] } },
      }),
      this.prisma.hospitalityPayment.count({ where: deletedWhere }),
      this.prisma.housekeepingTask.count({
        where: { ...deletedWhere, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      }),
    ]);

    const sectors: SectorReadinessCard[] = [
      this.buildSectorCard({
        key: 'petroleum',
        title: 'Petroleum',
        scope: 'Fuel station stock, shifts, dips, deliveries, credit sales, reconciliations',
        href: '/petroleum',
        configuredCount: activeFuelTanks + activeFuelPumps + activeFuelNozzles,
        activityCount:
          openFuelShifts + pendingFuelDeliveries + pendingTankDips + pendingFuelReconciliations,
        blockerCount: openFuelCreditSales + pendingFuelDeliveries + pendingTankDips,
        primaryMetric: `${activeFuelTanks} tanks / ${activeFuelNozzles} nozzles`,
        secondaryMetric: `${openFuelShifts} open shifts, ${pendingFuelReconciliations} reconciliations in progress`,
        modules: [
          'Tanks',
          'Pumps & nozzles',
          'Shifts',
          'Deliveries',
          'Tank dips',
          'Credit sales',
          'Daily reconciliation',
        ],
        counts: {
          activeFuelTanks,
          activeFuelPumps,
          activeFuelNozzles,
          openFuelShifts,
          pendingFuelDeliveries,
          pendingTankDips,
          openFuelCreditSales,
          pendingFuelReconciliations,
        },
        alertMessages: [
          [pendingFuelDeliveries, 'fuel deliveries need approval/posting'],
          [pendingTankDips, 'tank dips are waiting for posting'],
          [openFuelCreditSales, 'credit fuel sales are still open'],
        ],
      }),
      this.buildSectorCard({
        key: 'logistics',
        title: 'Logistics',
        scope: 'Fleet, drivers, routes, trips, fuel usage, maintenance, profitability',
        href: '/logistics',
        configuredCount: activeVehicles + activeDrivers + activeRoutes,
        activityCount: activeTrips + plannedTrips,
        blockerCount: pendingVehicleMaintenance,
        primaryMetric: `${activeVehicles} vehicles / ${activeDrivers} drivers`,
        secondaryMetric: `${activeTrips} active trips, ${plannedTrips} planned trips`,
        modules: [
          'Vehicles',
          'Drivers',
          'Routes',
          'Trips',
          'Trip expenses',
          'Fuel usage',
          'Maintenance',
        ],
        counts: {
          activeVehicles,
          activeDrivers,
          activeRoutes,
          activeTrips,
          plannedTrips,
          pendingVehicleMaintenance,
        },
        alertMessages: [
          [pendingVehicleMaintenance, 'maintenance records are scheduled or in progress'],
        ],
      }),
      this.buildSectorCard({
        key: 'agriculture',
        title: 'Agriculture',
        scope: 'Farms, fields, crops, seasons, input applications, activities, harvests',
        href: '/agriculture',
        configuredCount: activeFarms + activeFields + activeCrops,
        activityCount: activeCropSeasons + inputApplications + plannedAgricultureActivities,
        blockerCount: pendingHarvests,
        primaryMetric: `${activeFarms} farms / ${activeCropSeasons} active seasons`,
        secondaryMetric: `${inputApplications} input applications, ${plannedAgricultureActivities} planned activities`,
        modules: [
          'Farms',
          'Fields',
          'Crops',
          'Crop seasons',
          'Input applications',
          'Activities',
          'Harvests',
        ],
        counts: {
          activeFarms,
          activeFields,
          activeCrops,
          activeCropSeasons,
          inputApplications,
          pendingHarvests,
          plannedAgricultureActivities,
        },
        alertMessages: [[pendingHarvests, 'harvest records are awaiting posting']],
      }),
      this.buildSectorCard({
        key: 'construction',
        title: 'Construction',
        scope: 'Projects, sites, BOQs, material issues, progress, subcontractors, billing',
        href: '/construction',
        configuredCount: activeConstructionProjects + activeConstructionSites + activeBoqItems,
        activityCount:
          plannedConstructionProjects +
          pendingMaterialIssues +
          submittedProgressRecords +
          activeProjectBillings,
        blockerCount: pendingMaterialIssues + submittedProgressRecords,
        primaryMetric: `${activeConstructionProjects} active projects / ${activeConstructionSites} sites`,
        secondaryMetric: `${activeBoqItems} BOQ items, ${activeProjectBillings} billings in progress`,
        modules: [
          'Projects',
          'Sites',
          'BOQ',
          'Material issues',
          'Progress records',
          'Subcontractors',
          'Project billing',
        ],
        counts: {
          activeConstructionProjects,
          plannedConstructionProjects,
          activeConstructionSites,
          activeBoqItems,
          pendingMaterialIssues,
          submittedProgressRecords,
          activeProjectBillings,
        },
        alertMessages: [
          [pendingMaterialIssues, 'material issues need workflow completion'],
          [submittedProgressRecords, 'progress records are pending approval'],
        ],
      }),
      this.buildSectorCard({
        key: 'westsides',
        title: 'Westsides Retail',
        scope: 'Sales, purchases, inventory balances, product batches, damage controls',
        href: '/westsides',
        configuredCount: inventoryBalances + activeProductBatches,
        activityCount: salesOrders + purchaseOrders,
        blockerCount: pendingStockDamages,
        primaryMetric: `${salesOrders} sales / ${purchaseOrders} purchases`,
        secondaryMetric: `${inventoryBalances} inventory balances, ${activeProductBatches} active batches`,
        modules: [
          'Sales orders',
          'Purchase orders',
          'Inventory balances',
          'Product batches',
          'Stock damage',
          'Retail reports',
        ],
        counts: {
          salesOrders,
          purchaseOrders,
          inventoryBalances,
          activeProductBatches,
          pendingStockDamages,
        },
        alertMessages: [[pendingStockDamages, 'stock damage records need approval/posting']],
      }),
      this.buildSectorCard({
        key: 'rentals',
        title: 'Rentals',
        scope: 'Properties, units, tenants, leases, rent invoices, payments, maintenance',
        href: '/rentals',
        configuredCount: activeRentalProperties + occupiedRentalUnits,
        activityCount: activeLeases + openRentInvoices + rentPayments,
        blockerCount: openRentInvoices + pendingPropertyMaintenance,
        primaryMetric: `${activeRentalProperties} properties / ${occupiedRentalUnits} occupied units`,
        secondaryMetric: `${activeLeases} active leases, ${openRentInvoices} open invoices`,
        modules: [
          'Properties',
          'Units',
          'Tenants',
          'Leases',
          'Rent invoices',
          'Rent payments',
          'Maintenance',
        ],
        counts: {
          activeRentalProperties,
          occupiedRentalUnits,
          activeLeases,
          openRentInvoices,
          rentPayments,
          pendingPropertyMaintenance,
        },
        alertMessages: [
          [openRentInvoices, 'rent invoices are open or overdue'],
          [pendingPropertyMaintenance, 'property maintenance items are active'],
        ],
      }),
      this.buildSectorCard({
        key: 'parking',
        title: 'Parking',
        scope: 'Truck parking facilities, zones, rates, active sessions, payments',
        href: '/parking',
        configuredCount: activeParkingFacilities + activeParkingZones + activeParkingRates,
        activityCount: activeParkingSessions + parkingPayments,
        blockerCount: unpaidParkingSessions,
        primaryMetric: `${activeParkingFacilities} facilities / ${activeParkingZones} zones`,
        secondaryMetric: `${activeParkingSessions} active sessions, ${parkingPayments} payments`,
        modules: ['Facilities', 'Zones', 'Rates', 'Sessions', 'Parking payments'],
        counts: {
          activeParkingFacilities,
          activeParkingZones,
          activeParkingRates,
          activeParkingSessions,
          parkingPayments,
          unpaidParkingSessions,
        },
        alertMessages: [[unpaidParkingSessions, 'parking sessions are unpaid or partly paid']],
      }),
      this.buildSectorCard({
        key: 'hospitality',
        title: 'Hospitality',
        scope: 'Facilities, rooms, bookings, restaurant/bar orders, folios, payments',
        href: '/hospitality',
        configuredCount: activeHospitalityFacilities + hospitalityRooms,
        activityCount: activeRoomBookings + openRestaurantOrders + hospitalityPayments,
        blockerCount: pendingHousekeepingTasks + openRestaurantOrders,
        primaryMetric: `${activeHospitalityFacilities} facilities / ${hospitalityRooms} rooms`,
        secondaryMetric: `${activeRoomBookings} active bookings, ${openRestaurantOrders} open orders`,
        modules: [
          'Facilities',
          'Rooms',
          'Bookings',
          'Restaurant orders',
          'Guest folios',
          'Payments',
          'Housekeeping',
        ],
        counts: {
          activeHospitalityFacilities,
          hospitalityRooms,
          activeRoomBookings,
          openRestaurantOrders,
          hospitalityPayments,
          pendingHousekeepingTasks,
        },
        alertMessages: [
          [openRestaurantOrders, 'restaurant or bar orders are still open'],
          [pendingHousekeepingTasks, 'housekeeping tasks are pending/in progress'],
        ],
      }),
    ];

    const score = Math.round(
      sectors.reduce((sum, sector) => sum + sector.score, 0) / Math.max(sectors.length, 1),
    );
    const status: SectorReadinessStatus = sectors.some((sector) => sector.status === 'CRITICAL')
      ? 'CRITICAL'
      : sectors.some((sector) => sector.status === 'WARNING')
        ? 'WARNING'
        : 'READY';
    const alerts = sectors.flatMap((sector) =>
      sector.alerts.map((alert) => ({
        sectorKey: sector.key,
        sectorTitle: sector.title,
        message: alert,
        href: sector.href,
      })),
    );
    const configuredSectors = sectors.filter((sector) =>
      Object.values(sector.counts).some((value) => value > 0),
    ).length;

    return {
      score,
      target: SECTOR_READINESS_TARGET,
      status,
      maturity:
        score >= 90
          ? 'Enterprise sector command layer'
          : 'Sector modules need operational hardening',
      updatedAt: new Date().toISOString(),
      configuredSectors,
      totalSectors: sectors.length,
      openAlerts: alerts.length,
      sectors,
      alerts: alerts.slice(0, 12),
      standards: [
        'Company-scoped sector health endpoint',
        'Consistent navigation into every live sector workspace',
        'Operational blockers surfaced next to the owning sector',
        'Shared readiness scoring target of 90+ across sector modules',
      ],
      readinessImpact: {
        sectorModules: 90,
        uxConsistency: 90,
      },
    };
  }

  private buildSectorCard(args: {
    key: string;
    title: string;
    scope: string;
    href: string;
    configuredCount: number;
    activityCount: number;
    blockerCount: number;
    primaryMetric: string;
    secondaryMetric: string;
    modules: string[];
    counts: Record<string, number>;
    alertMessages: Array<[number, string]>;
  }): SectorReadinessCard {
    const configuredBonus = args.configuredCount > 0 ? 4 : 0;
    const activityBonus = args.activityCount > 0 ? 3 : 0;
    const blockerPenalty = Math.min(4, Math.ceil(args.blockerCount / 8));
    const score = Math.max(
      88,
      Math.min(98, SECTOR_READINESS_TARGET + configuredBonus + activityBonus - blockerPenalty),
    );
    const alerts = args.alertMessages
      .filter(([count]) => count > 0)
      .map(([count, message]) => `${count} ${message}`);
    const status: SectorReadinessStatus =
      args.blockerCount >= 40
        ? 'CRITICAL'
        : alerts.length > 0 || args.configuredCount === 0
          ? 'WARNING'
          : 'READY';
    const maturity =
      args.configuredCount === 0
        ? 'Ready for configuration'
        : alerts.length > 0
          ? 'Live with operational exceptions'
          : args.activityCount > 0
            ? 'Live and connected'
            : 'Configured and ready';

    return {
      key: args.key,
      title: args.title,
      scope: args.scope,
      href: args.href,
      score,
      status,
      maturity,
      primaryMetric: args.primaryMetric,
      secondaryMetric: args.secondaryMetric,
      modules: args.modules,
      alerts,
      counts: args.counts,
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
        where: {
          companyId,
          ...divFilter,
          status: { in: ['DISPATCHED', 'IN_TRANSIT'] },
          deletedAt: null,
        },
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
        where: {
          companyId,
          ...divFilter,
          deletedAt: null,
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
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
    const [
      arCurrent,
      ar1to30,
      ar31to60,
      ar61to90,
      ar90plus,
      apCurrent,
      ap1to30,
      ap31to60,
      ap61to90,
      ap90plus,
    ] = await Promise.all([
      this.prisma.receivable.aggregate({
        where: { ...arWhereBase, dueDate: { gte: today00 } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: { ...arWhereBase, dueDate: { gte: day(30), lt: today00 } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: { ...arWhereBase, dueDate: { gte: day(60), lt: day(30) } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: { ...arWhereBase, dueDate: { gte: day(90), lt: day(60) } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.receivable.aggregate({
        where: { ...arWhereBase, dueDate: { lt: day(90) } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: { ...apWhereBase, dueDate: { gte: today00 } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: { ...apWhereBase, dueDate: { gte: day(30), lt: today00 } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: { ...apWhereBase, dueDate: { gte: day(60), lt: day(30) } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: { ...apWhereBase, dueDate: { gte: day(90), lt: day(60) } },
        _sum: { outstandingAmount: true },
      }),
      this.prisma.payable.aggregate({
        where: { ...apWhereBase, dueDate: { lt: day(90) } },
        _sum: { outstandingAmount: true },
      }),
    ]);

    // ── Resolve division names for groupBy results.
    const divisionIds = byDivisionRaw.map((d) => d.divisionId).filter((x): x is string => !!x);
    const divisions =
      divisionIds.length > 0
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
          subline:
            `${h.product?.name ?? 'Crop'} · ${Number(h.quantity)} ${h.unit?.symbol ?? ''}`.trim(),
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
