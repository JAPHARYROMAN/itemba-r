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
    const lines = await this.assertSaleLinesProfitable(input, this.prisma, {
      user,
      source: 'ManualSaleLineValidation',
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
      summary: {
        revenue: roundMoney(revenue),
        cogs: roundMoney(cogs),
        grossProfit,
        grossMarginPct: revenue > 0 ? roundPercent((grossProfit / revenue) * 100) : 0,
        costGaps: gaps.total,
      },
      products: Array.from(byProduct.values()).map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
        cogs: roundMoney(row.cogs),
        grossProfit: roundMoney(row.grossProfit),
      })),
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
          product: { select: { id: true, productCode: true, name: true, defaultPurchasePrice: true } },
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

    return { rows, total: rows.length };
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

  async belowCostAttempts(query: Record<string, string | undefined>, user: AuthUser) {
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

    const changes: Record<string, unknown> = {};
    if (body.defaultPurchasePrice !== undefined && body.defaultPurchasePrice !== null) {
      const defaultPurchasePrice = Number(body.defaultPurchasePrice);
      if (!Number.isFinite(defaultPurchasePrice) || defaultPurchasePrice <= 0) {
        throw new BadRequestException('Default purchase cost must be greater than zero');
      }
      await this.prisma.product.update({
        where: { id: productId },
        data: { defaultPurchasePrice },
      });
      changes.defaultPurchasePrice = defaultPurchasePrice;
    }

    if (body.branchId && body.averageCost !== undefined && body.averageCost !== null) {
      const averageCost = Number(body.averageCost);
      if (!Number.isFinite(averageCost) || averageCost <= 0) {
        throw new BadRequestException('Branch average cost must be greater than zero');
      }
      const balance = await this.prisma.inventoryBalance.findFirst({
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
      const quantityOnHand = Number(balance.quantityOnHand ?? 0);
      await this.prisma.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          averageCost,
          totalValue: roundMoney(quantityOnHand * averageCost),
        },
      });
      changes.branchId = body.branchId;
      changes.averageCost = averageCost;
      changes.totalValue = roundMoney(quantityOnHand * averageCost);
    }

    if (!Object.keys(changes).length) {
      throw new BadRequestException('Provide a default purchase cost or branch average cost to update');
    }

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

  async backfillHistoricalSales(query: Record<string, string | undefined>, user: AuthUser) {
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
    const skippedSamples: Array<{ salesOrderNumber: string; productName: string; reason: string }> = [];

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

  async exportReport(query: Record<string, string | undefined>, user: AuthUser) {
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
