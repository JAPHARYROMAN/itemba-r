import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

type PetroleumReportQuery = Record<string, string | undefined>;

@Injectable()
export class PetroleumReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getFuelStock(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;

    const rows = await this.prisma.fuelTank.findMany({
      where,
      include: {
        product: { select: { name: true, productCode: true, sku: true } },
        branch: { select: { name: true, code: true } },
      },
      orderBy: [{ branch: { name: 'asc' } }, { tankCode: 'asc' }],
    });

    return rows.map((tank) => {
      const capacityLitres = this.toNumber(tank.capacityLitres);
      const bookBalanceLitres = this.toNumber(tank.currentBookBalance);
      const lastDipBalanceLitres = this.toNumber(tank.lastDipBalance);
      const ullageLitres = Math.max(capacityLitres - bookBalanceLitres, 0);
      return {
        branch: this.branchLabel(tank.branch),
        tankCode: tank.tankCode,
        tankName: tank.tankName,
        productCode: tank.product.productCode,
        sku: tank.product.sku,
        product: tank.product.name,
        capacityLitres,
        bookBalanceLitres,
        lastDipBalanceLitres,
        varianceFromLastDipLitres: lastDipBalanceLitres
          ? bookBalanceLitres - lastDipBalanceLitres
          : null,
        ullageLitres,
        fillPercent: capacityLitres > 0 ? (bookBalanceLitres / capacityLitres) * 100 : 0,
        status: tank.status,
      };
    });
  }

  async getShiftSummary(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    this.applyDateFilter(where, 'shiftDate', query);
    if (query.status) where.status = query.status;

    const shifts = await this.prisma.fuelShift.findMany({
      where,
      include: {
        branch: { select: { name: true, code: true } },
        openedBy: { select: { fullName: true, email: true } },
        nozzleReadings: { select: { litresSold: true, expectedAmount: true, status: true } },
        collections: { select: { collectionType: true, amount: true } },
        creditSales: { select: { totalAmount: true, status: true } },
      },
      orderBy: [{ shiftDate: 'desc' }, { shiftNumber: 'desc' }],
    });

    return shifts.map((shift) => {
      const totalLitresSold = shift.nozzleReadings.reduce(
        (sum, row) => sum + this.toNumber(row.litresSold),
        0,
      );
      const totalExpectedSales = shift.nozzleReadings.reduce(
        (sum, row) => sum + this.toNumber(row.expectedAmount),
        0,
      );
      const totalCollections = shift.collections.reduce(
        (sum, row) => sum + this.toNumber(row.amount),
        0,
      );
      const totalCreditSales = shift.creditSales.reduce(
        (sum, row) => sum + this.toNumber(row.totalAmount),
        0,
      );
      const totalAccounted = totalCollections + totalCreditSales;
      return {
        branch: this.branchLabel(shift.branch),
        shiftNumber: shift.shiftNumber,
        shiftDate: shift.shiftDate,
        shiftType: shift.shiftType,
        status: shift.status,
        openedBy: shift.openedBy?.fullName ?? shift.openedBy?.email ?? null,
        readingCount: shift.nozzleReadings.length,
        totalLitresSold,
        totalExpectedSales,
        totalCollections,
        totalCreditSales,
        totalAccounted,
        varianceAmount: totalAccounted - totalExpectedSales,
      };
    });
  }

  async getNozzleReadingsReport(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.companyWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    const shiftDate = this.dateFilter(query);
    if (shiftDate) where.fuelShift = { shiftDate };

    const rows = await this.prisma.fuelNozzleReading.findMany({
      where,
      include: {
        fuelShift: { select: { shiftNumber: true, shiftDate: true, shiftType: true } },
        branch: { select: { name: true, code: true } },
        nozzle: { select: { nozzleCode: true, nozzleName: true } },
        pump: { select: { pumpCode: true, pumpName: true } },
        tank: { select: { tankCode: true, tankName: true } },
        product: { select: { name: true, productCode: true } },
        attendant: { select: { fullName: true, email: true } },
      },
      orderBy: [{ fuelShift: { shiftDate: 'desc' } }, { createdAt: 'asc' }],
    });

    return rows.map((reading) => ({
      branch: this.branchLabel(reading.branch),
      shiftNumber: reading.fuelShift.shiftNumber,
      shiftDate: reading.fuelShift.shiftDate,
      shiftType: reading.fuelShift.shiftType,
      nozzle: reading.nozzle.nozzleName
        ? `${reading.nozzle.nozzleCode} - ${reading.nozzle.nozzleName}`
        : reading.nozzle.nozzleCode,
      pump: `${reading.pump.pumpCode} - ${reading.pump.pumpName}`,
      tank: `${reading.tank.tankCode} - ${reading.tank.tankName}`,
      productCode: reading.product.productCode,
      product: reading.product.name,
      attendant: reading.attendant?.fullName ?? reading.attendant?.email ?? null,
      openingMeter: this.toNumber(reading.openingMeter),
      closingMeter: this.toNumber(reading.closingMeter),
      litresSold: this.toNumber(reading.litresSold),
      pricePerLitre: this.toNumber(reading.pricePerLitre),
      expectedAmount: this.toNumber(reading.expectedAmount),
      status: reading.status,
    }));
  }

  async getCollectionsReport(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.companyWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.collectionType = query.status;
    const shiftDate = this.dateFilter(query);
    if (shiftDate) where.fuelShift = { shiftDate };

    const rows = await this.prisma.fuelShiftCollection.findMany({
      where,
      include: {
        fuelShift: { select: { shiftNumber: true, shiftDate: true, status: true } },
        branch: { select: { name: true, code: true } },
        cashAccount: { select: { accountName: true, accountType: true } },
      },
      orderBy: [{ fuelShift: { shiftDate: 'desc' } }, { createdAt: 'desc' }],
    });

    return rows.map((collection) => ({
      branch: this.branchLabel(collection.branch),
      shiftNumber: collection.fuelShift.shiftNumber,
      shiftDate: collection.fuelShift.shiftDate,
      shiftStatus: collection.fuelShift.status,
      collectionType: collection.collectionType,
      amount: this.toNumber(collection.amount),
      reference: collection.reference,
      cashAccount: collection.cashAccount
        ? `${collection.cashAccount.accountName} (${collection.cashAccount.accountType})`
        : null,
      notes: collection.notes,
      createdAt: collection.createdAt,
    }));
  }

  async getDeliveriesSummary(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    this.applyDateFilter(where, 'deliveryDate', query);

    const rows = await this.prisma.fuelDelivery.findMany({
      where,
      include: {
        branch: { select: { name: true, code: true } },
        supplier: { select: { name: true, supplierCode: true } },
        product: { select: { name: true, productCode: true } },
        tank: { select: { tankName: true, tankCode: true } },
      },
      orderBy: [{ deliveryDate: 'desc' }, { deliveryNumber: 'desc' }],
    });

    return rows.map((delivery) => ({
      branch: this.branchLabel(delivery.branch),
      deliveryNumber: delivery.deliveryNumber,
      deliveryDate: delivery.deliveryDate,
      supplierCode: delivery.supplier.supplierCode,
      supplier: delivery.supplier.name,
      productCode: delivery.product.productCode,
      product: delivery.product.name,
      tank: `${delivery.tank.tankCode} - ${delivery.tank.tankName}`,
      deliveryNoteNumber: delivery.deliveryNoteNumber,
      invoiceNumber: delivery.invoiceNumber,
      orderedLitres: this.toNumber(delivery.orderedLitres),
      deliveredLitres: this.toNumber(delivery.deliveredLitres),
      acceptedLitres: this.toNumber(delivery.acceptedLitres),
      rejectedLitres: this.toNumber(delivery.rejectedLitres),
      unitCost: this.toNumber(delivery.unitCost),
      totalCost: this.toNumber(delivery.totalCost),
      driverName: delivery.driverName,
      truckNumber: delivery.truckNumber,
      status: delivery.status,
    }));
  }

  async getCreditSalesReport(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    this.applyDateFilter(where, 'saleDate', query);

    const rows = await this.prisma.fuelCreditSale.findMany({
      where,
      include: {
        branch: { select: { name: true, code: true } },
        customer: { select: { name: true, customerCode: true } },
        product: { select: { name: true, productCode: true } },
        fuelShift: { select: { shiftNumber: true } },
      },
      orderBy: [{ saleDate: 'desc' }, { creditSaleNumber: 'desc' }],
    });

    return rows.map((sale) => ({
      branch: this.branchLabel(sale.branch),
      creditSaleNumber: sale.creditSaleNumber,
      saleDate: sale.saleDate,
      shiftNumber: sale.fuelShift?.shiftNumber ?? null,
      customerCode: sale.customer.customerCode,
      customer: sale.customer.name,
      productCode: sale.product.productCode,
      product: sale.product.name,
      vehicleNumber: sale.vehicleNumber,
      driverName: sale.driverName,
      litres: this.toNumber(sale.litres),
      pricePerLitre: this.toNumber(sale.pricePerLitre),
      totalAmount: this.toNumber(sale.totalAmount),
      status: sale.status,
    }));
  }

  async getTankDipsReport(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.tankId) where.tankId = query.tankId;
    if (query.status) where.status = query.status;
    this.applyDateFilter(where, 'dipDate', query);

    const rows = await this.prisma.fuelTankDip.findMany({
      where,
      include: {
        branch: { select: { name: true, code: true } },
        tank: { select: { tankName: true, tankCode: true } },
        product: { select: { name: true, productCode: true } },
        measuredBy: { select: { fullName: true, email: true } },
      },
      orderBy: [{ dipDate: 'desc' }, { dipTime: 'desc' }],
    });

    return rows.map((dip) => ({
      branch: this.branchLabel(dip.branch),
      dipNumber: dip.dipNumber,
      dipDate: dip.dipDate,
      dipTime: dip.dipTime,
      tank: `${dip.tank.tankCode} - ${dip.tank.tankName}`,
      productCode: dip.product.productCode,
      product: dip.product.name,
      bookBalance: this.toNumber(dip.bookBalance),
      physicalDipLitres: this.toNumber(dip.physicalDipLitres),
      varianceLitres: this.toNumber(dip.varianceLitres),
      varianceValue: this.toNumber(dip.varianceValue),
      measuredBy: dip.measuredBy.fullName ?? dip.measuredBy.email,
      status: dip.status,
    }));
  }

  async getReconciliationHistory(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.baseWhere(query, user);
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    this.applyDateFilter(where, 'reconciliationDate', query);

    const rows = await this.prisma.fuelDailyReconciliation.findMany({
      where,
      include: { branch: { select: { name: true, code: true } } },
      orderBy: [{ reconciliationDate: 'desc' }, { reconciliationNumber: 'desc' }],
    });

    return rows.map((reconciliation) => ({
      branch: this.branchLabel(reconciliation.branch),
      reconciliationNumber: reconciliation.reconciliationNumber,
      reconciliationDate: reconciliation.reconciliationDate,
      totalLitresSold: this.toNumber(reconciliation.totalLitresSold),
      totalExpectedSales: this.toNumber(reconciliation.totalExpectedSales),
      totalCashCollected: this.toNumber(reconciliation.totalCashCollected),
      totalMobileMoneyCollected: this.toNumber(reconciliation.totalMobileMoneyCollected),
      totalBankCardCollected: this.toNumber(reconciliation.totalBankCardCollected),
      totalCreditSales: this.toNumber(reconciliation.totalCreditSales),
      totalCollections: this.toNumber(reconciliation.totalCollections),
      cashShortage: this.toNumber(reconciliation.cashShortage),
      cashExcess: this.toNumber(reconciliation.cashExcess),
      totalTankVarianceLitres: this.toNumber(reconciliation.totalTankVarianceLitres),
      totalTankVarianceValue: this.toNumber(reconciliation.totalTankVarianceValue),
      status: reconciliation.status,
    }));
  }

  async getFuelPricesReport(query: PetroleumReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = {
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
    if (query.branchId) where.OR = [{ branchId: query.branchId }, { branchId: null }];
    if (query.status) where.status = query.status;
    this.applyDateFilter(where, 'effectiveFrom', query);

    const rows = await this.prisma.fuelPrice.findMany({
      where,
      include: {
        branch: { select: { name: true, code: true } },
        product: { select: { name: true, productCode: true } },
        approvedBy: { select: { fullName: true, email: true } },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { product: { name: 'asc' } }],
    });

    return rows.map((price) => ({
      branch: price.branch ? this.branchLabel(price.branch) : 'All branches',
      productCode: price.product.productCode,
      product: price.product.name,
      pricePerLitre: this.toNumber(price.pricePerLitre),
      currency: price.currency,
      effectiveFrom: price.effectiveFrom,
      effectiveTo: price.effectiveTo,
      status: price.status,
      approvedBy: price.approvedBy?.fullName ?? price.approvedBy?.email ?? null,
      approvedAt: price.approvedAt,
    }));
  }

  private async baseWhere(query: PetroleumReportQuery, user: AuthUser) {
    return {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
  }

  private async companyWhere(query: PetroleumReportQuery, user: AuthUser) {
    return {
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
  }

  private dateFilter(query: PetroleumReportQuery) {
    const from = query.from ?? query.dateFrom;
    const to = query.to ?? query.dateTo;
    if (!from && !to) return undefined;
    return {
      ...(from ? { gte: this.startOfDay(from) } : {}),
      ...(to ? { lte: this.endOfDay(to) } : {}),
    };
  }

  private applyDateFilter(
    where: Record<string, unknown>,
    key: string,
    query: PetroleumReportQuery,
  ) {
    const filter = this.dateFilter(query);
    if (filter) where[key] = filter;
  }

  private startOfDay(value: string) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private endOfDay(value: string) {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private toNumber(value: unknown): number {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  private branchLabel(branch?: { code?: string | null; name?: string | null } | null) {
    if (!branch) return null;
    return branch.code ? `${branch.code} - ${branch.name ?? ''}`.trim() : (branch.name ?? null);
  }
}
