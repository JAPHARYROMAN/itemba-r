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
import { RejectStockAdjustmentDto } from './dto/reject-stock-adjustment.dto';
import { UpdateStockAdjustmentDto } from './dto/update-stock-adjustment.dto';

type StockAdjustmentReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  lines?: StockAdjustmentLineDto[];
};

function generateAdjustmentNumber(): string {
  return `SA-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
}

function normalizeAdjustmentLine(line: StockAdjustmentLineDto) {
  const systemQuantity = Number(line.systemQuantity ?? line.systemQty);
  const countedQuantity = Number(line.countedQuantity ?? line.countedQty);
  if (!Number.isFinite(systemQuantity) || !Number.isFinite(countedQuantity)) {
    throw new BadRequestException('Stock adjustment quantities must be valid numbers');
  }
  return {
    ...line,
    systemQuantity,
    countedQuantity,
    varianceQuantity: countedQuantity - systemQuantity,
  };
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
    if (locationId) where.branchId = locationId;
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
          branch: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true } },
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
        branch: { select: { id: true, name: true, code: true } },
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
        reason: dto.reason,
        notes: dto.notes,
        status: 'DRAFT',
        createdById: userId,
        lines: {
          create: dto.lines.map((line) => {
            const normalized = normalizeAdjustmentLine(line);
            return {
              productId: normalized.productId,
              systemQuantity: normalized.systemQuantity,
              countedQuantity: normalized.countedQuantity,
              varianceQuantity: normalized.varianceQuantity,
              unitId: normalized.unitId,
              reason: normalized.reason,
            };
          }),
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
      branchId: dto.branchId ?? existing.branchId,
      lines: dto.lines,
    });

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: {
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.lines && {
          lines: {
            deleteMany: {},
            create: dto.lines.map((line) => {
              const normalized = normalizeAdjustmentLine(line);
              return {
                productId: normalized.productId,
                systemQuantity: normalized.systemQuantity,
                countedQuantity: normalized.countedQuantity,
                varianceQuantity: normalized.varianceQuantity,
                unitId: normalized.unitId,
                reason: normalized.reason,
              };
            }),
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

  async reject(id: string, dto: RejectStockAdjustmentDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL adjustments can be rejected');
    }

    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Rejection reason is required');
    }

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: {
        status: 'REJECTED',
        // Preserve any existing notes; surface the rejection reason on the record
        // (the schema has no dedicated rejectionReason column).
        notes: existing.notes ? `${existing.notes}\n[Rejected] ${reason}` : `[Rejected] ${reason}`,
      },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_REJECT',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'REJECTED', rejectionReason: reason } as any,
    });

    return record;
  }

  async revertApproval(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED adjustments can be reverted to draft');
    }
    if (existing.postedAt) {
      throw new BadRequestException('Posted adjustments cannot be reverted to draft');
    }

    const movementCount = await this.prisma.inventoryMovement.count({
      where: {
        referenceType: 'StockAdjustment',
        referenceId: id,
      },
    });
    if (movementCount > 0) {
      throw new BadRequestException(
        'This adjustment already has inventory movements and cannot be reverted to draft',
      );
    }

    const record = await this.prisma.stockAdjustment.update({
      where: { id },
      data: {
        status: 'DRAFT',
        approvedById: null,
        approvedAt: null,
      },
    });

    await this.auditLogs.log({
      action: 'STOCK_ADJUSTMENT_REVERT_APPROVAL',
      entityType: 'StockAdjustment',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'APPROVED', approvedById: existing.approvedById } as any,
      newValue: { status: 'DRAFT' } as any,
      severity: AuditSeverity.HIGH,
    });

    return record;
  }

  async post(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED adjustments can be posted');
    }
    if (!existing.branchId) {
      throw new BadRequestException('Branch/location is required to post stock adjustment');
    }

    // ITMB-042: Apply all inventory movements and flip the status in ONE transaction so a
    // mid-loop failure rolls back every balance change, and atomically claim the document
    // (guarded on status === APPROVED) up front so concurrent/retried posts cannot
    // double-apply the variances.
    const record = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Only APPROVED adjustments can be posted');
      }

      for (const line of existing.lines) {
        const variance = Number(line.varianceQuantity);
        if (variance === 0) continue;

        const movementType = variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
        await this.inventoryMovements.createMovement({
          companyId: existing.companyId,
          productId: line.productId,
          movementType: movementType as any,
          quantity: Math.abs(variance),
          unitId: line.unitId,
          movementDate: new Date(),
          createdById: userId,
          referenceType: 'StockAdjustment',
          referenceId: existing.id,
          divisionId: existing.divisionId ?? undefined,
          branchId: existing.branchId ?? undefined,
          tx,
        });
      }

      return tx.stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
      });
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
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
      if (refs.divisionId && branch.divisionId !== refs.divisionId) {
        throw new BadRequestException('Branch does not belong to the selected division');
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
