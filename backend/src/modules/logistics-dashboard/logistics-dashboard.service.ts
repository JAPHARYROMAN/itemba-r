import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class LogisticsDashboardService {
  constructor(
    private prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(companyId: string | undefined, user: AuthUser) {
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const baseWhere: any = { deletedAt: null, ...companyWhere };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const [
      totalVehicles,
      activeVehicles,
      inMaintenanceVehicles,
      totalDrivers,
      activeDrivers,
      totalRoutes,
      totalTrips,
      activeTrips,
      completedTrips,
      plannedTrips,
      pendingMaintenance,
    ] = await this.prisma.$transaction([
      this.prisma.vehicle.count({ where: baseWhere }),
      this.prisma.vehicle.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.prisma.vehicle.count({ where: { ...baseWhere, status: 'UNDER_MAINTENANCE' } }),
      this.prisma.driverProfile.count({ where: baseWhere }),
      this.prisma.driverProfile.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.prisma.route.count({ where: baseWhere }),
      this.prisma.trip.count({ where: baseWhere }),
      this.prisma.trip.count({ where: { ...baseWhere, status: { in: ['DISPATCHED', 'IN_TRANSIT'] } } }),
      this.prisma.trip.count({ where: { ...baseWhere, status: { in: ['COMPLETED', 'CLOSED'] } } }),
      this.prisma.trip.count({ where: { ...baseWhere, status: 'PLANNED' } }),
      this.prisma.vehicleMaintenance.count({ where: { ...baseWhere, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } } }),
    ]);

    const revenueAgg = await this.prisma.trip.aggregate({
      _sum: { revenueAmount: true },
      where: {
        ...companyWhere,
        deletedAt: null,
        status: { in: ['COMPLETED', 'CLOSED'] },
        tripDate: { gte: startOfMonth },
      },
    });

    const recentTripsRaw = await this.prisma.trip.findMany({
      where: { ...companyWhere, deletedAt: null, status: { not: 'CANCELLED' } },
      orderBy: { tripDate: 'desc' },
      take: 5,
      include: {
        vehicle: { select: { registrationNumber: true } },
        driver: { select: { fullName: true } },
      },
    });

    const maintenanceDueSoonRaw = await this.prisma.vehicleMaintenance.findMany({
      where: {
        ...companyWhere,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        OR: [{ nextServiceDate: { lte: thirtyDaysFromNow } }, { nextServiceDate: null }],
      },
      include: {
        vehicle: { select: { vehicleCode: true, registrationNumber: true, currentOdometer: true } },
      },
      take: 10,
    });

    const recentTrips = recentTripsRaw.map((t) => ({
      id: t.id,
      tripNumber: t.tripNumber,
      origin: t.origin,
      destination: t.destination,
      status: t.status,
      revenueAmount: Number(t.revenueAmount ?? 0),
      tripDate: t.tripDate?.toISOString() ?? null,
      vehiclePlate: t.vehicle?.registrationNumber ?? '',
      driverName: t.driver?.fullName ?? '',
    }));

    const maintenanceDueSoon = maintenanceDueSoonRaw.map((m) => ({
      vehicleId: m.vehicleId,
      vehicleCode: m.vehicle?.vehicleCode ?? '',
      registrationNumber: m.vehicle?.registrationNumber ?? '',
      nextServiceDate: m.nextServiceDate?.toISOString() ?? null,
      nextServiceOdometer: Number(m.nextServiceOdometer ?? 0),
      currentOdometer: Number(m.vehicle?.currentOdometer ?? 0),
    }));

    return {
      vehicles: { total: totalVehicles, active: activeVehicles, inMaintenance: inMaintenanceVehicles },
      drivers: { total: totalDrivers, active: activeDrivers },
      routes: { total: totalRoutes },
      trips: {
        total: totalTrips,
        active: activeTrips,
        completed: completedTrips,
        planned: plannedTrips,
        thisMonthRevenue: Number(revenueAgg._sum.revenueAmount ?? 0),
      },
      pendingMaintenance,
      recentTrips,
      maintenanceDueSoon,
    };
  }

  async getReportTripProfitability(
    companyId: string | undefined,
    from: string | undefined,
    to: string | undefined,
    user?: AuthUser,
  ) {
    const where: any = {
      deletedAt: null,
      status: { in: ['COMPLETED', 'CLOSED'] },
      ...(user ? await this.companyScope.companyWhereFor(user, companyId) : companyId ? { companyId } : {}),
    };
    if (from) where.tripDate = { ...where.tripDate, gte: new Date(from) };
    if (to) where.tripDate = { ...where.tripDate, lte: new Date(to) };

    const trips = await this.prisma.trip.findMany({
      where,
      orderBy: { tripDate: 'desc' },
      include: {
        vehicle: { select: { registrationNumber: true, vehicleCode: true } },
        driver: { select: { fullName: true } },
        expenses: { where: { deletedAt: null }, select: { amount: true } },
        fuelUsage: { where: { deletedAt: null }, select: { totalCost: true } },
      },
    });

    const tripData = trips.map((t) => {
      const revenue = Number(t.revenueAmount ?? 0);
      const expenses = t.expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
      const fuel = t.fuelUsage.reduce((s, f) => s + Number(f.totalCost ?? 0), 0);
      const profit = revenue - expenses - fuel;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return {
        id: t.id,
        tripNumber: t.tripNumber,
        origin: t.origin,
        destination: t.destination,
        vehiclePlate: t.vehicle?.registrationNumber ?? '',
        vehicleCode: t.vehicle?.vehicleCode ?? '',
        driverName: t.driver?.fullName ?? '',
        tripDate: t.tripDate?.toISOString() ?? null,
        revenue,
        expenses,
        fuel,
        profit,
        margin: Math.round(margin * 100) / 100,
      };
    });

    const totalRevenue = tripData.reduce((s, t) => s + t.revenue, 0);
    const totalExpenses = tripData.reduce((s, t) => s + t.expenses, 0);
    const totalFuelCost = tripData.reduce((s, t) => s + t.fuel, 0);
    const netProfit = totalRevenue - totalExpenses - totalFuelCost;
    const marginPercent = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 10000) / 100 : 0;

    return {
      summary: {
        totalRevenue,
        totalExpenses,
        totalFuelCost,
        netProfit,
        marginPercent,
        tripCount: tripData.length,
      },
      trips: tripData,
    };
  }

  async getReportFleetUtilization(companyId: string | undefined, user: AuthUser) {
    const vehicleWhere: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };

    const vehicles = await this.prisma.vehicle.findMany({
      where: vehicleWhere,
      select: {
        id: true,
        vehicleCode: true,
        registrationNumber: true,
        currentOdometer: true,
        trips: {
          where: { deletedAt: null },
          select: {
            revenueAmount: true,
            fuelUsage: {
              where: { deletedAt: null },
              select: { odometerBefore: true, odometerAfter: true },
            },
          },
        },
        maintenanceRecords: {
          where: { deletedAt: null },
          select: { costAmount: true },
        },
      },
    });

    return vehicles.map((v) => {
      const tripCount = v.trips.length;
      const totalRevenue = v.trips.reduce((s, t) => s + Number(t.revenueAmount ?? 0), 0);
      const totalKmDriven = v.trips.reduce((s, t) => {
        return s + t.fuelUsage.reduce((fs, f) => {
          const km = Number(f.odometerAfter ?? 0) - Number(f.odometerBefore ?? 0);
          return fs + (km > 0 ? km : 0);
        }, 0);
      }, 0);
      const totalMaintenanceCost = v.maintenanceRecords.reduce((s, m) => s + Number(m.costAmount ?? 0), 0);
      return {
        vehicleCode: v.vehicleCode,
        registrationNumber: v.registrationNumber,
        currentOdometer: Number(v.currentOdometer ?? 0),
        tripCount,
        totalRevenue,
        totalKmDriven,
        totalMaintenanceCost,
      };
    });
  }

  async getReportFuelEfficiency(companyId: string | undefined, user: AuthUser) {
    const vehicleWhere: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };

    const vehicles = await this.prisma.vehicle.findMany({
      where: vehicleWhere,
      select: {
        id: true,
        vehicleCode: true,
        registrationNumber: true,
        fuelUsageRecords: {
          where: { deletedAt: null },
          select: { litres: true, totalCost: true, odometerBefore: true, odometerAfter: true },
        },
      },
    });

    return vehicles
      .map((v) => {
        const totalLitres = v.fuelUsageRecords.reduce((s, f) => s + Number(f.litres ?? 0), 0);
        const totalFuelCost = v.fuelUsageRecords.reduce((s, f) => s + Number(f.totalCost ?? 0), 0);
        const totalKm = v.fuelUsageRecords.reduce((s, f) => {
          const km = Number(f.odometerAfter ?? 0) - Number(f.odometerBefore ?? 0);
          return s + (km > 0 ? km : 0);
        }, 0);
        const litresPer100Km = totalKm > 0 ? Math.round((totalLitres / totalKm) * 100 * 100) / 100 : 0;
        return { vehicleCode: v.vehicleCode, registrationNumber: v.registrationNumber, totalLitres, totalKm, litresPer100Km, totalFuelCost };
      })
      .sort((a, b) => b.litresPer100Km - a.litresPer100Km);
  }

  async getReportMaintenanceSchedule(companyId: string | undefined, user: AuthUser) {
    const where: any = {
      deletedAt: null,
      status: 'SCHEDULED',
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };

    const records = await this.prisma.vehicleMaintenance.findMany({
      where,
      orderBy: { nextServiceDate: 'asc' },
      include: {
        vehicle: { select: { vehicleCode: true, registrationNumber: true, currentOdometer: true } },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return records.map((m) => {
      const currentOdometer = Number(m.vehicle?.currentOdometer ?? 0);
      const nextServiceOdometer = Number(m.nextServiceOdometer ?? 0);
      const kmUntilService = nextServiceOdometer > 0 ? Math.max(0, nextServiceOdometer - currentOdometer) : null;
      return {
        vehicleId: m.vehicleId,
        vehicleCode: m.vehicle?.vehicleCode ?? '',
        registrationNumber: m.vehicle?.registrationNumber ?? '',
        nextServiceDate: m.nextServiceDate?.toISOString() ?? null,
        nextServiceOdometer,
        currentOdometer,
        kmUntilService,
        status: m.status,
      };
    });
  }
}
