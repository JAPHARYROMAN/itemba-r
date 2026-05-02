import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PetroleumReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getFuelStock(query: Record<string, string>, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;

    return this.prisma.fuelTank.findMany({
      where,
      include: {
        product: { select: { name: true, productCode: true } },
        branch: { select: { name: true } },
      },
      orderBy: { tankCode: 'asc' },
    });
  }

  async getShiftSummary(query: Record<string, string>, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.from) where.shiftDate = { gte: new Date(query.from) };
    if (query.to) {
      where.shiftDate = {
        ...((where.shiftDate as Record<string, unknown>) ?? {}),
        lte: new Date(query.to),
      };
    }

    const shifts = await this.prisma.fuelShift.findMany({
      where,
      include: {
        nozzleReadings: { select: { litresSold: true, expectedAmount: true, status: true } },
        collections: { select: { collectionType: true, amount: true } },
      },
      orderBy: { shiftDate: 'desc' },
    });

    return shifts.map((s) => ({
      id: s.id,
      shiftNumber: s.shiftNumber,
      shiftDate: s.shiftDate,
      shiftType: s.shiftType,
      status: s.status,
      totalLitresSold: s.nozzleReadings.reduce((a, r) => a + Number(r.litresSold), 0),
      totalExpectedSales: s.nozzleReadings.reduce((a, r) => a + Number(r.expectedAmount), 0),
      totalCollections: s.collections.reduce((a, c) => a + Number(c.amount), 0),
    }));
  }

  async getDeliveriesSummary(query: Record<string, string>, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.from) where.deliveryDate = { gte: new Date(query.from) };
    if (query.to) {
      where.deliveryDate = {
        ...((where.deliveryDate as Record<string, unknown>) ?? {}),
        lte: new Date(query.to),
      };
    }

    return this.prisma.fuelDelivery.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        product: { select: { name: true } },
        tank: { select: { tankName: true } },
      },
      orderBy: { deliveryDate: 'desc' },
    });
  }

  async getCreditSalesReport(query: Record<string, string>, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.from) where.saleDate = { gte: new Date(query.from) };
    if (query.to) {
      where.saleDate = {
        ...((where.saleDate as Record<string, unknown>) ?? {}),
        lte: new Date(query.to),
      };
    }

    return this.prisma.fuelCreditSale.findMany({
      where,
      include: {
        customer: { select: { name: true, customerCode: true } },
        product: { select: { name: true } },
      },
      orderBy: { saleDate: 'desc' },
    });
  }

  async getTankDipsReport(query: Record<string, string>, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.tankId) where.tankId = query.tankId;
    if (query.from) where.dipDate = { gte: new Date(query.from) };
    if (query.to) {
      where.dipDate = {
        ...((where.dipDate as Record<string, unknown>) ?? {}),
        lte: new Date(query.to),
      };
    }

    return this.prisma.fuelTankDip.findMany({
      where,
      include: {
        tank: { select: { tankName: true, tankCode: true } },
        product: { select: { name: true } },
      },
      orderBy: { dipDate: 'desc' },
    });
  }

  async getReconciliationHistory(query: Record<string, string>, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.from) where.reconciliationDate = { gte: new Date(query.from) };
    if (query.to) {
      where.reconciliationDate = {
        ...((where.reconciliationDate as Record<string, unknown>) ?? {}),
        lte: new Date(query.to),
      };
    }

    return this.prisma.fuelDailyReconciliation.findMany({
      where,
      orderBy: { reconciliationDate: 'desc' },
    });
  }

  private async baseWhere(query: Record<string, string>, user: AuthUser) {
    return {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
  }
}
