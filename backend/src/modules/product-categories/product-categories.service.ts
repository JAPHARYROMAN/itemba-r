import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { QueryProductCategoryDto } from './dto/query-product-category.dto';

@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryProductCategoryDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      categoryType,
      parentCategoryId,
      isActive,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductCategoryWhereInput = { deletedAt: null };
    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
      where.companyId = companyId;
    } else {
      const accessibleCompanyIds = await this.companyScope.accessibleCompanyIds(user);
      if (accessibleCompanyIds !== null) {
        where.companyId = { in: accessibleCompanyIds };
      }
    }
    if (categoryType) where.categoryType = categoryType;
    if (parentCategoryId) where.parentCategoryId = parentCategoryId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.productCategory.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          parentCategory: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.productCategory.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimumAccess: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.productCategory.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        parentCategory: { select: { id: true, name: true } },
      },
    });
    if (!record) throw new NotFoundException('Product category not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimumAccess);
    return record;
  }

  async create(dto: CreateProductCategoryDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertParentCategoryBelongsToCompany(dto.parentCategoryId, dto.companyId);

    const record = await this.prisma.productCategory.create({
      data: {
        companyId: dto.companyId,
        parentCategoryId: dto.parentCategoryId,
        name: dto.name,
        categoryType: dto.categoryType,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogs.log({
      action: 'PRODUCT_CATEGORY_CREATE',
      entityType: 'ProductCategory',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateProductCategoryDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.assertParentCategoryBelongsToCompany(dto.parentCategoryId, existing.companyId);

    const record = await this.prisma.productCategory.update({
      where: { id },
      data: {
        ...(dto.parentCategoryId !== undefined && {
          parentCategoryId: dto.parentCategoryId,
        }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.categoryType !== undefined && { categoryType: dto.categoryType }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogs.log({
      action: 'PRODUCT_CATEGORY_UPDATE',
      entityType: 'ProductCategory',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);

    await this.prisma.productCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'PRODUCT_CATEGORY_DELETE',
      entityType: 'ProductCategory',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      severity: AuditSeverity.HIGH,
    });

    return { success: true };
  }

  private async assertParentCategoryBelongsToCompany(
    parentCategoryId: string | undefined,
    companyId: string,
  ) {
    if (!parentCategoryId) return;

    const parent = await this.prisma.productCategory.findFirst({
      where: { id: parentCategoryId, deletedAt: null },
      select: { companyId: true },
    });
    if (!parent || parent.companyId !== companyId) {
      throw new BadRequestException('Parent category must belong to the same company');
    }
  }
}
