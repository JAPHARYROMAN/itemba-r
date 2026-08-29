import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { QueryInventoryMovementDto } from './dto/query-inventory-movement.dto';
import { AccessLevel, InventoryMovement, InventoryMovementType, Prisma } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { ProfitService } from '../profit/profit.service';

const INBOUND_TYPES: InventoryMovementType[] = [
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
];

const OUTBOUND_TYPES: InventoryMovementType[] = [
  'SALE_ISSUE',
  'PURCHASE_RETURN',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_OUT',
];

interface BalanceLockRow {
  id: string;
  quantityOnHand: Prisma.Decimal;
  quantityReserved: Prisma.Decimal;
  averageCost: Prisma.Decimal;
  totalValue: Prisma.Decimal;
}

type MovementScope = {
  divisionId?: string;
  branchId: string;
};

@Injectable()
export class InventoryMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
    private readonly profit: ProfitService,
  ) {}

  private async buildMovementWhere(query: QueryInventoryMovementDto, user: AuthUser) {
    const {
      companyId,
      divisionId,
      branchId,
      productId,
      locationId,
      movementType,
      referenceType,
      referenceId,
      dateFrom,
      dateTo,
    } = query;

    const where: any = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (productId) where.productId = productId;
    if (branchId || locationId) where.branchId = branchId || locationId;
    if (movementType) where.movementType = movementType;
    if (referenceType) where.referenceType = referenceType;
    if (referenceId) where.referenceId = referenceId;
    if (dateFrom || dateTo) {
      where.movementDate = {};
      if (dateFrom) where.movementDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.movementDate.lte = dateRangeEnd(dateTo);
    }
    return where;
  }

  async findAll(query: QueryInventoryMovementDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = await this.buildMovementWhere(query, user);

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true, productCode: true } },
          branch: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { movementDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Register-wide aggregates for the movements list stat cards. Uses the SAME
   * `where` as findAll (minus pagination) so the totals always describe the
   * currently-filtered slice, then groups by movementType and sums quantity +
   * totalCost. Direction-aware roll-ups (inbound vs outbound) let the UI show
   * net stock flow without re-deriving the classification client-side.
   */
  async summary(query: QueryInventoryMovementDto, user: AuthUser) {
    const where = await this.buildMovementWhere(query, user);

    const [grouped, totals] = await Promise.all([
      this.prisma.inventoryMovement.groupBy({
        by: ['movementType'],
        where,
        _sum: { quantity: true, totalCost: true },
        _count: { _all: true },
      }),
      this.prisma.inventoryMovement.aggregate({
        where,
        _sum: { quantity: true, totalCost: true },
        _count: { _all: true },
      }),
    ]);

    const byType = grouped.map((row) => {
      const quantity = Number(row._sum.quantity ?? 0);
      const totalCost = Number(row._sum.totalCost ?? 0);
      return {
        movementType: row.movementType,
        direction: INBOUND_TYPES.includes(row.movementType)
          ? 'INBOUND'
          : OUTBOUND_TYPES.includes(row.movementType)
            ? 'OUTBOUND'
            : 'UNKNOWN',
        count: row._count._all,
        quantity,
        totalCost,
      };
    });

    const inboundQuantity = byType
      .filter((r) => r.direction === 'INBOUND')
      .reduce((sum, r) => sum + r.quantity, 0);
    const outboundQuantity = byType
      .filter((r) => r.direction === 'OUTBOUND')
      .reduce((sum, r) => sum + r.quantity, 0);
    const inboundCost = byType
      .filter((r) => r.direction === 'INBOUND')
      .reduce((sum, r) => sum + r.totalCost, 0);
    const outboundCost = byType
      .filter((r) => r.direction === 'OUTBOUND')
      .reduce((sum, r) => sum + r.totalCost, 0);

    return {
      totalMovements: totals._count._all,
      totalQuantity: Number(totals._sum.quantity ?? 0),
      totalCost: Number(totals._sum.totalCost ?? 0),
      inboundQuantity,
      outboundQuantity,
      netQuantity: inboundQuantity - outboundQuantity,
      inboundCost,
      outboundCost,
      byType,
    };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.inventoryMovement.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!record) throw new NotFoundException('Inventory movement not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId);
    return record;
  }

  async createMovement(data: {
    companyId: string;
    productId: string;
    movementType: InventoryMovementType;
    quantity: number;
    unitId: string;
    unitCost?: number;
    movementDate: Date;
    createdById: string;
    referenceType?: string;
    referenceId?: string;
    batchNumber?: string;
    expiryDate?: Date;
    notes?: string;
    divisionId?: string;
    branchId?: string;
    /**
     * Escape hatch for COMPENSATING outbound movements only (e.g. a credit-note
     * void unwinding a restock after interim sales already consumed the stock).
     * When true, the outbound movement may drive quantityOnHand below zero —
     * the physically correct state, since the inbound being compensated never
     * really happened. Defaults to false; every ordinary caller keeps the
     * negative-stock guard.
     */
    allowNegativeOnHand?: boolean;
    tx?: Prisma.TransactionClient;
  }): Promise<InventoryMovement> {
    this.validateMovementDirection(data.movementType);
    if (data.quantity <= 0) {
      throw new BadRequestException('Inventory movement quantity must be greater than zero');
    }

    // Movement creation and balance update MUST be atomic. If no transaction
    // was passed in, open one here so a failure in either side rolls back both.
    const run = async (db: Prisma.TransactionClient) => {
      const scope = await this.resolveMovementScope(data, db);
      await this.validateMovementReferences({ ...data, ...scope }, db);
      await this.profit.assertInventoryMovementHasCost(data, db);

      const movementNumber = await this.codes.next({
        entityType: 'InventoryMovement',
        companyId: data.companyId,
        tx: db,
      });
      const movement = await db.inventoryMovement.create({
        data: {
          movementNumber,
          companyId: data.companyId,
          productId: data.productId,
          movementType: data.movementType,
          quantity: data.quantity,
          unitId: data.unitId,
          unitCost: data.unitCost,
          totalCost: data.unitCost != null ? data.quantity * data.unitCost : undefined,
          movementDate: data.movementDate,
          createdById: data.createdById,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          batchNumber: data.batchNumber,
          expiryDate: data.expiryDate,
          notes: data.notes,
          divisionId: data.divisionId ?? scope.divisionId,
          branchId: scope.branchId,
        },
      });

      await this.applyMovementToBalance(movement, db, {
        allowNegativeOnHand: data.allowNegativeOnHand,
      });
      return movement;
    };

    const movement = data.tx ? await run(data.tx) : await this.prisma.$transaction((tx) => run(tx));

    // Audit logs are written outside the transaction; failures must not block the movement.
    await this.auditLogs.log({
      action: 'INVENTORY_MOVEMENT_CREATE',
      entityType: 'InventoryMovement',
      entityId: movement.id,
      userId: data.createdById,
      companyId: data.companyId,
      newValue: {
        movementNumber: movement.movementNumber,
        movementType: movement.movementType,
        quantity: data.quantity,
        productId: data.productId,
        branchId: movement.branchId,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
      } as any,
    });

    return movement;
  }

  private async applyMovementToBalance(
    movement: InventoryMovement,
    db: Prisma.TransactionClient,
    opts?: { allowNegativeOnHand?: boolean },
  ) {
    const isInbound = INBOUND_TYPES.includes(movement.movementType);
    const isOutbound = OUTBOUND_TYPES.includes(movement.movementType);
    if (!isInbound && !isOutbound) {
      throw new BadRequestException(
        `Unsupported inventory movement type: ${movement.movementType}`,
      );
    }

    const quantity = Number(movement.quantity);
    if (!movement.branchId) {
      throw new BadRequestException('Branch/location is required for inventory movement');
    }

    await db.inventoryBalance.upsert({
      where: {
        companyId_productId_branchId: {
          companyId: movement.companyId,
          productId: movement.productId,
          branchId: movement.branchId,
        },
      },
      create: {
        companyId: movement.companyId,
        divisionId: movement.divisionId,
        productId: movement.productId,
        branchId: movement.branchId,
        quantityOnHand: 0,
        quantityReserved: 0,
        averageCost: 0,
        totalValue: 0,
        lastMovementAt: null,
      },
      update: { divisionId: movement.divisionId },
    });

    const rows = await db.$queryRaw<BalanceLockRow[]>(Prisma.sql`
      SELECT id, "quantityOnHand", "quantityReserved", "averageCost", "totalValue"
      FROM "inventory_balances"
      WHERE "companyId" = ${movement.companyId}
        AND "productId" = ${movement.productId}
        AND "branchId" = ${movement.branchId}
      FOR UPDATE
    `);
    const existing = rows[0];
    if (!existing) {
      throw new BadRequestException('Inventory balance row could not be locked');
    }

    const currentQty = Number(existing.quantityOnHand);
    const reservedQty = Number(existing.quantityReserved);
    const delta = isInbound ? quantity : -quantity;
    const newQty = currentQty + delta;

    // Negative-stock guard for all outbound movements. `allowNegativeOnHand`
    // bypasses it for COMPENSATING movements only: when a void unwinds a prior
    // inbound (e.g. a credit-note return restock) whose stock was since re-sold,
    // blocking the unwind would leave the reversal permanently impossible and
    // strand the GL/subledger in the un-reversed state. Driving on-hand negative
    // is then the truthful position — the compensated inbound never happened, so
    // the interim sale was over-issued.
    if (isOutbound && newQty < 0 && !opts?.allowNegativeOnHand) {
      throw new BadRequestException(
        `Insufficient stock at branch/location ${movement.branchId}: requested ${quantity}, available ${currentQty}`,
      );
    }
    // Reserved-availability guard applies ONLY to sales issues. quantityReserved
    // earmarks stock for open sales orders, so a SALE_ISSUE must not draw against
    // it. Non-sale relief movements (DAMAGE, WASTAGE, INTERNAL_USE,
    // ADJUSTMENT_OUT, TRANSFER_OUT, PRODUCTION_OUT, PURCHASE_RETURN) represent
    // real physical depletion and may draw against on-hand even when reserved —
    // they are only bounded by the negative-stock guard above.
    if (
      movement.movementType === 'SALE_ISSUE' &&
      currentQty - reservedQty < quantity
    ) {
      throw new BadRequestException(
        `Insufficient available stock at branch/location ${movement.branchId}: requested ${quantity}, available ${Math.max(0, currentQty - reservedQty)} after reservations`,
      );
    }

    // WAC valuation policy (all money math in Prisma.Decimal — never JS floats —
    // so values written into the Decimal(18,2)/(18,4) columns do not accumulate
    // IEEE-754 drift across successive movements):
    //  - Cost-bearing inbound (unitCost provided): roll the new units into the
    //    running average; totalValue grows ADDITIVELY by quantity * unitCost and
    //    averageCost is re-derived from the running total.
    //  - Cost-less inbound (unitCost == null): added units carry no cost, so the
    //    stored value of existing stock is unchanged. averageCost/totalValue held.
    //  - Outbound: relieve value ADDITIVELY at the current average
    //    (existing total - quantity * averageCost), NOT a multiplicative
    //    newQty * averageCost recompute (which can INCREASE value once the
    //    qty*avg invariant is broken by a cost-less inbound). Floor at zero, and
    //    when the line reaches zero quantity force totalValue to zero.
    const qtyDec = new Prisma.Decimal(quantity);
    const newQtyDec = new Prisma.Decimal(newQty);
    const existingTotalValue = new Prisma.Decimal(existing.totalValue);
    let newAvgCostDec = new Prisma.Decimal(existing.averageCost);
    let newTotalValueDec: Prisma.Decimal;
    if (isInbound && movement.unitCost != null) {
      const totalCost = existingTotalValue.plus(qtyDec.times(movement.unitCost));
      newAvgCostDec = newQtyDec.gt(0) ? totalCost.dividedBy(newQtyDec) : new Prisma.Decimal(0);
      newTotalValueDec = totalCost;
    } else if (isInbound) {
      // Cost-less inbound: averageCost stays as-is; totalValue is held.
      newTotalValueDec = existingTotalValue;
    } else {
      // Outbound: relieve at the current average, additively.
      if (newQtyDec.gt(0)) {
        const relieved = existingTotalValue.minus(qtyDec.times(newAvgCostDec));
        newTotalValueDec = relieved.gt(0) ? relieved : new Prisma.Decimal(0);
      } else {
        newTotalValueDec = new Prisma.Decimal(0);
      }
    }

    await db.inventoryBalance.update({
      where: { id: existing.id },
      data: {
        divisionId: movement.divisionId,
        quantityOnHand: newQty,
        averageCost: newAvgCostDec,
        totalValue: newTotalValueDec,
        lastMovementAt: movement.movementDate,
      },
    });
  }

  private validateMovementDirection(movementType: InventoryMovementType) {
    if (!INBOUND_TYPES.includes(movementType) && !OUTBOUND_TYPES.includes(movementType)) {
      throw new BadRequestException(`Unsupported inventory movement type: ${movementType}`);
    }
  }

  private async validateMovementReferences(
    data: {
      companyId: string;
      productId: string;
      branchId: string;
      unitId: string;
    },
    db: Prisma.TransactionClient,
  ) {
    const [product, branch, unit] = await Promise.all([
      db.product.findFirst({
        where: { id: data.productId, deletedAt: null },
        select: { id: true, companyId: true, name: true },
      }),
      db.branch.findFirst({
        where: { id: data.branchId, deletedAt: null },
        select: {
          id: true,
          name: true,
          isActive: true,
          division: { select: { companyId: true } },
        },
      }),
      db.unitOfMeasure.findFirst({
        where: { id: data.unitId, deletedAt: null },
        select: { id: true, companyId: true, name: true, status: true },
      }),
    ]);

    if (!product) throw new NotFoundException(`Product ${data.productId} not found`);
    if (product.companyId !== data.companyId) {
      throw new BadRequestException(
        `Product "${product.name}" does not belong to the movement company`,
      );
    }

    if (!branch) throw new NotFoundException(`Branch ${data.branchId} not found`);
    if (branch.division.companyId !== data.companyId) {
      throw new BadRequestException(
        `Branch/location "${branch.name}" does not belong to the movement company`,
      );
    }
    if (!branch.isActive) {
      throw new BadRequestException(`Branch/location "${branch.name}" is not active`);
    }

    if (!unit) throw new NotFoundException(`Unit ${data.unitId} not found`);
    if (unit.companyId && unit.companyId !== data.companyId) {
      throw new BadRequestException(`Unit "${unit.name}" does not belong to the movement company`);
    }
    if (unit.status !== 'ACTIVE') {
      throw new BadRequestException(`Unit "${unit.name}" is not active`);
    }
  }

  private async resolveMovementScope(
    data: {
      companyId: string;
      divisionId?: string;
      branchId?: string;
    },
    db: Prisma.TransactionClient,
  ): Promise<MovementScope> {
    if (!data.branchId) {
      throw new BadRequestException('Branch/location is required for inventory movement');
    }

    const branch = await db.branch.findFirst({
      where: { id: data.branchId, deletedAt: null, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        divisionId: true,
        division: { select: { companyId: true } },
      },
    });
    if (!branch) {
      throw new NotFoundException(`Branch ${data.branchId} not found`);
    }
    if (branch.division.companyId !== data.companyId) {
      throw new BadRequestException('Branch does not belong to the movement company');
    }

    return {
      divisionId: branch.divisionId,
      branchId: branch.id,
    };
  }
}
