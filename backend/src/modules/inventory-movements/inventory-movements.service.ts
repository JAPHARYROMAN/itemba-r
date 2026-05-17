import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { QueryInventoryMovementDto } from './dto/query-inventory-movement.dto';
import { AccessLevel, InventoryMovement, InventoryMovementType, Prisma } from '@prisma/client';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

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
  ) {}

  async findAll(query: QueryInventoryMovementDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      productId,
      locationId,
      movementType,
      dateFrom,
      dateTo,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (productId) where.productId = productId;
    if (locationId) where.branchId = locationId;
    if (movementType) where.movementType = movementType;
    if (dateFrom || dateTo) {
      where.movementDate = {};
      if (dateFrom) where.movementDate.gte = new Date(dateFrom);
      if (dateTo) where.movementDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
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

      await this.applyMovementToBalance(movement, db);
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

  private async applyMovementToBalance(movement: InventoryMovement, db: Prisma.TransactionClient) {
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
        productId: movement.productId,
        branchId: movement.branchId,
        quantityOnHand: 0,
        quantityReserved: 0,
        averageCost: 0,
        totalValue: 0,
        lastMovementAt: null,
      },
      update: {},
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

    if (isOutbound && newQty < 0) {
      throw new BadRequestException(
        `Insufficient stock at branch/location ${movement.branchId}: requested ${quantity}, available ${currentQty}`,
      );
    }
    if (isOutbound && currentQty - reservedQty < quantity) {
      throw new BadRequestException(
        `Insufficient available stock at branch/location ${movement.branchId}: requested ${quantity}, available ${Math.max(0, currentQty - reservedQty)} after reservations`,
      );
    }

    let newAvgCost = Number(existing.averageCost);
    if (isInbound && movement.unitCost != null) {
      const totalCost = Number(existing.totalValue) + quantity * Number(movement.unitCost);
      newAvgCost = newQty > 0 ? totalCost / newQty : 0;
    }

    await db.inventoryBalance.update({
      where: { id: existing.id },
      data: {
        quantityOnHand: newQty,
        averageCost: newAvgCost,
        totalValue: newQty * newAvgCost,
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
