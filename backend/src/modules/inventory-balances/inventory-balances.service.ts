import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryInventoryBalanceDto } from './dto/query-inventory-balance.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

/**
 * Drop the internal Decimal / classification fields used only for accurate
 * aggregation so the per-item JSON keeps its original public shape (Number
 * money fields, no Prisma.Decimal objects leaking into the response).
 */
function stripDecimalInternals<
  T extends {
    totalValueDecimal?: unknown;
    riskValueDecimal?: unknown;
    negativeOnHand?: unknown;
    oversold?: unknown;
    isCritical?: unknown;
  },
>(item: T) {
  const { totalValueDecimal, riskValueDecimal, negativeOnHand, oversold, isCritical, ...rest } =
    item;
  return rest;
}

@Injectable()
export class InventoryBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryInventoryBalanceDto, user?: any) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    if (this.useLegacyLowStockPath(query)) {
      return this.findLegacyLowStock(query, user);
    }

    const rows = await this.filteredRows(query, user);
    const total = rows.length;
    const data = rows.slice(skip, skip + limit);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  private useLegacyLowStockPath(query: QueryInventoryBalanceDto) {
    return (
      !!query.lowStock &&
      !query.divisionId &&
      !query.branchId &&
      !query.categoryId &&
      !query.productFamilyId &&
      !query.search &&
      !query.stockStatus &&
      !query.costStatus &&
      !query.staleDays
    );
  }

  private async findLegacyLowStock(query: QueryInventoryBalanceDto, user?: any) {
    const { page = 1, limit = 20, companyId, productId, locationId } = query;
    const skip = (page - 1) * limit;
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (productId) where.productId = productId;
    if (locationId) where.branchId = locationId;

    const ids = await this.lowStockBalanceIds(where);
    const total = ids.length;
    const pageIds = ids.slice(skip, skip + limit);
    const rows = pageIds.length
      ? await this.prisma.inventoryBalance.findMany({
          where: { id: { in: pageIds } },
          include: this.balanceInclude(),
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = pageIds
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => !!row)
      .map((row) => this.annotateBalance(row, query.staleDays));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  async summary(query: QueryInventoryBalanceDto, user: AuthUser) {
    const rows = await this.filteredRows(query, user);

    return rows.reduce(
      (acc, row) => {
        acc.totalSkus += 1;
        acc.totalValue = Number((acc.totalValue + row.totalValue).toFixed(2));
        if (row.stockStatus === 'OUT_OF_STOCK') acc.outOfStock += 1;
        if (row.stockStatus === 'LOW_STOCK') acc.lowStock += 1;
        if (row.stockStatus === 'OVERSOLD') acc.oversold += 1;
        if (row.costStatus === 'MISSING_COST') acc.missingCost += 1;
        if (row.isStale) acc.staleStock += 1;
        return acc;
      },
      {
        totalSkus: 0,
        totalValue: 0,
        outOfStock: 0,
        lowStock: 0,
        oversold: 0,
        missingCost: 0,
        staleStock: 0,
      },
    );
  }

  private async filteredRows(query: QueryInventoryBalanceDto, user?: any) {
    const where = this.balanceWhere(query, user);
    const rows = await this.prisma.inventoryBalance.findMany({
      where,
      include: this.balanceInclude(),
      orderBy: { updatedAt: 'desc' },
    });

    return rows
      .map((row) => this.annotateBalance(row, query.staleDays))
      .filter((row) => {
        if (query.lowStock && row.stockStatus !== 'LOW_STOCK') return false;
        if (query.stockStatus && row.stockStatus !== query.stockStatus) return false;
        return true;
      });
  }

  private balanceWhere(query: QueryInventoryBalanceDto, user?: any): any {
    const {
      companyId,
      divisionId,
      branchId,
      productId,
      locationId,
      categoryId,
      productFamilyId,
      search,
      costStatus,
      staleDays,
    } = query;

    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (productId) where.productId = productId;
    if (divisionId) where.divisionId = divisionId;
    if (branchId || locationId) where.branchId = branchId || locationId;

    const productWhere: any = {};
    if (categoryId) productWhere.categoryId = categoryId;
    if (productFamilyId) productWhere.productFamilyId = productFamilyId;
    if (search?.trim()) {
      const term = search.trim();
      productWhere.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { productCode: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (Object.keys(productWhere).length > 0) where.product = productWhere;

    const and: any[] = [];
    if (costStatus === 'HAS_COST') and.push({ averageCost: { gt: 0 } });
    if (costStatus === 'MISSING_COST') and.push({ averageCost: { lte: 0 } });
    if (staleDays) {
      const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
      and.push({ OR: [{ lastMovementAt: { lte: cutoff } }, { lastMovementAt: null }] });
    }
    if (and.length) where.AND = [...(where.AND ?? []), ...and];

    return where;
  }

  private balanceInclude() {
    return {
      company: { select: { id: true, name: true, code: true } },
      division: { select: { id: true, name: true, code: true } },
      product: {
        select: {
          id: true,
          name: true,
          productCode: true,
          sku: true,
          barcode: true,
          reorderLevel: true,
          minimumStockLevel: true,
          category: { select: { id: true, name: true, categoryType: true } },
          productFamily: { select: { id: true, name: true, brand: true } },
        },
      },
      branch: { select: { id: true, name: true, code: true } },
    };
  }

  private annotateBalance(row: any, staleDays?: number) {
    const quantityOnHand = Number(row.quantityOnHand ?? 0);
    const quantityReserved = Number(row.quantityReserved ?? 0);
    const quantityAvailable = quantityOnHand - quantityReserved;
    const reorderLevel = Number(
      row.product?.reorderLevel ?? row.product?.minimumStockLevel ?? 10,
    );
    const averageCost = Number(row.averageCost ?? 0);
    const totalValue = Number(row.totalValue ?? 0);
    const daysSinceMovement = row.lastMovementAt
      ? Math.floor((Date.now() - row.lastMovementAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const stockStatus =
      quantityAvailable < 0
        ? 'OVERSOLD'
        : quantityOnHand <= 0
          ? 'OUT_OF_STOCK'
          : quantityOnHand <= reorderLevel
            ? 'LOW_STOCK'
            : 'IN_STOCK';
    const costStatus = averageCost > 0 ? 'HAS_COST' : 'MISSING_COST';
    const isStale =
      !!staleDays && (daysSinceMovement == null || daysSinceMovement >= staleDays);

    return {
      ...row,
      quantityOnHand,
      quantityReserved,
      quantityAvailable,
      reorderLevel,
      averageCost,
      totalValue,
      stockStatus,
      costStatus,
      isStale,
      daysSinceMovement,
    };
  }

  /**
   * Resolve the IDs of low-stock balances under the SAME company scope `findAll`
   * already applied. The company-scope clause is read straight off the Prisma
   * `where` that `applyCompanyScopeWhere` produced — `{ companyId: string }`,
   * `{ companyId: { in: [...] } }`, or the empty-deny sentinel `{ id: { in: [] } }`
   * — so SQL can never widen the scope beyond what Prisma would have allowed. Any
   * other shape is treated as deny rather than risk a cross-company leak.
   *
   * Returned in updatedAt-desc order to match the non-low-stock branch.
   */
  private async lowStockBalanceIds(where: any): Promise<string[]> {
    const scope = this.companyScopeSql(where);
    if (scope === null) return [];

    const conditions: Prisma.Sql[] = [scope];
    if (typeof where.productId === 'string') {
      conditions.push(Prisma.sql`b."productId" = ${where.productId}`);
    }
    if (typeof where.branchId === 'string') {
      conditions.push(Prisma.sql`b."branchId" = ${where.branchId}`);
    }

    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT b.id
      FROM "inventory_balances" b
      JOIN "products" p ON p.id = b."productId"
      WHERE ${Prisma.join(conditions, ' AND ')}
        AND b."quantityOnHand" > 0
        AND b."quantityOnHand" <= COALESCE(p."reorderLevel", p."minimumStockLevel", 10)
      ORDER BY b."updatedAt" DESC
    `);
    return rows.map((r) => r.id);
  }

  /**
   * Translate the company-scope portion of a Prisma `where` into a SQL clause.
   * Returns `null` when the scope can only match nothing (empty-deny sentinel or
   * an unrecognised shape), so the caller short-circuits to an empty result
   * instead of emitting an unscoped query.
   */
  private companyScopeSql(where: any): Prisma.Sql | null {
    const companyId = where?.companyId;
    if (typeof companyId === 'string') {
      return Prisma.sql`b."companyId" = ${companyId}`;
    }
    if (companyId && Array.isArray(companyId.in)) {
      if (companyId.in.length === 0) return null;
      return Prisma.sql`b."companyId" IN (${Prisma.join(companyId.in)})`;
    }
    // The empty-deny sentinel ({ id: { in: [] } }) and any unexpected shape fall
    // through to deny — never run the low-stock query without a company filter.
    return null;
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.inventoryBalance.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            productCode: true,
            reorderLevel: true,
            minimumStockLevel: true,
          },
        },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    if (!record) throw new NotFoundException('Inventory balance not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  /**
   * Live stock view — every product × branch/location pair for a company, with a
   * status flag (OUT / LOW / OK) computed against `lowThreshold` (default 10).
   * Grouped by branch/location for the heatmap UI.
   *
   * The schema has no per-SKU reorder point today, so the threshold is a
   * single configurable knob; future work can replace it with a `Product.reorderPoint`
   * field without breaking the response shape.
   */
  async liveStock(
    query: {
      companyId?: string;
      divisionId?: string;
      branchId?: string;
      lowThreshold?: number;
      search?: string;
    },
    user: AuthUser,
  ) {
    const lowThreshold = Number(query.lowThreshold ?? 10);
    const where: any = {};
    Object.assign(where, await this.companyScope.companyWhereFor(user, query.companyId));
    if (query.divisionId) {
      where.divisionId = query.divisionId;
    }
    if (query.branchId) {
      where.branchId = query.branchId;
    }
    if (query.search) {
      where.product = {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { productCode: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
          { barcode: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const balances = await this.prisma.inventoryBalance.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            productCode: true,
            name: true,
            sku: true,
            barcode: true,
            minimumStockLevel: true,
            reorderLevel: true,
          },
        },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ quantityOnHand: 'asc' }, { product: { name: 'asc' } }],
    });

    const now = Date.now();
    const annotated = balances.map((b) => {
      const onHand = Number(b.quantityOnHand);
      const reserved = Number(b.quantityReserved);
      const available = onHand - reserved;
      const skuThreshold = Number(b.product.reorderLevel ?? b.product.minimumStockLevel ?? 0);
      const effectiveLowThreshold = skuThreshold > 0 ? skuThreshold : lowThreshold;
      const status: 'OUT' | 'LOW' | 'OK' =
        onHand <= 0 ? 'OUT' : available <= effectiveLowThreshold ? 'LOW' : 'OK';
      const daysSinceMovement = b.lastMovementAt
        ? Math.floor((now - b.lastMovementAt.getTime()) / (24 * 3600 * 1000))
        : null;
      const riskScore =
        status === 'OUT'
          ? 100
          : status === 'LOW'
            ? Math.max(50, Math.round((1 - available / Math.max(effectiveLowThreshold, 1)) * 100))
            : reserved > 0 && available <= effectiveLowThreshold * 1.5
              ? 35
              : 0;
      // Critical = anything not OK, or a row whose physical on-hand has gone
      // negative (genuine ledger corruption). Computed once here so the count and
      // the criticalItems list below share one predicate and cannot disagree.
      const negativeOnHand = onHand < 0;
      const oversold = available < 0;
      const isCritical = status !== 'OK' || negativeOnHand;
      // Keep the Decimal columns at full precision for the money reduce; the
      // Number copies below are only for the per-item JSON response.
      const totalValueDecimal = new Prisma.Decimal(b.totalValue ?? 0);
      const riskValueDecimal = status === 'OK' ? new Prisma.Decimal(0) : totalValueDecimal;
      return {
        id: b.id,
        productId: b.productId,
        product: b.product,
        location: b.branch,
        quantityOnHand: onHand,
        quantityReserved: reserved,
        quantityAvailable: available,
        averageCost: Number(b.averageCost),
        totalValue: Number(b.totalValue),
        totalValueDecimal,
        riskValueDecimal,
        lastMovementAt: b.lastMovementAt,
        daysSinceMovement,
        lowThreshold: effectiveLowThreshold,
        riskScore,
        riskValue: status === 'OK' ? 0 : Number(b.totalValue),
        negativeOnHand,
        oversold,
        isCritical,
        status,
      };
    });

    // Per-branch grouping for the heatmap UI.
    const locationMap = new Map<
      string,
      {
        locationId: string;
        locationName: string;
        locationCode: string;
        branchId: string | null;
        itemCount: number;
        out: number;
        low: number;
        ok: number;
        reserved: number;
        available: number;
        riskValue: Prisma.Decimal;
        totalValue: Prisma.Decimal;
        items: typeof annotated;
      }
    >();
    for (const item of annotated) {
      const lid = item.location?.id ?? 'unassigned';
      const entry = locationMap.get(lid) ?? {
        locationId: lid,
        locationName: item.location?.name ?? 'Unassigned branch/location',
        locationCode: item.location?.code ?? '',
        branchId: item.location?.id ?? null,
        itemCount: 0,
        out: 0,
        low: 0,
        ok: 0,
        reserved: 0,
        available: 0,
        riskValue: new Prisma.Decimal(0),
        totalValue: new Prisma.Decimal(0),
        items: [],
      };
      entry.itemCount++;
      entry.totalValue = entry.totalValue.plus(item.totalValueDecimal);
      entry.reserved += item.quantityReserved;
      entry.available += item.quantityAvailable;
      entry.riskValue = entry.riskValue.plus(item.riskValueDecimal);
      if (item.status === 'OUT') entry.out++;
      else if (item.status === 'LOW') entry.low++;
      else entry.ok++;
      entry.items.push(item);
      locationMap.set(lid, entry);
    }

    // Money totals are summed as Prisma.Decimal over the Decimal(18,2) columns so
    // the headline KPIs reconcile exactly to a SQL SUM, instead of drifting via
    // IEEE-754 float accumulation; they are converted to Number only for the JSON.
    const totals = annotated.reduce(
      (acc, it) => {
        acc.totalSkus += 1;
        if (it.status === 'OUT') acc.out += 1;
        if (it.status === 'LOW') acc.low += 1;
        if (it.status === 'OK') acc.ok += 1;
        // Genuine ledger corruption: physical on-hand below zero.
        if (it.negativeOnHand) acc.negative += 1;
        // Normal heavy-reservation oversell, surfaced separately (finding #21).
        if (it.oversold) acc.oversold += 1;
        // Distinct critical-row count so it matches the criticalItems list and
        // never double-counts a row across OUT/LOW/negative (finding #8).
        if (it.isCritical) acc.criticalCount += 1;
        if (it.quantityReserved > 0) acc.reservedSkus += 1;
        acc.totalOnHand += it.quantityOnHand;
        acc.totalReserved += it.quantityReserved;
        acc.totalAvailable += it.quantityAvailable;
        acc.riskValueDecimal = acc.riskValueDecimal.plus(it.riskValueDecimal);
        acc.totalValueDecimal = acc.totalValueDecimal.plus(it.totalValueDecimal);
        return acc;
      },
      {
        totalSkus: 0,
        out: 0,
        low: 0,
        ok: 0,
        negative: 0,
        oversold: 0,
        criticalCount: 0,
        reservedSkus: 0,
        totalOnHand: 0,
        totalReserved: 0,
        totalAvailable: 0,
        riskValueDecimal: new Prisma.Decimal(0),
        totalValueDecimal: new Prisma.Decimal(0),
      },
    );

    const {
      riskValueDecimal: totalsRiskValueDecimal,
      totalValueDecimal: totalsTotalValueDecimal,
      ...totalsCounts
    } = totals;
    const totalsOut = {
      ...totalsCounts,
      riskValue: totalsRiskValueDecimal.toNumber(),
      totalValue: totalsTotalValueDecimal.toNumber(),
    };

    return {
      lowThreshold,
      totals: totalsOut,
      risk: {
        // One distinct count per critical row — see the isCritical predicate above.
        criticalCount: totals.criticalCount,
        criticalValue: totalsRiskValueDecimal.toNumber(),
        reservationPressure:
          totals.totalOnHand > 0 ? (totals.totalReserved / totals.totalOnHand) * 100 : 0,
        criticalItems: annotated
          .filter((item) => item.isCritical)
          .sort((a, b) => b.riskScore - a.riskScore || b.riskValue - a.riskValue)
          .slice(0, 12)
          .map(stripDecimalInternals),
        staleItems: annotated
          .filter((item) => (item.daysSinceMovement ?? 0) >= 30 && item.quantityOnHand > 0)
          .sort((a, b) => (b.daysSinceMovement ?? 0) - (a.daysSinceMovement ?? 0))
          .slice(0, 12)
          .map(stripDecimalInternals),
      },
      locations: Array.from(locationMap.values())
        .sort(
          (a, b) => b.out + b.low - (a.out + a.low) || a.locationName.localeCompare(b.locationName),
        )
        .map((loc) => ({
          ...loc,
          riskValue: loc.riskValue.toNumber(),
          totalValue: loc.totalValue.toNumber(),
          items: loc.items.map(stripDecimalInternals),
        })),
    };
  }
}
