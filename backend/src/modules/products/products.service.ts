import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { AccessLevel, AuditSeverity } from '@prisma/client';

type ProductReferenceIds = {
  categoryId?: string | null;
  divisionId?: string | null;
  baseUnitId?: string | null;
  purchaseUnitId?: string | null;
  salesUnitId?: string | null;
};

function generateProductCode(): string {
  return `PRD-${Date.now().toString(36).toUpperCase()}`;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryProductDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      categoryId,
      productType,
      status,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    // Division filter: when set, return products explicitly tagged to this
    // division PLUS company-wide (divisionId=null) products. Operators
    // working in a division should still be able to sell company-wide SKUs.
    if (divisionId) where.OR = [{ divisionId }, { divisionId: null }];
    if (categoryId) where.categoryId = categoryId;
    if (productType) where.productType = productType;
    if (status) where.status = status;
    if (search) {
      const searchTerms = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { productCode: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search, mode: 'insensitive' as const } },
      ];
      // If divisionId already populated `where.OR`, AND it together with the
      // search OR using nested `AND`. Otherwise the search wins as the OR.
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchTerms }];
        delete where.OR;
      } else {
        where.OR = searchTerms;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
          company: { select: { id: true, name: true, code: true } },
          baseUnit: { select: { id: true, name: true, symbol: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        company: { select: { id: true, name: true, code: true } },
        baseUnit: { select: { id: true, name: true, symbol: true } },
        purchaseUnit: { select: { id: true, name: true, symbol: true } },
        salesUnit: { select: { id: true, name: true, symbol: true } },
      },
    });
    if (!record) throw new NotFoundException('Product not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreateProductDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId, dto);
    const userId = user.id;
    const productCode = generateProductCode();

    const existing = await this.prisma.product.findFirst({
      where: { productCode, companyId: dto.companyId, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException('A product with this code already exists in the company');
    }

    const record = await this.prisma.product.create({
      data: {
        productCode,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        productType: dto.productType,
        baseUnitId: dto.baseUnitId,
        purchaseUnitId: dto.purchaseUnitId,
        salesUnitId: dto.salesUnitId,
        barcode: dto.barcode,
        sku: dto.sku,
        defaultPurchasePrice: dto.defaultPurchasePrice,
        defaultSellingPrice: dto.defaultSellingPrice,
        wholesalePrice: dto.wholesalePrice,
        retailPrice: dto.retailPrice,
        minimumStockLevel: dto.minimumStockLevel,
        maximumStockLevel: dto.maximumStockLevel,
        reorderLevel: dto.reorderLevel,
        trackInventory: dto.trackInventory ?? true,
        trackBatch: dto.trackBatch ?? false,
        trackExpiry: dto.trackExpiry ?? false,
        isTaxable: dto.isTaxable ?? false,
        taxRate: dto.taxRate,
        status: dto.status ?? 'ACTIVE',
      },
    });

    {
      const meta = auditFor('Product', 'CREATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Product',
        entityId: record.id,
        userId,
        companyId: record.companyId,
        newValue: record as any,
        severity: meta.severity,
      });
    }

    return record;
  }

  async update(id: string, dto: UpdateProductDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(existing.companyId, dto);

    const record = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId || null }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.productType !== undefined && { productType: dto.productType }),
        ...(dto.baseUnitId !== undefined && { baseUnitId: dto.baseUnitId }),
        ...(dto.purchaseUnitId !== undefined && { purchaseUnitId: dto.purchaseUnitId }),
        ...(dto.salesUnitId !== undefined && { salesUnitId: dto.salesUnitId }),
        ...(dto.barcode !== undefined && { barcode: dto.barcode }),
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.defaultPurchasePrice !== undefined && {
          defaultPurchasePrice: dto.defaultPurchasePrice,
        }),
        ...(dto.defaultSellingPrice !== undefined && {
          defaultSellingPrice: dto.defaultSellingPrice,
        }),
        ...(dto.wholesalePrice !== undefined && { wholesalePrice: dto.wholesalePrice }),
        ...(dto.retailPrice !== undefined && { retailPrice: dto.retailPrice }),
        ...(dto.minimumStockLevel !== undefined && {
          minimumStockLevel: dto.minimumStockLevel,
        }),
        ...(dto.maximumStockLevel !== undefined && {
          maximumStockLevel: dto.maximumStockLevel,
        }),
        ...(dto.reorderLevel !== undefined && { reorderLevel: dto.reorderLevel }),
        ...(dto.trackInventory !== undefined && { trackInventory: dto.trackInventory }),
        ...(dto.trackBatch !== undefined && { trackBatch: dto.trackBatch }),
        ...(dto.trackExpiry !== undefined && { trackExpiry: dto.trackExpiry }),
        ...(dto.isTaxable !== undefined && { isTaxable: dto.isTaxable }),
        ...(dto.taxRate !== undefined && { taxRate: dto.taxRate }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    {
      const meta = auditFor('Product', 'UPDATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Product',
        entityId: id,
        userId,
        companyId: record.companyId,
        oldValue: existing as any,
        newValue: record as any,
        severity: meta.severity,
      });
    }

    return record;
  }

  private async assertReferencesBelongToCompany(companyId: string, refs: ProductReferenceIds) {
    if (refs.categoryId) {
      const category = await this.prisma.productCategory.findFirst({
        where: { id: refs.categoryId, deletedAt: null },
        select: { companyId: true },
      });
      if (!category || category.companyId !== companyId) {
        throw new BadRequestException('Product category does not belong to this company');
      }
    }

    if (refs.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: refs.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    const unitIds = Array.from(
      new Set(
        [refs.baseUnitId, refs.purchaseUnitId, refs.salesUnitId].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    );
    if (unitIds.length === 0) return;

    const units = await this.prisma.unitOfMeasure.findMany({
      where: { id: { in: unitIds }, deletedAt: null },
      select: { id: true, companyId: true, status: true },
    });
    const validUnitIds = new Set(
      units
        .filter(
          (unit) =>
            unit.status === 'ACTIVE' && (unit.companyId === null || unit.companyId === companyId),
        )
        .map((unit) => unit.id),
    );

    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Product unit does not belong to this company');
    }
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    {
      // Product DELETE: helper baseline severity is LOW for Product entity,
      // but a delete here is operationally meaningful — keep the explicit HIGH
      // floor that the legacy code carried.
      const meta = auditFor('Product', 'DELETE', { severityFloor: AuditSeverity.HIGH });
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Product',
        entityId: id,
        userId,
        companyId: existing.companyId,
        oldValue: existing as any,
        severity: meta.severity,
      });
    }

    return { success: true };
  }
}
