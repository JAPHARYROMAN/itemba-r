import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProductBatchDto } from './dto/create-product-batch.dto';
import { UpdateProductBatchDto } from './dto/update-product-batch.dto';
import { QueryProductBatchDto } from './dto/query-product-batch.dto';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class ProductBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  private async generateBatchNumber(
    companyId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const count = await client.productBatch.count({
      where: { companyId, batchNumber: { startsWith: `BATCH-${year}` } },
    });
    return `BATCH-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  /**
   * Ensure every company-scoped foreign key on the DTO points at a live row that
   * belongs to dto.companyId. Prevents attaching a batch to another company's
   * product / branch / supplier / purchase order (cross-tenant reference).
   */
  private async assertReferencesBelongToCompany(dto: CreateProductBatchDto) {
    const { companyId } = dto;

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new BadRequestException('Product not found for this company');
    }

    if (dto.branchId) {
      // Branch has no companyId column; it is scoped to a company via its division.
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null, division: { companyId } },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException('Branch not found for this company');
      }
    }

    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier not found for this company');
      }
    }

    if (dto.purchaseOrderId) {
      const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
        where: { id: dto.purchaseOrderId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!purchaseOrder) {
        throw new BadRequestException('Purchase order not found for this company');
      }
    }
  }

  async create(dto: CreateProductBatchDto, user: AuthUser) {
    const userId = user.id;
    // Company-scope authorization: creating a batch requires WRITE on the target
    // company. A client-supplied companyId is NOT trusted for authorization; it is
    // validated against the caller's effective access before any write.
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    // Reference validation: every referenced entity must belong to dto.companyId
    // (and not be soft-deleted) so a caller cannot attach a batch to another
    // company's product / branch / supplier / purchase order.
    await this.assertReferencesBelongToCompany(dto);

    // ITMB-029: generate the company-scoped batch number and create the row in a
    // single transaction with a single P2002 retry, so concurrent creates for the
    // same company cannot compute the same BATCH-YYYY-NNNNN and 500 on the loser.
    const buildData = (batchNumber: string) => ({
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
      status: 'ACTIVE' as const,
      notes: dto.notes,
    });

    const createBatch = () =>
      this.prisma.$transaction(async (tx) => {
        const batchNumber = await this.generateBatchNumber(dto.companyId, tx);
        return tx.productBatch.create({ data: buildData(batchNumber) });
      });

    let record;
    try {
      record = await createBatch();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        record = await createBatch();
      } else {
        throw error;
      }
    }
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

  async findByProduct(productId: string, user: AuthUser) {
    // Company scope: only return batches for companies the caller can read.
    // Without this filter a Company A user could list Company B's batches by
    // passing Company B's productId.
    const where: any = { productId, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    return this.prisma.productBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user?: AuthUser) {
    const record = await this.prisma.productBatch.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Product batch not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.READ);
    }
    return record;
  }

  async update(id: string, dto: UpdateProductBatchDto, user: AuthUser) {
    const userId = user.id;
    // Company scope: mutating a batch requires WRITE on its owning company.
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
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

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    // Company scope: soft-deleting a batch requires WRITE on its owning company.
    const existing = await this.findOne(id);
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);
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
