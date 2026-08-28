import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccessLevel,
  AuditSeverity,
  InventoryMovementType,
  Prisma,
  ProductStatus,
  ProfitCostSource,
  SalesOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface ProfitQuery {
  companyId?: string;
  divisionId?: string;
  branchId?: string;
  customerId?: string;
  productId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string | number;
  limit?: string | number;
  report?: string;
  format?: string;
}

const STOCK_EXEMPT_TYPES = new Set(['SERVICE', 'NON_STOCK_ITEM']);
// Synthetic bucket key for sales orders with no customerId (walk-in / cash sales).
const UNASSIGNED_KEY = '__UNASSIGNED__';
const PROFIT_SALES_STATUSES = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PARTIALLY_PAID,
  SalesOrderStatus.PAID,
];
const COST_REQUIRED_INBOUND_TYPES: InventoryMovementType[] = [
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
];

// Relation filter mirroring isStockProduct(): a product tracks stock unless it opts
// out via trackInventory:false or is a SERVICE / NON_STOCK_ITEM type. Used to scope
// the missing-cost groupBy so service/non-stock lines are never flagged.
const STOCK_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  trackInventory: { not: false },
  productType: { notIn: [...STOCK_EXEMPT_TYPES] as any },
};

type DbClient = PrismaService | Prisma.TransactionClient;

type ProductForProfit = {
  id: string;
  companyId: string;
  name: string;
  productType: string;
  trackInventory: boolean;
  defaultPurchasePrice: Prisma.Decimal | number | string | null;
  productFamily?: {
    defaultPurchasePrice: Prisma.Decimal | number | string | null;
  } | null;
};

type BalanceForProfit = {
  productId: string;
  quantityOnHand: Prisma.Decimal | number | string;
  averageCost: Prisma.Decimal | number | string;
} | null;

export type ValidateSaleLinesInput = {
  companyId: string;
  branchId?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    discountAmount?: number | null;
  }>;
};

export type SaleLineProfitSnapshot = {
  productId: string;
  productName: string;
  trackInventory: boolean;
  unitCostAtSale: number | null;
  cogsAmount: number;
  grossProfitAmount: number;
  grossMarginPct: number | null;
  profitCostSource: ProfitCostSource | null;
  netSalesAmount: number;
  netUnitPrice: number;
};

type ProfitAuditContext = {
  user?: AuthUser;
  source?: string;
  referenceType?: string;
  referenceId?: string | null;
};

type CostFixInput = {
  defaultPurchasePrice?: number | string | null;
  branchId?: string | null;
  averageCost?: number | string | null;
};

@Injectable()
export class ProfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  isStockProduct(product: { productType?: string | null; trackInventory?: boolean | null }) {
    if (product.trackInventory === false) return false;
    return !STOCK_EXEMPT_TYPES.has(String(product.productType ?? '').toUpperCase());
  }

  assertProductMasterPricing(product: {
    name?: string | null;
    productType?: string | null;
    trackInventory?: boolean | null;
    defaultPurchasePrice?: number | string | Prisma.Decimal | null;
    defaultSellingPrice?: number | string | Prisma.Decimal | null;
    retailPrice?: number | string | Prisma.Decimal | null;
    wholesalePrice?: number | string | Prisma.Decimal | null;
  }) {
    if (!this.isStockProduct(product)) return;

    const name = product.name?.trim() || 'Stock product';
    const cost = Number(product.defaultPurchasePrice ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new BadRequestException(`${name} must have a purchase cost greater than zero`);
    }

    for (const [label, raw] of [
      ['default selling price', product.defaultSellingPrice],
      ['retail price', product.retailPrice],
      ['wholesale price', product.wholesalePrice],
    ] as const) {
      if (raw == null || raw === '') continue;
      const price = Number(raw);
      if (Number.isFinite(price) && price > 0 && price <= cost) {
        throw new BadRequestException(`${name} ${label} must be greater than purchase cost`);
      }
    }
  }

  async assertPurchaseLinesHaveCost(
    companyId: string,
    lines: Array<{ productId: string; unitCost: number }>,
    db: DbClient = this.prisma,
  ) {
    if (!lines.length) return;
    const products = await db.product.findMany({
      where: { companyId, id: { in: [...new Set(lines.map((line) => line.productId))] } },
      select: {
        id: true,
        name: true,
        companyId: true,
        productType: true,
        trackInventory: true,
        defaultPurchasePrice: true,
        productFamily: { select: { defaultPurchasePrice: true } },
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));

    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!product || !this.isStockProduct(product)) continue;
      const unitCost = Number(line.unitCost);
      if (!Number.isFinite(unitCost) || unitCost <= 0) {
        throw new BadRequestException(
          `Purchase cost for ${product.name} must be greater than zero`,
        );
      }
    }
  }

  async assertInventoryMovementHasCost(
    data: {
      companyId: string;
      productId: string;
      movementType: InventoryMovementType;
      unitCost?: number;
    },
    db: DbClient = this.prisma,
  ) {
    if (!COST_REQUIRED_INBOUND_TYPES.includes(data.movementType)) return;
    const product = await db.product.findFirst({
      where: { id: data.productId, companyId: data.companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        companyId: true,
        productType: true,
        trackInventory: true,
        defaultPurchasePrice: true,
        productFamily: { select: { defaultPurchasePrice: true } },
      },
    });
    if (!product || !this.isStockProduct(product)) return;

    const unitCost = Number(data.unitCost ?? 0);
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      throw new BadRequestException(
        `Inventory movement for ${product.name} must include a unit cost greater than zero`,
      );
    }
  }

  async validateSaleLinesForUser(input: ValidateSaleLinesInput, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, input.companyId, AccessLevel.READ);
    const lines = await this.assertSaleLinesProfitable(input, this.prisma, {
      user,
      source: 'ManualSaleLineValidation',
    });
    await this.auditLogs.log({
      action: 'PROFIT_VALIDATION_RUN',
      entityType: 'ProfitValidation',
      companyId: input.companyId,
      userId: user.id,
      newValue: { lineCount: lines.length, hasBlockingErrors: false },
      severity: AuditSeverity.LOW,
    });
    return {
      lines,
      hasBlockingErrors: false,
    };
  }

  async assertSaleLinesProfitable(
    input: ValidateSaleLinesInput,
    db: DbClient = this.prisma,
    auditContext: ProfitAuditContext = {},
  ): Promise<SaleLineProfitSnapshot[]> {
    try {
      return await this.validateSaleLines(input, db);
    } catch (error) {
      await this.logProfitValidationFailure(input, error, auditContext);
      throw error;
    }
  }

  async validateSaleLines(
    input: ValidateSaleLinesInput,
    db: DbClient = this.prisma,
  ): Promise<SaleLineProfitSnapshot[]> {
    if (!input.companyId)
      throw new BadRequestException('Company is required for profit validation');
    if (!input.lines?.length) throw new BadRequestException('At least one sale line is required');

    const productIds = [...new Set(input.lines.map((line) => line.productId).filter(Boolean))];
    const products = await db.product.findMany({
      where: { companyId: input.companyId, id: { in: productIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        companyId: true,
        productType: true,
        trackInventory: true,
        defaultPurchasePrice: true,
        productFamily: { select: { defaultPurchasePrice: true } },
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const balances =
      input.branchId && productIds.length
        ? await db.inventoryBalance.findMany({
            where: {
              companyId: input.companyId,
              branchId: input.branchId,
              productId: { in: productIds },
            },
            select: { productId: true, quantityOnHand: true, averageCost: true },
          })
        : [];
    const balanceByProductId = new Map(balances.map((balance) => [balance.productId, balance]));

    return input.lines.map((line) => {
      const product = productById.get(line.productId);
      if (!product) {
        throw new BadRequestException('Sale line product does not belong to this company');
      }
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const discountAmount = Number(line.discountAmount ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`Quantity for ${product.name} must be greater than zero`);
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new BadRequestException(
          `Selling price for ${product.name} must be greater than zero`,
        );
      }
      if (!Number.isFinite(discountAmount) || discountAmount < 0) {
        throw new BadRequestException(`Discount for ${product.name} cannot be negative`);
      }

      const netSalesAmount = roundMoney(quantity * unitPrice - discountAmount);
      if (netSalesAmount <= 0) {
        throw new BadRequestException(
          `Net sales amount for ${product.name} must be greater than zero`,
        );
      }
      const netUnitPrice = netSalesAmount / quantity;

      if (!this.isStockProduct(product)) {
        return {
          productId: product.id,
          productName: product.name,
          trackInventory: false,
          unitCostAtSale: null,
          cogsAmount: 0,
          grossProfitAmount: netSalesAmount,
          grossMarginPct: 100,
          profitCostSource: null,
          netSalesAmount,
          netUnitPrice,
        };
      }

      const cost = this.resolveEffectiveCost(
        product,
        balanceByProductId.get(product.id) ?? null,
        input.branchId,
      );
      if (netUnitPrice <= cost.unitCost) {
        throw new BadRequestException(
          `${product.name} cannot be sold below cost. Net unit price ${formatMoney(netUnitPrice)} must be greater than cost ${formatMoney(cost.unitCost)}.`,
        );
      }
      const cogsAmount = roundMoney(quantity * cost.unitCost);
      const grossProfitAmount = roundMoney(netSalesAmount - cogsAmount);
      const grossMarginPct =
        netSalesAmount > 0 ? roundPercent((grossProfitAmount / netSalesAmount) * 100) : null;

      return {
        productId: product.id,
        productName: product.name,
        trackInventory: true,
        unitCostAtSale: roundCost(cost.unitCost),
        cogsAmount,
        grossProfitAmount,
        grossMarginPct,
        profitCostSource: cost.source,
        netSalesAmount,
        netUnitPrice,
      };
    });
  }

  async productSummary(query: ProfitQuery, user: AuthUser) {
    const salesOrderWhere = await this.salesOrderWhere(query, user);
    const lineWhere: Prisma.SalesOrderLineWhereInput = {
      salesOrder: salesOrderWhere,
      ...(query.productId ? { productId: query.productId } : {}),
    };

    // Aggregate in the database (groupBy productId / _sum) rather than pulling up to
    // 1000 rows into JS. The old take:1000 silently truncated both the summary totals
    // and the per-product table once a filter matched more than 1000 lines.
    // Revenue (net, ex-tax) per line is `quantity*unitPrice - discountAmount`, which is
    // exactly the stored `lineTotal - taxAmount` (see SalesOrder line-total derivation),
    // so it sums cleanly via two column _sums.
    const [grouped, missingGrouped] = await Promise.all([
      this.prisma.salesOrderLine.groupBy({
        by: ['productId'],
        where: lineWhere,
        _sum: { quantity: true, lineTotal: true, taxAmount: true, cogsAmount: true },
        _count: { _all: true },
      }),
      // A stock line with no snapshotted cost contributes full revenue and 0 cost,
      // overstating gross profit. Count/sum those (don't drop them). Non-stock/service
      // lines legitimately carry no COGS and are not flagged.
      this.prisma.salesOrderLine.groupBy({
        by: ['productId'],
        where: { ...lineWhere, cogsAmount: null, product: STOCK_PRODUCT_WHERE },
        _sum: { lineTotal: true, taxAmount: true },
        _count: { _all: true },
      }),
    ]);

    const productIds = grouped.map((group) => group.productId);
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, productCode: true, name: true },
        })
      : [];
    const productById = new Map(products.map((product) => [product.id, product]));

    const missingByProduct = new Map(missingGrouped.map((group) => [group.productId, group]));

    let revenue = 0;
    let cogs = 0;
    let linesMissingCost = 0;
    let revenueMissingCost = 0;

    const rows = grouped.map((group) => {
      const rowRevenue = roundMoney(
        Number(group._sum.lineTotal ?? 0) - Number(group._sum.taxAmount ?? 0),
      );
      const rowCogs = roundMoney(Number(group._sum.cogsAmount ?? 0));
      const rowGrossProfit = roundMoney(rowRevenue - rowCogs);
      const missing = missingByProduct.get(group.productId);
      const product = productById.get(group.productId);

      revenue += rowRevenue;
      cogs += rowCogs;
      if (missing) {
        linesMissingCost += missing._count._all;
        revenueMissingCost +=
          Number(missing._sum.lineTotal ?? 0) - Number(missing._sum.taxAmount ?? 0);
      }

      return {
        productId: group.productId,
        productCode: product?.productCode ?? null,
        productName: product?.name ?? null,
        quantity: Number(group._sum.quantity ?? 0),
        revenue: rowRevenue,
        cogs: rowCogs,
        grossProfit: rowGrossProfit,
        grossMarginPct: rowRevenue > 0 ? roundPercent((rowGrossProfit / rowRevenue) * 100) : 0,
        salesCount: group._count._all,
        hasMissingCost: Boolean(missing),
      };
    });
    rows.sort((a, b) => b.revenue - a.revenue);

    revenue = roundMoney(revenue);
    cogs = roundMoney(cogs);
    const grossProfit = roundMoney(revenue - cogs);
    const gaps = await this.costGaps(query, user);
    return {
      summary: {
        revenue,
        cogs,
        grossProfit,
        grossMarginPct: revenue > 0 ? roundPercent((grossProfit / revenue) * 100) : 0,
        costGaps: gaps.total,
        linesMissingCost,
        revenueMissingCost: roundMoney(revenueMissingCost),
      },
      products: rows,
    };
  }

  /**
   * Customer profitability: aggregates net revenue and COGS per customer over the
   * same confirmed/partially-paid/paid sales orders that `productSummary` uses, so
   * both reports agree on totals. COGS reuses the WAC-based `cogsAmount` snapshot
   * frozen on each SalesOrderLine (BRANCH_AVERAGE_COST → DEFAULT_PURCHASE_PRICE),
   * i.e. the identical cost basis as the product-level report — no new costing.
   *
   * Company scope: every DB read here flows through `salesOrderWhere` (which applies
   * `companyWhereFor`), and the line groupBys filter via `salesOrder: salesOrderWhere`.
   * No raw SQL is used, so there is no way for a line from another company to leak in.
   *
   * SalesOrder.customerId is nullable (walk-in cash sales); those orders are folded
   * into a single synthetic "Unassigned / Walk-in" bucket keyed by UNASSIGNED_KEY.
   */
  async customerSummary(query: ProfitQuery, user: AuthUser) {
    const salesOrderWhere = await this.salesOrderWhere(query, user);
    const orderFilter: Prisma.SalesOrderWhereInput = {
      ...salesOrderWhere,
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const lineWhere: Prisma.SalesOrderLineWhereInput = { salesOrder: orderFilter };

    // Aggregate in the DB: one row per order with net revenue (lineTotal - tax) and
    // COGS summed from the frozen line snapshots. Grouping by salesOrderId keeps this
    // bounded to the order count (same order of magnitude as listing orders) while
    // never truncating, then we fold orders into their customer in JS.
    const [grouped, missingGrouped] = await Promise.all([
      this.prisma.salesOrderLine.groupBy({
        by: ['salesOrderId'],
        where: lineWhere,
        _sum: { quantity: true, lineTotal: true, taxAmount: true, cogsAmount: true },
        _count: { _all: true },
      }),
      // Stock lines with no snapshotted cost overstate profit; count/sum them so the
      // per-customer rows can flag missing cost, exactly like productSummary does.
      this.prisma.salesOrderLine.groupBy({
        by: ['salesOrderId'],
        where: { ...lineWhere, cogsAmount: null, product: STOCK_PRODUCT_WHERE },
        _sum: { lineTotal: true, taxAmount: true },
        _count: { _all: true },
      }),
    ]);

    const orderIds = grouped.map((group) => group.salesOrderId);
    const orders = orderIds.length
      ? await this.prisma.salesOrder.findMany({
          // Re-scope by the same company-scoped filter (belt and braces: these ids all
          // came from a company-scoped groupBy already) so no foreign order slips in.
          where: { ...orderFilter, id: { in: orderIds } },
          select: { id: true, customerId: true, customerName: true },
        })
      : [];
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const missingByOrder = new Map(missingGrouped.map((group) => [group.salesOrderId, group]));

    type CustomerBucket = {
      customerId: string | null;
      customerName: string | null;
      revenue: number;
      cogs: number;
      quantity: number;
      salesCount: number;
      orderIds: Set<string>;
      linesMissingCost: number;
      revenueMissingCost: number;
    };
    const buckets = new Map<string, CustomerBucket>();

    let revenue = 0;
    let cogs = 0;
    let linesMissingCost = 0;
    let revenueMissingCost = 0;

    for (const group of grouped) {
      const order = orderById.get(group.salesOrderId);
      const key = order?.customerId ?? UNASSIGNED_KEY;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          customerId: order?.customerId ?? null,
          customerName: order?.customerName ?? null,
          revenue: 0,
          cogs: 0,
          quantity: 0,
          salesCount: 0,
          orderIds: new Set<string>(),
          linesMissingCost: 0,
          revenueMissingCost: 0,
        };
        buckets.set(key, bucket);
      }
      // Prefer a non-empty customerName if a later order supplies one (walk-in orders
      // may carry a name even when customerId is null / inconsistent).
      if (!bucket.customerName && order?.customerName) bucket.customerName = order.customerName;

      const orderRevenue = Number(group._sum.lineTotal ?? 0) - Number(group._sum.taxAmount ?? 0);
      const orderCogs = Number(group._sum.cogsAmount ?? 0);
      bucket.revenue += orderRevenue;
      bucket.cogs += orderCogs;
      bucket.quantity += Number(group._sum.quantity ?? 0);
      bucket.salesCount += group._count._all;
      bucket.orderIds.add(group.salesOrderId);
      revenue += orderRevenue;
      cogs += orderCogs;

      const missing = missingByOrder.get(group.salesOrderId);
      if (missing) {
        const missingRevenue =
          Number(missing._sum.lineTotal ?? 0) - Number(missing._sum.taxAmount ?? 0);
        bucket.linesMissingCost += missing._count._all;
        bucket.revenueMissingCost += missingRevenue;
        linesMissingCost += missing._count._all;
        revenueMissingCost += missingRevenue;
      }
    }

    const customers = [...buckets.values()].map((bucket) => {
      const rowRevenue = roundMoney(bucket.revenue);
      const rowCogs = roundMoney(bucket.cogs);
      const rowGrossProfit = roundMoney(rowRevenue - rowCogs);
      return {
        customerId: bucket.customerId,
        customerName: bucket.customerName ?? (bucket.customerId ? null : 'Unassigned / Walk-in'),
        revenue: rowRevenue,
        cogs: rowCogs,
        grossProfit: rowGrossProfit,
        grossMarginPct: rowRevenue > 0 ? roundPercent((rowGrossProfit / rowRevenue) * 100) : 0,
        quantity: bucket.quantity,
        orderCount: bucket.orderIds.size,
        lineCount: bucket.salesCount,
        linesMissingCost: bucket.linesMissingCost,
        revenueMissingCost: roundMoney(bucket.revenueMissingCost),
        hasMissingCost: bucket.linesMissingCost > 0,
      };
    });
    // Sort by profit desc (task requirement); tie-break on revenue desc for stability.
    customers.sort((a, b) => b.grossProfit - a.grossProfit || b.revenue - a.revenue);

    revenue = roundMoney(revenue);
    cogs = roundMoney(cogs);
    const grossProfit = roundMoney(revenue - cogs);
    return {
      summary: {
        revenue,
        cogs,
        grossProfit,
        grossMarginPct: revenue > 0 ? roundPercent((grossProfit / revenue) * 100) : 0,
        customerCount: customers.length,
        linesMissingCost,
        revenueMissingCost: roundMoney(revenueMissingCost),
      },
      customers,
    };
  }

  async costGaps(query: ProfitQuery, user: AuthUser) {
    const companyWhere = await this.companyScope.companyWhereFor(user, query.companyId);
    const productWhere: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      trackInventory: true,
      productType: { notIn: ['SERVICE', 'NON_STOCK_ITEM'] as any },
      ...companyWhere,
      ...(query.divisionId ? { OR: [{ divisionId: query.divisionId }, { divisionId: null }] } : {}),
    };
    const [masterCostGaps, stockCostGaps] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          ...productWhere,
          AND: [
            { OR: [{ defaultPurchasePrice: null }, { defaultPurchasePrice: { lte: 0 } }] },
            {
              OR: [
                { productFamilyId: null },
                {
                  productFamily: {
                    is: {
                      OR: [{ defaultPurchasePrice: null }, { defaultPurchasePrice: { lte: 0 } }],
                    },
                  },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          productCode: true,
          name: true,
          companyId: true,
          divisionId: true,
          defaultPurchasePrice: true,
          productFamily: { select: { defaultPurchasePrice: true } },
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
        },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      this.prisma.inventoryBalance.findMany({
        where: {
          ...companyWhere,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          quantityOnHand: { gt: 0 },
          averageCost: { lte: 0 },
          product: productWhere,
        },
        include: {
          product: {
            select: {
              id: true,
              productCode: true,
              name: true,
              defaultPurchasePrice: true,
              productFamily: { select: { defaultPurchasePrice: true } },
            },
          },
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
    ]);

    const rows = [
      ...masterCostGaps.map((product) => ({
        type: 'PRODUCT_MASTER_COST',
        productId: product.id,
        productCode: product.productCode,
        productName: product.name,
        company: product.company,
        division: product.division,
        branch: null,
        quantityOnHand: null,
        averageCost: null,
        defaultPurchasePrice: Number(
          product.defaultPurchasePrice ?? product.productFamily?.defaultPurchasePrice ?? 0,
        ),
        message: 'Product master purchase cost is missing or zero.',
      })),
      ...stockCostGaps.map((balance) => ({
        type: 'STOCK_AVERAGE_COST',
        productId: balance.productId,
        productCode: balance.product.productCode,
        productName: balance.product.name,
        company: balance.company,
        division: balance.division,
        branch: balance.branch,
        quantityOnHand: Number(balance.quantityOnHand),
        averageCost: Number(balance.averageCost),
        defaultPurchasePrice: Number(
          balance.product.defaultPurchasePrice ??
            balance.product.productFamily?.defaultPurchasePrice ??
            0,
        ),
        message: 'Branch stock exists with missing or zero average cost.',
      })),
    ];

    return { rows, total: rows.length };
  }

  async productLedger(productId: string, query: ProfitQuery, user: AuthUser) {
    const salesOrderWhere = await this.salesOrderWhere(query, user);
    const rows = await this.prisma.salesOrderLine.findMany({
      where: { productId, salesOrder: salesOrderWhere },
      include: {
        salesOrder: {
          select: {
            id: true,
            salesOrderNumber: true,
            orderDate: true,
            customerName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 250,
    });
    return rows.map((line) => ({
      salesOrderId: line.salesOrder.id,
      salesOrderNumber: line.salesOrder.salesOrderNumber,
      orderDate: line.salesOrder.orderDate,
      customerName: line.salesOrder.customerName,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountAmount: Number(line.discountAmount ?? 0),
      unitCostAtSale: line.unitCostAtSale == null ? null : Number(line.unitCostAtSale),
      cogsAmount: Number(line.cogsAmount ?? 0),
      grossProfitAmount: Number(line.grossProfitAmount ?? 0),
      grossMarginPct: line.grossMarginPct == null ? null : Number(line.grossMarginPct),
      profitCostSource: line.profitCostSource,
    }));
  }

  async belowCostAttempts(query: ProfitQuery, user: AuthUser) {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const where: Prisma.AuditLogWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
      action: 'PROFIT_VALIDATION_BLOCKED',
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: dateRangeStart(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: dateRangeEnd(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          company: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        company: row.company,
        user: row.user,
        source: readJsonField(row.metadata, 'source'),
        referenceType: readJsonField(row.metadata, 'referenceType'),
        referenceId: readJsonField(row.metadata, 'referenceId'),
        message: readJsonField(row.metadata, 'message'),
        lines: readJsonField(row.newValue, 'lines') ?? [],
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async fixCostGap(productId: string, body: CostFixInput, user: AuthUser) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        divisionId: true,
        productCode: true,
        name: true,
        defaultPurchasePrice: true,
      },
    });
    if (!product) throw new BadRequestException('Product was not found');
    await this.companyScope.assertCanAccessCompany(user, product.companyId, AccessLevel.WRITE);

    // Validate inputs up-front so a bad request never commits a partial change.
    let defaultPurchasePrice: Prisma.Decimal | null = null;
    if (body.defaultPurchasePrice !== undefined && body.defaultPurchasePrice !== null) {
      const value = Number(body.defaultPurchasePrice);
      if (!Number.isFinite(value) || value <= 0) {
        throw new BadRequestException('Default purchase cost must be greater than zero');
      }
      defaultPurchasePrice = new Prisma.Decimal(body.defaultPurchasePrice);
    }

    let averageCost: Prisma.Decimal | null = null;
    if (body.branchId && body.averageCost !== undefined && body.averageCost !== null) {
      const value = Number(body.averageCost);
      if (!Number.isFinite(value) || value <= 0) {
        throw new BadRequestException('Branch average cost must be greater than zero');
      }
      averageCost = new Prisma.Decimal(body.averageCost);
    }

    if (!defaultPurchasePrice && !averageCost) {
      throw new BadRequestException(
        'Provide a default purchase cost or branch average cost to update',
      );
    }

    // ITMB-AUDIT-28: both money writes (product cost + inventory balance) must commit
    // atomically, otherwise a failing branch-balance lookup leaves the product price
    // mutated with no inventory update and no audit trail. Do the money math with
    // Prisma.Decimal and write Decimal into the Decimal columns (totalValue is additive-
    // free here: a manual fix recomputes value = onHand * averageCost for the corrected
    // average), then only log PROFIT_COST_FIX once the transaction has committed.
    const changes = await this.prisma.$transaction(async (tx) => {
      const txChanges: Record<string, unknown> = {};

      if (defaultPurchasePrice) {
        await tx.product.update({
          where: { id: productId },
          data: { defaultPurchasePrice },
        });
        txChanges.defaultPurchasePrice = defaultPurchasePrice.toNumber();
      }

      if (averageCost && body.branchId) {
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            companyId: product.companyId,
            productId,
            branchId: body.branchId,
          },
          select: { id: true, quantityOnHand: true },
        });
        if (!balance) {
          throw new BadRequestException('No branch inventory balance exists for this product');
        }
        const quantityOnHand = new Prisma.Decimal(balance.quantityOnHand ?? 0);
        const totalValue = quantityOnHand.mul(averageCost);
        await tx.inventoryBalance.update({
          where: { id: balance.id },
          data: {
            averageCost,
            totalValue,
          },
        });
        txChanges.branchId = body.branchId;
        txChanges.averageCost = averageCost.toNumber();
        txChanges.totalValue = totalValue.toNumber();
      }

      return txChanges;
    });

    await this.auditLogs.log({
      action: 'PROFIT_COST_FIX',
      entityType: 'Product',
      entityId: productId,
      companyId: product.companyId,
      userId: user.id,
      newValue: {
        productCode: product.productCode,
        productName: product.name,
        ...changes,
      },
      severity: AuditSeverity.HIGH,
    });

    return { productId, changes };
  }

  async backfillHistoricalSales(query: ProfitQuery, user: AuthUser) {
    const limit = Math.min(Math.max(Number(query.limit ?? 1000), 1), 5000);
    const salesOrderWhere = await this.salesOrderWhere(query, user);
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        salesOrder: salesOrderWhere,
        OR: [
          { unitCostAtSale: null },
          { cogsAmount: null },
          { grossProfitAmount: null },
          { grossMarginPct: null },
          { profitCostSource: null },
        ],
      },
      include: {
        product: {
          select: {
            id: true,
            companyId: true,
            name: true,
            productType: true,
            trackInventory: true,
            defaultPurchasePrice: true,
            productFamily: { select: { defaultPurchasePrice: true } },
          },
        },
        salesOrder: {
          select: {
            id: true,
            salesOrderNumber: true,
            companyId: true,
            branchId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let updated = 0;
    let skipped = 0;
    const skippedSamples: Array<{ salesOrderNumber: string; productName: string; reason: string }> =
      [];

    for (const line of lines) {
      try {
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.unitPrice);
        const discountAmount = Number(line.discountAmount ?? 0);
        const netSalesAmount = roundMoney(quantity * unitPrice - discountAmount);
        if (!Number.isFinite(quantity) || quantity <= 0 || netSalesAmount <= 0) {
          throw new Error('Line quantity or net sales amount is invalid');
        }

        let snapshot: SaleLineProfitSnapshot;
        if (!this.isStockProduct(line.product)) {
          snapshot = {
            productId: line.productId,
            productName: line.product.name,
            trackInventory: false,
            unitCostAtSale: null,
            cogsAmount: 0,
            grossProfitAmount: netSalesAmount,
            grossMarginPct: 100,
            profitCostSource: null,
            netSalesAmount,
            netUnitPrice: netSalesAmount / quantity,
          };
        } else {
          const balance = line.salesOrder.branchId
            ? await this.prisma.inventoryBalance.findFirst({
                where: {
                  companyId: line.salesOrder.companyId,
                  productId: line.productId,
                  branchId: line.salesOrder.branchId,
                },
                select: { productId: true, quantityOnHand: true, averageCost: true },
              })
            : null;
          const cost = this.resolveEffectiveCost(line.product, balance, line.salesOrder.branchId);
          const cogsAmount = roundMoney(quantity * cost.unitCost);
          const grossProfitAmount = roundMoney(netSalesAmount - cogsAmount);
          snapshot = {
            productId: line.productId,
            productName: line.product.name,
            trackInventory: true,
            unitCostAtSale: roundCost(cost.unitCost),
            cogsAmount,
            grossProfitAmount,
            grossMarginPct: roundPercent((grossProfitAmount / netSalesAmount) * 100),
            profitCostSource: cost.source,
            netSalesAmount,
            netUnitPrice: netSalesAmount / quantity,
          };
        }

        await this.prisma.salesOrderLine.update({
          where: { id: line.id },
          data: salesLineProfitData(snapshot),
        });
        updated += 1;
      } catch (error) {
        skipped += 1;
        if (skippedSamples.length < 10) {
          skippedSamples.push({
            salesOrderNumber: line.salesOrder.salesOrderNumber,
            productName: line.product.name,
            reason: error instanceof Error ? error.message : 'Unknown backfill error',
          });
        }
      }
    }

    await this.auditLogs.log({
      action: 'PROFIT_BACKFILL_RUN',
      entityType: 'Profit',
      companyId: query.companyId || undefined,
      userId: user.id,
      newValue: { updated, skipped, skippedSamples },
      severity: skipped > 0 ? AuditSeverity.MEDIUM : AuditSeverity.LOW,
    });

    return { scanned: lines.length, updated, skipped, skippedSamples };
  }

  async exportReport(query: ProfitQuery, user: AuthUser) {
    const report = query.report || 'product-summary';
    const format = (query.format || 'csv').toLowerCase();
    let rows: Array<Record<string, unknown>>;
    let fileName: string;

    if (report === 'cost-gaps') {
      const payload = await this.costGaps(query, user);
      rows = payload.rows.map((row) => ({
        type: row.type,
        productCode: row.productCode,
        productName: row.productName,
        company: row.company?.code ?? row.company?.name ?? '',
        division: row.division?.code ?? row.division?.name ?? '',
        branch: row.branch?.code ?? row.branch?.name ?? '',
        quantityOnHand: row.quantityOnHand,
        averageCost: row.averageCost,
        defaultPurchasePrice: row.defaultPurchasePrice,
        message: row.message,
      }));
      fileName = 'profit-cost-gaps';
    } else if (report === 'below-cost-attempts') {
      const payload = await this.belowCostAttempts(query, user);
      rows = payload.rows.map((row) => ({
        createdAt: row.createdAt,
        company: row.company?.code ?? row.company?.name ?? '',
        user: row.user?.email ?? row.user?.fullName ?? '',
        source: row.source,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        message: row.message,
      }));
      fileName = 'below-cost-attempt-audit';
    } else if (report === 'customer-summary') {
      const payload = await this.customerSummary(query, user);
      rows = payload.customers.map((row) => ({
        customerName: row.customerName,
        revenue: row.revenue,
        cogs: row.cogs,
        grossProfit: row.grossProfit,
        grossMarginPct: row.grossMarginPct,
        quantity: row.quantity,
        orderCount: row.orderCount,
        lineCount: row.lineCount,
        linesMissingCost: row.linesMissingCost,
      }));
      fileName = 'customer-profitability';
    } else {
      const payload = await this.productSummary(query, user);
      rows = payload.products.map((row) => ({
        productCode: row.productCode,
        productName: row.productName,
        quantity: row.quantity,
        revenue: row.revenue,
        cogs: row.cogs,
        grossProfit: row.grossProfit,
        grossMarginPct: row.grossMarginPct,
        salesCount: row.salesCount,
      }));
      fileName = 'product-profitability';
    }

    await this.auditLogs.log({
      action: 'PROFIT_REPORT_EXPORT',
      entityType: 'ProfitReport',
      companyId: query.companyId || undefined,
      userId: user.id,
      newValue: { report, format, rowCount: rows.length },
      severity: AuditSeverity.MEDIUM,
    });

    if (format === 'json') {
      return { fileName: `${fileName}.json`, format, rows };
    }

    return {
      fileName: `${fileName}.csv`,
      format: 'csv',
      contentType: 'text/csv',
      content: toCsv(rows),
    };
  }

  private resolveEffectiveCost(
    product: ProductForProfit,
    balance: BalanceForProfit,
    branchId?: string | null,
  ): { unitCost: number; source: ProfitCostSource } {
    if (!branchId) {
      throw new BadRequestException(
        `Branch/location is required to validate profit for ${product.name}`,
      );
    }

    const balanceQty = Number(balance?.quantityOnHand ?? 0);
    const averageCost = Number(balance?.averageCost ?? 0);
    if (balance && balanceQty > 0 && (!Number.isFinite(averageCost) || averageCost <= 0)) {
      throw new BadRequestException(
        `${product.name} has stock at this branch with missing cost. Fix inventory average cost before selling.`,
      );
    }
    if (Number.isFinite(averageCost) && averageCost > 0) {
      return { unitCost: averageCost, source: ProfitCostSource.BRANCH_AVERAGE_COST };
    }

    const defaultCost = Number(
      product.defaultPurchasePrice ?? product.productFamily?.defaultPurchasePrice ?? 0,
    );
    if (Number.isFinite(defaultCost) && defaultCost > 0) {
      return { unitCost: defaultCost, source: ProfitCostSource.DEFAULT_PURCHASE_PRICE };
    }

    throw new BadRequestException(`${product.name} is missing purchase cost and cannot be sold`);
  }

  private async salesOrderWhere(query: ProfitQuery, user: AuthUser) {
    return {
      deletedAt: null,
      status: { in: PROFIT_SALES_STATUSES },
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
      // A division filter must scope by the branch's division too: SalesOrder.divisionId
      // is nullable and legacy orders can carry a branch with a null divisionId, so a bare
      // `divisionId` equality silently drops in-division orders. Match either the order's own
      // division or the division of its branch.
      ...(query.divisionId
        ? { OR: [{ divisionId: query.divisionId }, { branch: { divisionId: query.divisionId } }] }
        : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            orderDate: {
              ...(query.dateFrom ? { gte: dateRangeStart(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: dateRangeEnd(query.dateTo) } : {}),
            },
          }
        : {}),
    } satisfies Prisma.SalesOrderWhereInput;
  }

  private async logProfitValidationFailure(
    input: ValidateSaleLinesInput,
    error: unknown,
    auditContext: ProfitAuditContext,
  ) {
    const message = error instanceof Error ? error.message : 'Profit validation failed';
    await this.auditLogs.log({
      action: 'PROFIT_VALIDATION_BLOCKED',
      entityType: 'ProfitValidation',
      entityId: auditContext.referenceId || undefined,
      companyId: input.companyId,
      userId: auditContext.user?.id,
      newValue: {
        lines: input.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount ?? 0,
        })),
      },
      metadata: {
        source: auditContext.source ?? 'Unknown',
        referenceType: auditContext.referenceType,
        referenceId: auditContext.referenceId,
        branchId: input.branchId,
        message,
      },
      severity: AuditSeverity.HIGH,
    });
  }
}

function salesLineProfitData(snapshot: SaleLineProfitSnapshot): Prisma.SalesOrderLineUpdateInput {
  return {
    unitCostAtSale: snapshot.unitCostAtSale,
    cogsAmount: snapshot.cogsAmount,
    grossProfitAmount: snapshot.grossProfitAmount,
    grossMarginPct: snapshot.grossMarginPct,
    profitCostSource: snapshot.profitCostSource,
  };
}

function readJsonField(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  return lines.join('\n');
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundCost(value: number) {
  return Math.round(value * 10000) / 10000;
}

function roundPercent(value: number) {
  return Math.round(value * 10000) / 10000;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
