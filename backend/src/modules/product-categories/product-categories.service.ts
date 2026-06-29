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
      limit: requestedLimit = 1000,
      companyId,
      categoryType,
      parentCategoryId,
      isActive,
      search,
    } = query;
    const limit = Math.min(Math.max(requestedLimit, 1), 5000);
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
    if (dto.parentCategoryId) {
      await this.assertNoParentCycle(id, dto.parentCategoryId);
    }

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

  /**
   * Reject a parent assignment that would create a cycle in the category tree
   * (self-parenting, or pointing at one of the category's own descendants) —
   * which would otherwise break tree rendering and recursive walks.
   */
  private async assertNoParentCycle(categoryId: string, parentCategoryId: string) {
    if (parentCategoryId === categoryId) {
      throw new BadRequestException('A category cannot be its own parent');
    }
    const visited = new Set<string>();
    let cursor: string | null = parentCategoryId;
    while (cursor) {
      if (cursor === categoryId) {
        throw new BadRequestException(
          'That parent category is a descendant of this category, which would create a cycle',
        );
      }
      if (visited.has(cursor)) break; // pre-existing cycle upstream; stop walking
      visited.add(cursor);
      const parent: { parentCategoryId: string | null } | null =
        await this.prisma.productCategory.findFirst({
          where: { id: cursor, deletedAt: null },
          select: { parentCategoryId: true },
        });
      cursor = parent?.parentCategoryId ?? null;
    }
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const [childCategories, productFamilies, products, supplierLinks] = await Promise.all([
      this.prisma.productCategory.count({
        where: { parentCategoryId: id, deletedAt: null },
      }),
      this.prisma.productFamily.count({
        where: { categoryId: id, deletedAt: null },
      }),
      this.prisma.product.count({
        where: { categoryId: id, deletedAt: null },
      }),
      this.prisma.supplierProductCategory.count({
        where: { productCategoryId: id, supplier: { deletedAt: null } },
      }),
    ]);

    if (childCategories || productFamilies || products || supplierLinks) {
      throw new BadRequestException(
        'Product category is in use. Remove child categories, product families, products, and supplier mappings before deleting it.',
      );
    }

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
