import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class AgricultureDashboardService {
  constructor(
    private prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(companyId: string | undefined, user: AuthUser) {
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };

    const [
      totalFarms, activeFarms, totalFields, totalCrops,
      totalSeasons, activeSeasons, totalHarvests, postedHarvests, pendingHarvests,
    ] = await this.prisma.$transaction([
      this.prisma.farm.count({ where }),
      this.prisma.farm.count({ where: { ...where, status: 'ACTIVE' } }),
      this.prisma.farmField.count({ where }),
      this.prisma.crop.count({ where }),
      this.prisma.cropSeason.count({ where }),
      this.prisma.cropSeason.count({ where: { ...where, status: { in: ['PLANTED', 'GROWING', 'HARVESTING'] } } }),
      this.prisma.harvestRecord.count({ where }),
      this.prisma.harvestRecord.count({ where: { ...where, status: 'POSTED' } }),
      this.prisma.harvestRecord.count({ where: { ...where, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } } }),
    ]);

    // Aggregate input costs
    const inputCostAgg = await this.prisma.farmInputApplication.aggregate({
      where,
      _sum: { totalCost: true },
    });

    // Aggregate harvest estimated value
    const harvestValueAgg = await this.prisma.harvestRecord.aggregate({
      where: { ...where, status: 'POSTED' },
      _sum: { estimatedTotalValue: true, quantity: true },
    });

    // Active seasons with details
    const activeSeasonsData = await this.prisma.cropSeason.findMany({
      where: { ...where, status: { in: ['PLANTED', 'GROWING', 'HARVESTING'] } },
      include: { crop: { select: { name: true } }, farm: { select: { name: true } } },
      orderBy: { plantingDate: 'desc' },
      take: 10,
    });

    // Recent harvests
    const recentHarvests = await this.prisma.harvestRecord.findMany({
      where: { ...where, status: 'POSTED' },
      include: { farm: { select: { name: true } }, cropSeason: { include: { crop: { select: { name: true } } } } },
      orderBy: { harvestDate: 'desc' },
      take: 5,
    });

    return {
      totalFarms,
      activeFarms,
      totalFields,
      totalCrops,
      totalSeasons,
      activeSeasons,
      totalHarvests,
      postedHarvests,
      pendingHarvests,
      totalInputCost: Number(inputCostAgg._sum.totalCost ?? 0),
      totalHarvestValue: Number(harvestValueAgg._sum.estimatedTotalValue ?? 0),
      totalHarvestQuantity: Number(harvestValueAgg._sum.quantity ?? 0),
      activeSeasonsData: activeSeasonsData.map(s => ({
        id: s.id,
        seasonName: s.seasonName,
        cropName: s.crop?.name ?? '',
        farmName: s.farm?.name ?? '',
        status: s.status,
        plantingDate: s.plantingDate,
        expectedHarvestDate: s.expectedHarvestDate,
      })),
      recentHarvests: recentHarvests.map(h => ({
        id: h.id,
        harvestNumber: h.harvestNumber,
        farmName: h.farm?.name ?? '',
        cropName: h.cropSeason?.crop?.name ?? '',
        quantity: Number(h.quantity),
        harvestDate: h.harvestDate,
        estimatedTotalValue: Number(h.estimatedTotalValue ?? 0),
      })),
    };
  }

  async getSeasonProfitabilityReport(companyId: string, year: number | undefined, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId);
    const where: any = { deletedAt: null, companyId };
    if (year) {
      where.plantingDate = {
        gte: new Date(`${year}-01-01`),
        lte: new Date(`${year}-12-31`),
      };
    }

    const seasons = await this.prisma.cropSeason.findMany({
      where,
      include: {
        crop: { select: { name: true } },
        farm: { select: { name: true } },
        harvestRecords: { where: { status: 'POSTED' }, select: { estimatedTotalValue: true, quantity: true } },
        inputApplications: { select: { totalCost: true } },
      },
      orderBy: { plantingDate: 'desc' },
    });

    return seasons.map(s => {
      const revenue = s.harvestRecords.reduce((sum, h) => sum + Number(h.estimatedTotalValue ?? 0), 0);
      const inputCost = s.inputApplications.reduce((sum, i) => sum + Number(i.totalCost ?? 0), 0);
      const totalCost = Number(s.actualCost ?? 0) || inputCost;
      const profit = revenue - totalCost;
      const margin = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      return {
        id: s.id,
        seasonName: s.seasonName,
        cropName: s.crop?.name ?? '',
        farmName: s.farm?.name ?? '',
        status: s.status,
        plantingDate: s.plantingDate,
        expectedHarvestDate: s.expectedHarvestDate,
        budgetAmount: Number(s.budgetAmount ?? 0),
        actualCost: totalCost,
        revenue,
        profit,
        marginPercent: Math.round(margin * 10) / 10,
        totalHarvestedQty: s.harvestRecords.reduce((sum, h) => sum + Number(h.quantity ?? 0), 0),
      };
    });
  }

  async getYieldAnalysisReport(companyId: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId);
    const harvests = await this.prisma.harvestRecord.findMany({
      where: { companyId, deletedAt: null, status: 'POSTED' },
      include: {
        farm: { select: { name: true, sizeValue: true } },
        cropSeason: { include: { crop: { select: { name: true } } } },
      },
      orderBy: { harvestDate: 'desc' },
    });

    return harvests.map(h => ({
      id: h.id,
      harvestNumber: h.harvestNumber,
      cropName: h.cropSeason?.crop?.name ?? '',
      farmName: h.farm?.name ?? '',
      farmSize: Number(h.farm?.sizeValue ?? 0),
      quantity: Number(h.quantity),
      qualityGrade: h.qualityGrade ?? '',
      estimatedTotalValue: Number(h.estimatedTotalValue ?? 0),
      harvestDate: h.harvestDate,
    }));
  }

  async getInputCostReport(
    companyId: string,
    cropSeasonId: string | undefined,
    user: AuthUser,
  ) {
    await this.companyScope.assertCanAccessCompany(user, companyId);
    const where: any = { companyId, deletedAt: null };
    if (cropSeasonId) where.cropSeasonId = cropSeasonId;

    const inputs = await this.prisma.farmInputApplication.findMany({
      where,
      include: {
        farm: { select: { name: true } },
        cropSeason: { include: { crop: { select: { name: true } } } },
      },
      orderBy: { applicationDate: 'desc' },
    });

    const grouped: Record<string, { applicationType: string; count: number; totalCost: number }> = {};
    for (const i of inputs) {
      const key = i.applicationType;
      if (!grouped[key]) grouped[key] = { applicationType: key, count: 0, totalCost: 0 };
      grouped[key].count++;
      grouped[key].totalCost += Number(i.totalCost ?? 0);
    }

    return {
      items: inputs.map(i => ({
        id: i.id,
        applicationNumber: i.applicationNumber,
        applicationType: i.applicationType,
        farmName: i.farm?.name ?? '',
        cropName: i.cropSeason?.crop?.name ?? '',
        applicationDate: i.applicationDate,
        quantity: Number(i.quantity ?? 0),
        totalCost: Number(i.totalCost ?? 0),
        notes: i.notes ?? '',
      })),
      summary: Object.values(grouped),
      grandTotal: inputs.reduce((sum, i) => sum + Number(i.totalCost ?? 0), 0),
    };
  }

  async getLaborCostReport(companyId: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId);
    const records = await this.prisma.laborRecord.findMany({
      where: { companyId, deletedAt: null, laborContextType: 'AGRICULTURE_SEASON' },
      orderBy: { laborDate: 'desc' },
    });

    const grouped: Record<string, { contextId: string; count: number; totalAmount: number }> = {};
    for (const r of records) {
      const key = r.laborContextId ?? 'GENERAL';
      if (!grouped[key]) grouped[key] = { contextId: key, count: 0, totalAmount: 0 };
      grouped[key].count++;
      grouped[key].totalAmount += Number(r.totalAmount ?? 0);
    }

    return {
      items: records.map(r => ({
        id: r.id,
        laborRecordNumber: r.laborRecordNumber,
        workerName: r.workerName ?? '',
        role: r.role ?? '',
        laborDate: r.laborDate,
        hoursWorked: Number(r.hoursWorked ?? 0),
        totalAmount: Number(r.totalAmount),
        currency: r.currency,
        paymentStatus: r.paymentStatus,
        contextId: r.laborContextId ?? '',
      })),
      summary: Object.values(grouped),
      grandTotal: records.reduce((sum, r) => sum + Number(r.totalAmount), 0),
    };
  }
}
