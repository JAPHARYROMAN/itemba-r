import { Injectable } from '@nestjs/common';
import {
  CashAccountType,
  PaymentStatus,
  PurchaseType,
  SalesPaymentMethod,
  SalesOrderStatus,
  SalesType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

type ReadinessStatus = 'PASS' | 'WARN' | 'FAIL';

type ReadinessCheck = {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
};

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function statusFor(checkScore: number): ReadinessStatus {
  if (checkScore >= 90) return 'PASS';
  if (checkScore >= 70) return 'WARN';
  return 'FAIL';
}

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
      readiness: await this.getReadiness(companyId, user),
    };
  }

  async getReadiness(companyId: string | undefined, user: AuthUser) {
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

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      activeProducts,
      searchableProducts,
      activeCustomers,
      activeSuppliers,
      activeCashAccounts,
      activeBankOrMobileAccounts,
      negativeBalances,
      lowStockCandidates,
      recentMovements,
      cashPurchasesUnpaid,
      confirmedCashSalesUnpaid,
      cashSalesMissingAccount,
      purchaseOrdersReadyToReceive,
      pendingStockAdjustments,
      approvedStockAdjustments,
      staleDraftSales,
      staleDraftPurchases,
    ] = await Promise.all([
      this.prisma.product.count({ where: softWhere({ status: 'ACTIVE' }) }),
      this.prisma.product.count({
        where: softWhere({
          status: 'ACTIVE',
          OR: [{ productCode: { not: '' } }, { sku: { not: null } }, { barcode: { not: null } }],
        }),
      }),
      this.prisma.customer.count({ where: softWhere({ status: 'ACTIVE' }) }),
      this.prisma.supplier.count({ where: softWhere({ status: 'ACTIVE' }) }),
      this.prisma.cashAccount.count({
        where: softWhere({
          isActive: true,
          accountType: { in: [CashAccountType.CASH_ON_HAND, CashAccountType.PETTY_CASH] },
        }),
      }),
      this.prisma.cashAccount.count({
        where: softWhere({
          isActive: true,
          accountType: {
            in: [CashAccountType.BANK, CashAccountType.MOBILE_MONEY],
          },
        }),
      }),
      this.prisma.inventoryBalance.count({
        where: balanceWhere({ quantityOnHand: { lt: 0 } }),
      }),
      this.prisma.product.findMany({
        where: softWhere({ status: 'ACTIVE', reorderLevel: { not: null } }),
        select: {
          id: true,
          reorderLevel: true,
          inventoryBalances: { where: balanceWhere(), select: { quantityOnHand: true } },
        },
      }),
      this.prisma.inventoryMovement.count({
        where: balanceWhere({ movementDate: { gte: sevenDaysAgo } }),
      }),
      this.prisma.purchaseOrder.count({
        where: softWhere({
          purchaseType: PurchaseType.CASH_PURCHASE,
          OR: [{ paymentStatus: { not: PaymentStatus.PAID } }, { outstandingAmount: { gt: 0 } }],
        }),
      }),
      this.prisma.salesOrder.count({
        where: softWhere({
          salesType: { in: [SalesType.CASH_SALE, SalesType.RETAIL] },
          status: SalesOrderStatus.CONFIRMED,
          OR: [{ paymentStatus: { not: PaymentStatus.PAID } }, { outstandingAmount: { gt: 0 } }],
        }),
      }),
      this.prisma.salesOrder.count({
        where: softWhere({
          salesType: { in: [SalesType.CASH_SALE, SalesType.RETAIL] },
          paymentMethod: { not: SalesPaymentMethod.CREDIT },
          cashAccountId: null,
          status: { in: [SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED] },
        }),
      }),
      this.prisma.purchaseOrder.count({ where: softWhere({ status: 'CONFIRMED' }) }),
      this.prisma.stockAdjustment.count({ where: softWhere({ status: 'PENDING_APPROVAL' }) }),
      this.prisma.stockAdjustment.count({ where: softWhere({ status: 'APPROVED' }) }),
      this.prisma.salesOrder.count({ where: softWhere({ status: 'DRAFT' }) }),
      this.prisma.purchaseOrder.count({ where: softWhere({ status: 'DRAFT' }) }),
    ]);

    const lowStockProducts = lowStockCandidates.filter((product) => {
      const quantityOnHand = product.inventoryBalances.reduce(
        (sum, balance) => sum + Number(balance.quantityOnHand),
        0,
      );
      return quantityOnHand <= Number(product.reorderLevel);
    }).length;

    const productSearchCoverage =
      activeProducts === 0 ? 0 : Math.round((searchableProducts / activeProducts) * 100);
    const transactionIntegrityIssues = cashPurchasesUnpaid + confirmedCashSalesUnpaid;
    const workflowBacklog =
      purchaseOrdersReadyToReceive + pendingStockAdjustments + approvedStockAdjustments;

    const checks: ReadinessCheck[] = [
      {
        key: 'transaction-integrity',
        title: 'Cash transaction integrity',
        score: clampScore(100 - transactionIntegrityIssues * 15),
        status: statusFor(clampScore(100 - transactionIntegrityIssues * 15)),
        message:
          transactionIntegrityIssues === 0
            ? 'Cash purchases and confirmed cash sales are settling as paid.'
            : 'Cash documents exist with unpaid or outstanding balances.',
        details: {
          cashPurchasesUnpaid,
          confirmedCashSalesUnpaid,
        },
      },
      {
        key: 'product-discovery',
        title: 'Product picker and master data',
        score: clampScore(
          activeProducts === 0 ? 55 : Math.min(100, 80 + productSearchCoverage / 5),
        ),
        status: statusFor(
          clampScore(activeProducts === 0 ? 55 : Math.min(100, 80 + productSearchCoverage / 5)),
        ),
        message:
          activeProducts > 0
            ? 'Operational product search has active products with searchable codes.'
            : 'No active products are available for operational transactions.',
        details: {
          activeProducts,
          searchableProducts,
          productSearchCoverage,
        },
      },
      {
        key: 'inventory-control',
        title: 'Inventory control',
        score: clampScore(100 - negativeBalances * 8 - lowStockProducts * 2),
        status: statusFor(clampScore(100 - negativeBalances * 8 - lowStockProducts * 2)),
        message:
          negativeBalances === 0
            ? 'No negative inventory balances were found.'
            : 'Negative inventory balances need correction before close.',
        details: {
          negativeBalances,
          lowStockProducts,
          recentMovements,
        },
      },
      {
        key: 'cash-receipt-readiness',
        title: 'Cash receipt configuration',
        score: clampScore(
          activeCashAccounts === 0 ? 60 : 92 + Math.min(activeBankOrMobileAccounts, 4),
        ),
        status: statusFor(
          clampScore(activeCashAccounts === 0 ? 60 : 92 + Math.min(activeBankOrMobileAccounts, 4)),
        ),
        message:
          activeCashAccounts > 0
            ? 'Active cash/petty-cash accounts exist for receipt posting.'
            : 'No active cash-on-hand or petty-cash account is configured.',
        details: {
          activeCashAccounts,
          activeBankOrMobileAccounts,
          cashSalesMissingAccount,
        },
      },
      {
        key: 'workflow-throughput',
        title: 'Operational workflow throughput',
        score: clampScore(
          100 -
            Math.min(25, workflowBacklog * 2) -
            Math.min(10, staleDraftSales + staleDraftPurchases),
        ),
        status: statusFor(
          clampScore(
            100 -
              Math.min(25, workflowBacklog * 2) -
              Math.min(10, staleDraftSales + staleDraftPurchases),
          ),
        ),
        message:
          workflowBacklog === 0
            ? 'No confirmed purchases or stock adjustments are waiting for the next step.'
            : 'Some operational documents are waiting for receive, approval, or posting.',
        details: {
          purchaseOrdersReadyToReceive,
          pendingStockAdjustments,
          approvedStockAdjustments,
          staleDraftSales,
          staleDraftPurchases,
        },
      },
      {
        key: 'trading-master-data',
        title: 'Trading master data',
        score: clampScore(
          60 + Math.min(20, activeCustomers * 2) + Math.min(20, activeSuppliers * 2),
        ),
        status: statusFor(
          clampScore(60 + Math.min(20, activeCustomers * 2) + Math.min(20, activeSuppliers * 2)),
        ),
        message:
          activeCustomers > 0 && activeSuppliers > 0
            ? 'Active customers and suppliers exist for sales and purchase flows.'
            : 'Customer or supplier master data is incomplete.',
        details: {
          activeCustomers,
          activeSuppliers,
        },
      },
    ];

    const score = clampScore(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);

    return {
      score,
      target: 90,
      maturity:
        score >= 95 ? 'enterprise-ready' : score >= 90 ? 'production-ready' : 'needs-attention',
      updatedAt: new Date().toISOString(),
      indicators: {
        activeProducts,
        activeCustomers,
        activeSuppliers,
        negativeBalances,
        lowStockProducts,
        transactionIntegrityIssues,
        workflowBacklog,
      },
      checks,
    };
  }
}
