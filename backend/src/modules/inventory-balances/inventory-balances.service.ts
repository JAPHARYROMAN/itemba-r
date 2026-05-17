import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryInventoryBalanceDto } from './dto/query-inventory-balance.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

@Injectable()
export class InventoryBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryInventoryBalanceDto, user?: any) {
    const { page = 1, limit = 20, companyId, productId, locationId, lowStock } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    if (productId) where.productId = productId;
    if (locationId) where.branchId = locationId;
    if (lowStock) where.quantityOnHand = { lte: 0 };

    const [data, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.inventoryBalance.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
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
    query: { companyId?: string; branchId?: string; lowThreshold?: number; search?: string },
    user: AuthUser,
  ) {
    const lowThreshold = Number(query.lowThreshold ?? 10);
    const where: any = {};
    Object.assign(where, await this.companyScope.companyWhereFor(user, query.companyId));
    if (query.branchId) {
      where.branchId = query.branchId;
    }
    if (query.search) {
      where.product = {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const balances = await this.prisma.inventoryBalance.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ quantityOnHand: 'asc' }, { product: { name: 'asc' } }],
    });

    const annotated = balances.map((b) => {
      const onHand = Number(b.quantityOnHand);
      const reserved = Number(b.quantityReserved);
      const available = onHand - reserved;
      const status: 'OUT' | 'LOW' | 'OK' =
        onHand <= 0 ? 'OUT' : onHand <= lowThreshold ? 'LOW' : 'OK';
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
        lastMovementAt: b.lastMovementAt,
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
        totalValue: number;
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
        totalValue: 0,
        items: [],
      };
      entry.itemCount++;
      entry.totalValue += item.totalValue;
      if (item.status === 'OUT') entry.out++;
      else if (item.status === 'LOW') entry.low++;
      else entry.ok++;
      entry.items.push(item);
      locationMap.set(lid, entry);
    }

    const totals = annotated.reduce(
      (acc, it) => ({
        ...acc,
        totalSkus: acc.totalSkus + 1,
        out: acc.out + (it.status === 'OUT' ? 1 : 0),
        low: acc.low + (it.status === 'LOW' ? 1 : 0),
        ok: acc.ok + (it.status === 'OK' ? 1 : 0),
        totalValue: acc.totalValue + it.totalValue,
      }),
      { totalSkus: 0, out: 0, low: 0, ok: 0, totalValue: 0 },
    );

    return {
      lowThreshold,
      totals,
      locations: Array.from(locationMap.values()).sort(
        (a, b) => b.out + b.low - (a.out + a.low) || a.locationName.localeCompare(b.locationName),
      ),
    };
  }
}
