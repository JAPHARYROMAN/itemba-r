import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccessLevel,
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

const STOCK_EXEMPT_TYPES = new Set(['SERVICE', 'NON_STOCK_ITEM']);
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

type DbClient = PrismaService | Prisma.TransactionClient;

type ProductForProfit = {
  id: string;
  companyId: string;
  name: string;
  productType: string;
  trackInventory: boolean;
  defaultPurchasePrice: Prisma.Decimal | number | string | null;
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

@Injectable()
export class ProfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
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
    data: { companyId: string; productId: string; movementType: InventoryMovementType; unitCost?: number },
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
    const lines = await this.validateSaleLines(input);
    return {
      success: true,
      data: {
        lines,
        hasBlockingErrors: false,
      },
    };
  }

  async assertSaleLinesProfitable(
    input: ValidateSaleLinesInput,
    db: DbClient = this.prisma,
  ): Promise<SaleLineProfitSnapshot[]> {
    return this.validateSaleLines(input, db);
  }

  async validateSaleLines(
    input: ValidateSaleLinesInput,
    db: DbClient = this.prisma,
  ): Promise<SaleLineProfitSnapshot[]> {
    if (!input.companyId) throw new BadRequestException('Company is required for profit validation');
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
        throw new BadRequestException(`Selling price for ${product.name} must be greater than zero`);
      }
      if (!Number.isFinite(discountAmount) || discountAmount < 0) {
        throw new BadRequestException(`Discount for ${product.name} cannot be negative`);
      }

      const netSalesAmount = roundMoney(quantity * unitPrice - discountAmount);
      if (netSalesAmount <= 0) {
        throw new BadRequestException(`Net sales amount for ${product.name} must be greater than zero`);
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

      const cost = this.resolveEffectiveCost(product, balanceByProductId.get(product.id) ?? null, input.branchId);
      if (netUnitPrice <= cost.unitCost) {
        throw new BadRequestException(
          `${product.name} cannot be sold below cost. Net unit price ${formatMoney(netUnitPrice)} must be greater than cost ${formatMoney(cost.unitCost)}.`,
        );
      }
      const cogsAmount = roundMoney(quantity * cost.unitCost);
      const grossProfitAmount = roundMoney(netSalesAmount - cogsAmount);
      const grossMarginPct = netSalesAmount > 0 ? roundPercent((grossProfitAmount / netSalesAmount) * 100) : null;

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

  async productSummary(query: Record<string, string | undefined>, user: AuthUser) {
    const salesOrderWhere = await this.salesOrderWhere(query, user);
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        salesOrder: salesOrderWhere,
        ...(query.productId ? { productId: query.productId } : {}),
      },
      include: {
        product: { select: { id: true, productCode: true, name: true } },
        salesOrder: {
          select: {
            id: true,
            salesOrderNumber: true,
            orderDate: true,
            companyId: true,
            divisionId: true,
            branchId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const byProduct = new Map<string, any>();
    let revenue = 0;
    let cogs = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const netSalesAmount = roundMoney(
        quantity * Number(line.unitPrice) - Number(line.discountAmount ?? 0),
      );
      const lineCogs = Number(line.cogsAmount ?? 0);
      revenue += netSalesAmount;
      cogs += lineCogs;
      const key = line.productId;
      const row =
        byProduct.get(key) ??
        {
          productId: key,
          productCode: line.product.productCode,
          productName: line.product.name,
          quantity: 0,
          revenue: 0,
          cogs: 0,
          grossProfit: 0,
          grossMarginPct: 0,
          salesCount: 0,
        };
      row.quantity += quantity;
      row.revenue += netSalesAmount;
      row.cogs += lineCogs;
      row.grossProfit = row.revenue - row.cogs;
      row.grossMarginPct = row.revenue > 0 ? roundPercent((row.grossProfit / row.revenue) * 100) : 0;
      row.salesCount += 1;
      byProduct.set(key, row);
    }

    const grossProfit = roundMoney(revenue - cogs);
    const gaps = await this.costGaps(query, user);
    return {
      success: true,
      data: {
        summary: {
          revenue: roundMoney(revenue),
          cogs: roundMoney(cogs),
          grossProfit,
          grossMarginPct: revenue > 0 ? roundPercent((grossProfit / revenue) * 100) : 0,
          costGaps: gaps.data.total,
        },
        products: Array.from(byProduct.values()).map((row) => ({
          ...row,
          revenue: roundMoney(row.revenue),
          cogs: roundMoney(row.cogs),
          grossProfit: roundMoney(row.grossProfit),
        })),
      },
    };
  }

  async costGaps(query: Record<string, string | undefined>, user: AuthUser) {
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
          OR: [{ defaultPurchasePrice: null }, { defaultPurchasePrice: { lte: 0 } }],
        },
        select: {
          id: true,
          productCode: true,
          name: true,
          companyId: true,
          divisionId: true,
          defaultPurchasePrice: true,
          company: { select: { name: true, code: true } },
          division: { select: { name: true, code: true } },
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
          product: { select: { id: true, productCode: true, name: true, defaultPurchasePrice: true } },
          company: { select: { name: true, code: true } },
          division: { select: { name: true, code: true } },
          branch: { select: { name: true, code: true } },
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
        defaultPurchasePrice: Number(product.defaultPurchasePrice ?? 0),
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
        defaultPurchasePrice: Number(balance.product.defaultPurchasePrice ?? 0),
        message: 'Branch stock exists with missing or zero average cost.',
      })),
    ];

    return { success: true, data: { rows, total: rows.length } };
  }

  async productLedger(productId: string, query: Record<string, string | undefined>, user: AuthUser) {
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
    return {
      success: true,
      data: rows.map((line) => ({
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
      })),
    };
  }

  private resolveEffectiveCost(
    product: ProductForProfit,
    balance: BalanceForProfit,
    branchId?: string | null,
  ): { unitCost: number; source: ProfitCostSource } {
    if (!branchId) {
      throw new BadRequestException(`Branch/location is required to validate profit for ${product.name}`);
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

    const defaultCost = Number(product.defaultPurchasePrice ?? 0);
    if (Number.isFinite(defaultCost) && defaultCost > 0) {
      return { unitCost: defaultCost, source: ProfitCostSource.DEFAULT_PURCHASE_PRICE };
    }

    throw new BadRequestException(`${product.name} is missing purchase cost and cannot be sold`);
  }

  private async salesOrderWhere(query: Record<string, string | undefined>, user: AuthUser) {
    return {
      deletedAt: null,
      status: { in: PROFIT_SALES_STATUSES },
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
      ...(query.divisionId ? { divisionId: query.divisionId } : {}),
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

