import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class OperationsDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(companyId: string | undefined, user: AuthUser) {
    const companyWhere = (await this.companyScope.companyWhereFor(user, companyId)) as any;
    const softWhere = (extra?: object) => ({
      deletedAt: null,
      ...companyWhere,
      ...(extra ?? {}),
    });

    const balanceWhere = (extra?: object) => ({
      ...companyWhere,
      ...(extra ?? {}),
    });

    const [
      customersTotal,
      customersActive,
      customersBlocked,
      suppliersTotal,
      suppliersActive,
      suppliersBlocked,
      productsTotal,
      productsActive,
      salesOrdersTotal,
      salesOrdersDraft,
      salesOrdersConfirmed,
      salesOrdersCancelled,
      salesOrdersValue,
      salesOrdersOutstanding,
      purchaseOrdersTotal,
      purchaseOrdersDraft,
      purchaseOrdersConfirmed,
      purchaseOrdersReceived,
      purchaseOrdersCancelled,
      purchaseOrdersValue,
      purchaseOrdersOutstanding,
      stockAdjTotal,
      stockAdjPending,
      stockAdjPosted,
      topProducts,
      outOfStockGroups,
      lowStockCandidates,
    ] = await Promise.all([
      this.prisma.customer.count({ where: softWhere() }),
      this.prisma.customer.count({ where: softWhere({ status: 'ACTIVE' }) }),
      this.prisma.customer.count({ where: softWhere({ status: 'BLOCKED' }) }),

      this.prisma.supplier.count({ where: softWhere() }),
      this.prisma.supplier.count({ where: softWhere({ status: 'ACTIVE' }) }),
      this.prisma.supplier.count({ where: softWhere({ status: 'BLOCKED' }) }),

      this.prisma.product.count({ where: softWhere() }),
      this.prisma.product.count({ where: softWhere({ status: 'ACTIVE' }) }),

      this.prisma.salesOrder.count({ where: softWhere() }),
      this.prisma.salesOrder.count({ where: softWhere({ status: 'DRAFT' }) }),
      this.prisma.salesOrder.count({ where: softWhere({ status: 'CONFIRMED' }) }),
      this.prisma.salesOrder.count({ where: softWhere({ status: 'CANCELLED' }) }),
      this.prisma.salesOrder.aggregate({
        where: softWhere(),
        _sum: { totalAmount: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: softWhere(),
        _sum: { outstandingAmount: true },
      }),

      this.prisma.purchaseOrder.count({ where: softWhere() }),
      this.prisma.purchaseOrder.count({ where: softWhere({ status: 'DRAFT' }) }),
      this.prisma.purchaseOrder.count({ where: softWhere({ status: 'CONFIRMED' }) }),
      this.prisma.purchaseOrder.count({ where: softWhere({ status: 'RECEIVED' }) }),
      this.prisma.purchaseOrder.count({ where: softWhere({ status: 'CANCELLED' }) }),
      this.prisma.purchaseOrder.aggregate({
        where: softWhere(),
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: softWhere(),
        _sum: { outstandingAmount: true },
      }),

      this.prisma.stockAdjustment.count({ where: softWhere() }),
      this.prisma.stockAdjustment.count({ where: softWhere({ status: 'PENDING_APPROVAL' }) }),
      this.prisma.stockAdjustment.count({ where: softWhere({ status: 'POSTED' }) }),

      // Top products by totalValue
      this.prisma.inventoryBalance.findMany({
        where: balanceWhere(),
        orderBy: { totalValue: 'desc' },
        take: 10,
        include: { product: { select: { id: true, name: true } } },
      }),

      // Out-of-stock: products whose total quantityOnHand across all locations <= 0
      this.prisma.inventoryBalance.groupBy({
        by: ['productId'],
        where: balanceWhere(),
        _sum: { quantityOnHand: true },
        having: { quantityOnHand: { _sum: { lte: 0 } } },
      }),

      // Low stock candidates: products with a reorderLevel defined
      this.prisma.product.findMany({
        where: { ...softWhere(), reorderLevel: { not: null } },
        select: {
          id: true,
          name: true,
          reorderLevel: true,
          inventoryBalances: {
            where: balanceWhere(),
            select: { quantityOnHand: true },
          },
        },
      }),
    ]);

    // Aggregate quantityOnHand per product and compare to reorderLevel
    const lowStockProducts = lowStockCandidates
      .map((p) => {
        const quantityOnHand = p.inventoryBalances.reduce(
          (sum, b) => sum + Number(b.quantityOnHand),
          0,
        );
        return { id: p.id, name: p.name, quantityOnHand, reorderLevel: Number(p.reorderLevel) };
      })
      .filter((p) => p.quantityOnHand <= p.reorderLevel)
      .slice(0, 10);

    return {
      customers: {
        total: customersTotal,
        active: customersActive,
        blocked: customersBlocked,
      },
      suppliers: {
        total: suppliersTotal,
        active: suppliersActive,
        blocked: suppliersBlocked,
      },
      products: {
        total: productsTotal,
        active: productsActive,
        outOfStock: outOfStockGroups.length,
      },
      salesOrders: {
        total: salesOrdersTotal,
        draft: salesOrdersDraft,
        confirmed: salesOrdersConfirmed,
        cancelled: salesOrdersCancelled,
        totalValue: Number(salesOrdersValue._sum.totalAmount ?? 0),
        outstandingValue: Number(salesOrdersOutstanding._sum.outstandingAmount ?? 0),
      },
      purchaseOrders: {
        total: purchaseOrdersTotal,
        draft: purchaseOrdersDraft,
        confirmed: purchaseOrdersConfirmed,
        received: purchaseOrdersReceived,
        cancelled: purchaseOrdersCancelled,
        totalValue: Number(purchaseOrdersValue._sum.totalAmount ?? 0),
        outstandingValue: Number(purchaseOrdersOutstanding._sum.outstandingAmount ?? 0),
      },
      stockAdjustments: {
        total: stockAdjTotal,
        pendingApproval: stockAdjPending,
        posted: stockAdjPosted,
      },
      topProducts: topProducts.map((b) => ({
        id: b.product.id,
        name: b.product.name,
        quantityOnHand: Number(b.quantityOnHand),
        totalValue: Number(b.totalValue),
      })),
      lowStockProducts,
    };
  }
}
