import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProductBatchDto } from './dto/create-product-batch.dto';
import { UpdateProductBatchDto } from './dto/update-product-batch.dto';
import { QueryProductBatchDto } from './dto/query-product-batch.dto';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ProductBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async generateBatchNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.productBatch.count({
      where: { companyId, batchNumber: { startsWith: `BATCH-${year}` } },
    });
    return `BATCH-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateProductBatchDto, userId: string) {
    const batchNumber = await this.generateBatchNumber(dto.companyId);
    const record = await this.prisma.productBatch.create({
      data: {
        batchNumber,
        companyId: dto.companyId,
        productId: dto.productId,
        branchId: dto.branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId,
        manufactureDate: dto.manufactureDate ? new Date(dto.manufactureDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : undefined,
        initialQuantity: dto.initialQuantity,
        remainingQuantity: dto.initialQuantity,
        unitId: dto.unitId,
        unitCost: dto.unitCost,
        status: 'ACTIVE',
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'PRODUCT_BATCH_CREATE',
      entityType: 'ProductBatch',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });
    return record;
  }

  async findAll(query: QueryProductBatchDto, user?: any) {
    const { page = 1, limit = 20, companyId, productId, status, branchId } = query;
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (productId) where.productId = productId;
    if (status) where.status = status;
    if (branchId) where.branchId = branchId;

    const [data, total] = await Promise.all([
      this.prisma.productBatch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.productBatch.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findExpiring(companyId?: string, user?: any) {
    const cutoff = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const where: any = {
      status: 'ACTIVE',
      expiryDate: { lte: cutoff, not: null },
      deletedAt: null,
    };
    applyCompanyScopeWhere(where, user, companyId);
    return this.prisma.productBatch.findMany({ where, orderBy: { expiryDate: 'asc' } });
  }

  async findExpired(companyId?: string, user?: any) {
    const now = new Date();
    const where: any = {
      expiryDate: { lt: now },
      status: { in: ['ACTIVE', 'EXPIRED'] },
      deletedAt: null,
    };
    applyCompanyScopeWhere(where, user, companyId);
    return this.prisma.productBatch.findMany({ where, orderBy: { expiryDate: 'asc' } });
  }

  async findByProduct(productId: string) {
    return this.prisma.productBatch.findMany({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const record = await this.prisma.productBatch.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Product batch not found');
    return record;
  }

  async update(id: string, dto: UpdateProductBatchDto, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.productBatch.update({
      where: { id },
      data: {
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.expiryDate !== undefined && {
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        }),
        ...(dto.manufactureDate !== undefined && {
          manufactureDate: dto.manufactureDate ? new Date(dto.manufactureDate) : null,
        }),
        ...(dto.receivedDate !== undefined && {
          receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : null,
        }),
        ...(dto.unitCost !== undefined && { unitCost: dto.unitCost }),
        ...(dto.status && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    await this.auditLogs.log({
      action: 'PRODUCT_BATCH_UPDATE',
      entityType: 'ProductBatch',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.productBatch.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({
      action: 'PRODUCT_BATCH_DELETE',
      entityType: 'ProductBatch',
      entityId: id,
      userId,
      companyId: existing.companyId,
    });
    return { success: true };
  }
}
