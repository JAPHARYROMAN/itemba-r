import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { QuerySupplierPerformanceDto } from './dto/query-supplier-performance.dto';
import { UpsertSupplierPerformanceDto } from './dto/upsert-supplier-performance.dto';

@Injectable()
export class SupplierPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QuerySupplierPerformanceDto, user: AuthUser) {
    const { companyId, supplierId, rating, page = 1, limit = 20 } = query;
    const take = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (Number(page) - 1) * take;
    const where: Prisma.SupplierPerformanceProfileWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (supplierId) where.supplierId = supplierId;
    if (rating) where.rating = rating;

    const [data, total] = await Promise.all([
      this.prisma.supplierPerformanceProfile.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          reviewedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.supplierPerformanceProfile.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: take, totalPages: Math.ceil(total / take) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierPerformanceProfile.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        reviewedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Supplier performance profile not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: UpsertSupplierPerformanceDto, user: AuthUser) {
    await this.assertSupplierBelongsToCompany(dto.companyId, dto.supplierId, user);
    const item = await this.prisma.supplierPerformanceProfile.create({
      data: {
        companyId: dto.companyId,
        supplierId: dto.supplierId,
        rating: dto.rating ?? 'UNKNOWN',
        onTimeDeliveryRate: dto.onTimeDeliveryRate,
        qualityScore: dto.qualityScore,
        priceCompetitivenessScore: dto.priceCompetitivenessScore,
        totalPurchases: dto.totalPurchases ?? 0,
        totalReturns: dto.totalReturns ?? 0,
        disputeCount: dto.disputeCount ?? 0,
        lastReviewedAt: new Date(),
        reviewedById: user.id,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'SUPPLIER_PERFORMANCE_CREATE',
      entityType: 'SupplierPerformanceProfile',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
      newValue: item as any,
    });
    return item;
  }

  async update(id: string, dto: UpsertSupplierPerformanceDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId !== existing.companyId || dto.supplierId !== existing.supplierId) {
      throw new BadRequestException('Supplier performance company and supplier cannot be changed');
    }
    await this.assertSupplierBelongsToCompany(existing.companyId, existing.supplierId, user);
    const updated = await this.prisma.supplierPerformanceProfile.update({
      where: { id },
      data: {
        rating: dto.rating ?? existing.rating,
        onTimeDeliveryRate: dto.onTimeDeliveryRate,
        qualityScore: dto.qualityScore,
        priceCompetitivenessScore: dto.priceCompetitivenessScore,
        totalPurchases: dto.totalPurchases,
        totalReturns: dto.totalReturns,
        disputeCount: dto.disputeCount,
        lastReviewedAt: new Date(),
        reviewedById: user.id,
        notes: dto.notes,
      },
    });
    await this.auditLogs.log({
      action: 'SUPPLIER_PERFORMANCE_UPDATE',
      entityType: 'SupplierPerformanceProfile',
      entityId: id,
      userId: user.id,
      companyId: updated.companyId,
      oldValue: existing as any,
      newValue: updated as any,
    });
    return updated;
  }

  private async assertSupplierBelongsToCompany(companyId: string, supplierId: string, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) {
      throw new BadRequestException('Supplier does not belong to the selected company');
    }
  }
}
