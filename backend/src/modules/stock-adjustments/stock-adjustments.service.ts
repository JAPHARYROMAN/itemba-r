import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import {
  CreateStockAdjustmentDto,
  StockAdjustmentLineDto,
} from './dto/create-stock-adjustment.dto';
import { QueryStockAdjustmentDto } from './dto/query-stock-adjustment.dto';
import { UpdateStockAdjustmentDto } from './dto/update-stock-adjustment.dto';

type StockAdjustmentReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  inventoryLocationId?: string | null;
  lines?: StockAdjustmentLineDto[];
};

function generateAdjustmentNumber(): string {
  return `SA-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class StockAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryStockAdjustmentDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      status,
      locationId,
      dateFrom,
      dateTo,
    } = query;
    const skip = (page - 1) * limit;

    const companyWhere = (await this.companyScope.companyWhereFor(
      user,
      companyId,
    )) as Prisma.StockAdjustmentWhereInput;
    const where: Prisma.StockAdjustmentWhereInput = {
      deletedAt: null,
      ...companyWhere,
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (locationId) where.inventoryLocationId = locationId;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          inventoryLocation: { select: { id: true, name: true, locationCode: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.stockAdjustment.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        inventoryLocation: { select: { id: true, name: true, locationCode: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        postedBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Stock adjustment not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }
    return record;
  }

  async create(dto: CreateStockAdjustmentDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId, dto);
    const userId = user.id;

    const record = await this.prisma.stockAdjustment.create({
      data: {
        adjustmentNumber: generateAdjustmentNumber(),
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        inventoryLocationId: dto.inventoryLocationId,
        reason: dto.reason,
        notes: dto.notes,
        status: 'DRAFT',
        createdById: userId,
        lines: {
          create: dto.lines.map((line) => ({
            productId: line.productId,
            systemQuantity: line.systemQuantity,
            countedQuantity: line.countedQuantity,
            varianceQuantity: line.countedQuantity - line.systemQuantity,
            unitId: line.unitId,
            reason: line.reason,
          })),
        },
      },
      include: { lines: true },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_CREATE',
      entityType: 'StockAdjustment',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateStockAdjustmentDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Stock adjustment can only be edited in DRAFT status');
    }
    await this.assertReferencesBelongToCompany(existing.companyId, {
      divisionId: existing.divisionId,
      branchId: existing.branchId,
      inventoryLocationId: dto.inventoryLocationId ?? existing.inventoryLocationId,
      lines: dto.lines,
    });

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: {
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.inventoryLocationId !== undefined && {
          inventoryLocationId: dto.inventoryLocationId,
        }),
        ...(dto.lines && {
          lines: {
            deleteMany: {},
            create: dto.lines.map((line) => ({
              productId: line.productId,
              systemQuantity: line.systemQuantity,
              countedQuantity: line.countedQuantity,
              varianceQuantity: line.countedQuantity - line.systemQuantity,
              unitId: line.unitId,
              reason: line.reason,
            })),
          },
        }),
      },
      include: { lines: true },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_UPDATE',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async submit(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT adjustments can be submitted');
    }

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_SUBMIT',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'PENDING_APPROVAL' } as any,
    });

    return record;
  }

  async approve(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL adjustments can be approved');
    }

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_APPROVE',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'APPROVED' } as any,
    });

    return record;
  }

  async reject(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL adjustments can be rejected');
    }

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_REJECT',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'REJECTED' } as any,
    });

    return record;
  }

  async post(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED adjustments can be posted');
    }

    for (const line of existing.lines) {
      const variance = Number(line.varianceQuantity);
      if (variance === 0) continue;

      const movementType = variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      await this.inventoryMovements.createMovement({
        companyId: existing.companyId,
        productId: line.productId,
        inventoryLocationId: existing.inventoryLocationId,
        movementType: movementType as any,
        quantity: Math.abs(variance),
        unitId: line.unitId,
        movementDate: new Date(),
        createdById: userId,
        referenceType: 'StockAdjustment',
        referenceId: existing.id,
        divisionId: existing.divisionId ?? undefined,
        branchId: existing.branchId ?? undefined,
      });
    }

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_POST',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'APPROVED' } as any,
      newValue: { status: 'POSTED' } as any,
      severity: AuditSeverity.HIGH,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      throw new BadRequestException('Only DRAFT or REJECTED adjustments can be deleted');
    }

    await this.prisma.stockAdjustment.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_DELETE',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  private async assertReferencesBelongToCompany(
    companyId: string,
    refs: StockAdjustmentReferenceIds,
  ) {
    if (refs.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: refs.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    if (refs.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: refs.branchId, deletedAt: null },
        select: { division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
    }

    if (refs.inventoryLocationId) {
      const location = await this.prisma.inventoryLocation.findFirst({
        where: { id: refs.inventoryLocationId, deletedAt: null, isActive: true },
        select: { companyId: true },
      });
      if (!location || location.companyId !== companyId) {
        throw new BadRequestException('Inventory location does not belong to this company');
      }
    }

    await this.assertLineReferencesBelongToCompany(companyId, refs.lines);
  }

  private async assertLineReferencesBelongToCompany(
    companyId: string,
    lines: StockAdjustmentLineDto[] | undefined,
  ) {
    if (!lines?.length) return;

    const unique = (ids: string[]) => Array.from(new Set(ids));
    const productIds = unique(lines.map((line) => line.productId));
    const unitIds = unique(lines.map((line) => line.unitId));

    const [products, units] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, companyId: true },
      }),
      this.prisma.unitOfMeasure.findMany({
        where: { id: { in: unitIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      }),
    ]);

    const validProductIds = new Set(
      products.filter((product) => product.companyId === companyId).map((product) => product.id),
    );
    if (validProductIds.size !== productIds.length) {
      throw new BadRequestException('Stock adjustment product does not belong to this company');
    }

    const validUnitIds = new Set(
      units
        .filter((unit) => unit.companyId === null || unit.companyId === companyId)
        .map((unit) => unit.id),
    );
    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Stock adjustment unit does not belong to this company');
    }
  }
}
