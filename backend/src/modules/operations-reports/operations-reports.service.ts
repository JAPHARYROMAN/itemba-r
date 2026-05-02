import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class OperationsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getStockValuation(
    companyId: string | undefined,
    locationId: string | undefined,
    divisionId: string | undefined,
    user: AuthUser,
  ) {
    const where: any = await this.companyScope.companyWhereFor(user, companyId);
    if (locationId) where.inventoryLocationId = locationId;
    // InventoryBalance has no direct divisionId — filter via the location.
    if (divisionId) where.inventoryLocation = { divisionId };

    const balances = await this.prisma.inventoryBalance.findMany({
      where,
      include: {
        product: { select: { id: true, productCode: true, name: true } },
        inventoryLocation: { select: { id: true, name: true, divisionId: true } },
      },
      orderBy: [
        { product: { productCode: 'asc' } },
        { inventoryLocation: { name: 'asc' } },
      ],
    });

    return balances.map((b) => ({
      productCode: b.product.productCode,
      productName: b.product.name,
      locationName: b.inventoryLocation.name,
      quantityOnHand: Number(b.quantityOnHand),
      averageCost: Number(b.averageCost),
      totalValue: Number(b.totalValue),
    }));
  }

  async getSalesSummary(
    companyId: string | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    divisionId: string | undefined,
    user: AuthUser,
  ) {
    const where: any = { deletedAt: null, ...(await this.companyScope.companyWhereFor(user, companyId)) };
    if (divisionId) where.divisionId = divisionId;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = new Date(dateFrom);
      if (dateTo) where.orderDate.lte = new Date(dateTo);
    }

    const [aggregate, byTypeRaw] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['salesType'],
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
    ]);

    return {
      totalSalesOrders: aggregate._count,
      totalSalesValue: Number(aggregate._sum.totalAmount ?? 0),
      totalPaid: Number(aggregate._sum.paidAmount ?? 0),
      totalOutstanding: Number(aggregate._sum.outstandingAmount ?? 0),
      byType: byTypeRaw.map((g) => ({
        salesType: g.salesType,
        count: g._count,
        totalAmount: Number(g._sum.totalAmount ?? 0),
        paidAmount: Number(g._sum.paidAmount ?? 0),
        outstandingAmount: Number(g._sum.outstandingAmount ?? 0),
      })),
    };
  }

  async getPurchaseSummary(
    companyId: string | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    divisionId: string | undefined,
    user: AuthUser,
  ) {
    const where: any = { deletedAt: null, ...(await this.companyScope.companyWhereFor(user, companyId)) };
    if (divisionId) where.divisionId = divisionId;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = new Date(dateFrom);
      if (dateTo) where.orderDate.lte = new Date(dateTo);
    }

    const [aggregate, byTypeRaw] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ['purchaseType'],
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
    ]);

    return {
      totalPurchaseOrders: aggregate._count,
      totalPurchaseValue: Number(aggregate._sum.totalAmount ?? 0),
      totalPaid: Number(aggregate._sum.paidAmount ?? 0),
      totalOutstanding: Number(aggregate._sum.outstandingAmount ?? 0),
      byType: byTypeRaw.map((g) => ({
        purchaseType: g.purchaseType,
        count: g._count,
        totalAmount: Number(g._sum.totalAmount ?? 0),
        paidAmount: Number(g._sum.paidAmount ?? 0),
        outstandingAmount: Number(g._sum.outstandingAmount ?? 0),
      })),
    };
  }

  async getInventoryMovements(
    companyId?: string,
    productId?: string,
    locationId?: string,
    dateFrom?: string,
    dateTo?: string,
    page = 1,
    pageSize = 20,
    divisionId?: string,
    user?: AuthUser,
  ) {
    const where: any = user
      ? await this.companyScope.companyWhereFor(user, companyId)
      : companyId
        ? { companyId }
        : {};
    if (divisionId) where.divisionId = divisionId;
    if (productId) where.productId = productId;
    if (locationId) where.inventoryLocationId = locationId;
    if (dateFrom || dateTo) {
      where.movementDate = {};
      if (dateFrom) where.movementDate.gte = new Date(dateFrom);
      if (dateTo) where.movementDate.lte = new Date(dateTo);
    }

    const [total, items] = await Promise.all([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          product: { select: { id: true, productCode: true, name: true } },
          inventoryLocation: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true } },
        },
        orderBy: { movementDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((m) => ({
        id: m.id,
        movementNumber: m.movementNumber,
        movementType: m.movementType,
        movementDate: m.movementDate,
        product: m.product,
        location: m.inventoryLocation,
        quantity: Number(m.quantity),
        unit: m.unit,
        unitCost: m.unitCost !== null ? Number(m.unitCost) : null,
        totalCost: m.totalCost !== null ? Number(m.totalCost) : null,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        notes: m.notes,
      })),
    };
  }
}
