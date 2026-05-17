import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { CreateStockDamageDto } from './dto/create-stock-damage.dto';
import { UpdateStockDamageDto } from './dto/update-stock-damage.dto';
import { QueryStockDamageDto } from './dto/query-stock-damage.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class StockDamageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
  ) {}

  private async generateDamageNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.stockDamage.count({
      where: { companyId, damageNumber: { startsWith: `DMG-${year}` } },
    });
    return `DMG-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateStockDamageDto, userId: string) {
    const damageNumber = await this.generateDamageNumber(dto.companyId);
    const record = await this.prisma.stockDamage.create({
      data: {
        damageNumber,
        companyId: dto.companyId,
        branchId: dto.branchId,
        productId: dto.productId,
        batchId: dto.batchId,
        quantity: dto.quantity,
        unitId: dto.unitId,
        damageType: dto.damageType,
        estimatedValue: dto.estimatedValue,
        reportedById: userId,
        status: 'DRAFT',
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_CREATE',
      entityType: 'StockDamage',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async findAll(query: QueryStockDamageDto, user?: any) {
    const { page = 1, limit = 20, companyId, branchId, status, productId } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (productId) where.productId = productId;

    const [data, total] = await Promise.all([
      this.prisma.stockDamage.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockDamage.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.stockDamage.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Stock damage not found');
    return record;
  }

  async update(id: string, dto: UpdateStockDamageDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Can only update DRAFT records');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: {
        ...(dto.branchId && { branchId: dto.branchId }),
        ...(dto.productId && { productId: dto.productId }),
        ...(dto.batchId !== undefined && { batchId: dto.batchId }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.unitId && { unitId: dto.unitId }),
        ...(dto.damageType && { damageType: dto.damageType }),
        ...(dto.estimatedValue !== undefined && { estimatedValue: dto.estimatedValue }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_UPDATE',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async submit(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT records can be submitted');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_SUBMIT',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'SUBMITTED' } as any,
    });
    return record;
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'SUBMITTED')
      throw new BadRequestException('Only SUBMITTED records can be approved');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_APPROVE',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async reject(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'SUBMITTED')
      throw new BadRequestException('Only SUBMITTED records can be rejected');
    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_REJECT',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
    });
    return record;
  }

  async post(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED records can be posted');

    const { companyId, productId, branchId, unitId, quantity, batchId } = existing;
    if (!branchId) {
      throw new BadRequestException('Branch/location is required to post stock damage');
    }

    await this.inventoryMovements.createMovement({
      companyId,
      productId,
      branchId,
      movementType: 'DAMAGE',
      quantity: Number(quantity),
      unitId,
      movementDate: new Date(),
      createdById: userId,
      referenceType: 'StockDamage',
      referenceId: id,
    });

    if (batchId) {
      await this.prisma.productBatch.update({
        where: { id: batchId },
        data: { remainingQuantity: { decrement: Number(quantity) } },
      });
    }

    const record = await this.prisma.stockDamage.update({
      where: { id },
      data: { status: 'POSTED' },
    });

    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_POST',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: record.companyId,
      newValue: { status: 'POSTED' } as any,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT records can be deleted');
    await this.prisma.stockDamage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'STOCK_DAMAGE_DELETE',
      entityType: 'StockDamage',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
