import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { QueryProductFamilyDto } from './dto/query-product-family.dto';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';

type ProductReferenceIds = {
  categoryId?: string | null;
  divisionId?: string | null;
  productFamilyId?: string | null;
  productFamilyName?: string | null;
  productFamilyBrand?: string | null;
  baseUnitId?: string | null;
  purchaseUnitId?: string | null;
  salesUnitId?: string | null;
};

function generateProductCode(): string {
  return `PRD-${Date.now().toString(36).toUpperCase()}`;
}

function normalizeProductCode(productCode?: string): string | undefined {
  const trimmed = productCode?.trim();
  return trimmed || undefined;
}

function optionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
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
      branchId,
      categoryId,
      productFamilyId,
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
    if (productFamilyId) where.productFamilyId = productFamilyId;
    if (productType) where.productType = productType;
    if (status) where.status = status;
    if (search) {
      const searchTerms = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { productCode: { contains: search, mode: 'insensitive' as const } },
        { sku: { contains: search, mode: 'insensitive' as const } },
        { barcode: { contains: search, mode: 'insensitive' as const } },
        { variantName: { contains: search, mode: 'insensitive' as const } },
        { variantColor: { contains: search, mode: 'insensitive' as const } },
        { variantSize: { contains: search, mode: 'insensitive' as const } },
        { productFamily: { name: { contains: search, mode: 'insensitive' as const } } },
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
          productFamily: { select: { id: true, name: true, brand: true } },
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

    const enrichedData = await this.withProductListAliasesAndAvailability(data, branchId);

    return { data: enrichedData, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async withProductListAliasesAndAvailability<
    TProduct extends {
      id: string;
      companyId: string;
      baseUnitId: string;
      defaultSellingPrice?: unknown;
      retailPrice?: unknown;
      wholesalePrice?: unknown;
      baseUnit?: { name?: string | null; symbol?: string | null } | null;
    },
  >(products: TProduct[], branchId?: string | null) {
    const balanceByProductId = new Map<
      string,
      {
        quantityOnHand: number;
        quantityReserved: number;
        availableQuantity: number;
      }
    >();

    if (branchId && products.length) {
      const balances = await this.prisma.inventoryBalance.findMany({
        where: {
          branchId,
          productId: { in: products.map((product) => product.id) },
          companyId: { in: Array.from(new Set(products.map((product) => product.companyId))) },
        },
        select: {
          productId: true,
          quantityOnHand: true,
          quantityReserved: true,
        },
      });

      for (const balance of balances) {
        const quantityOnHand = Number(balance.quantityOnHand);
        const quantityReserved = Number(balance.quantityReserved);
        balanceByProductId.set(balance.productId, {
          quantityOnHand,
          quantityReserved,
          availableQuantity: Math.max(0, quantityOnHand - quantityReserved),
        });
      }
    }

    return products.map((product) => {
      const balance = branchId
        ? (balanceByProductId.get(product.id) ?? {
            quantityOnHand: 0,
            quantityReserved: 0,
            availableQuantity: 0,
          })
        : null;
      const sellingPrice =
        product.defaultSellingPrice ?? product.retailPrice ?? product.wholesalePrice ?? null;

      return {
        ...product,
        defaultUnitId: product.baseUnitId,
        sellingPrice,
        unitName: product.baseUnit?.name ?? null,
        unitSymbol: product.baseUnit?.symbol ?? null,
        ...(balance
          ? {
              inventoryBalance: {
                branchId,
                quantityOnHand: balance.quantityOnHand,
                quantityReserved: balance.quantityReserved,
                availableQuantity: balance.availableQuantity,
                quantityAvailable: balance.availableQuantity,
              },
              availableQuantity: balance.availableQuantity,
              quantityAvailable: balance.availableQuantity,
              availableStock: balance.availableQuantity,
            }
          : {}),
      };
    });
  }

  async findFamilies(query: QueryProductFamilyDto, user: AuthUser) {
    const { page = 1, limit = 50, companyId, divisionId, categoryId, isActive, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductFamilyWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.OR = [{ divisionId }, { divisionId: null }];
    if (categoryId) where.categoryId = categoryId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      const searchTerms: Prisma.ProductFamilyWhereInput[] = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR as Prisma.ProductFamilyWhereInput[] }, { OR: searchTerms }];
        delete where.OR;
      } else {
        where.OR = searchTerms;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.productFamily.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ brand: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.productFamily.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        productFamily: true,
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
    const productFamilyId = await this.resolveProductFamilyId(dto.companyId, {
      categoryId: dto.categoryId,
      divisionId: dto.divisionId ?? null,
      productFamilyId: dto.productFamilyId,
      productFamilyName: dto.productFamilyName,
      productFamilyBrand: dto.productFamilyBrand,
    });
    const userId = user.id;
    const productCode = normalizeProductCode(dto.productCode) ?? generateProductCode();

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
        productFamilyId,
        name: dto.name,
        variantName: optionalText(dto.variantName),
        variantColor: optionalText(dto.variantColor),
        variantSize: optionalText(dto.variantSize),
        variantFinish: optionalText(dto.variantFinish),
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
    const productCode = normalizeProductCode(dto.productCode);
    const targetCategoryId = dto.categoryId ?? existing.categoryId;
    const targetDivisionId =
      dto.divisionId !== undefined ? (optionalText(dto.divisionId) ?? null) : existing.divisionId;
    const productFamilyId = await this.resolveProductFamilyId(
      existing.companyId,
      {
        categoryId: targetCategoryId,
        divisionId: targetDivisionId,
        productFamilyId: dto.productFamilyId,
        productFamilyName: dto.productFamilyName,
        productFamilyBrand: dto.productFamilyBrand,
      },
      existing.productFamilyId,
      dto.categoryId !== undefined || dto.divisionId !== undefined,
    );

    if (productCode && productCode !== existing.productCode) {
      const duplicate = await this.prisma.product.findFirst({
        where: {
          productCode,
          companyId: existing.companyId,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new BadRequestException('A product with this code already exists in the company');
      }
    }

    const record = await this.prisma.product.update({
      where: { id },
      data: {
        ...(productCode !== undefined && { productCode }),
        ...(dto.divisionId !== undefined && { divisionId: dto.divisionId || null }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(productFamilyId !== undefined && { productFamilyId }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.variantName !== undefined && {
          variantName: optionalText(dto.variantName) ?? null,
        }),
        ...(dto.variantColor !== undefined && {
          variantColor: optionalText(dto.variantColor) ?? null,
        }),
        ...(dto.variantSize !== undefined && {
          variantSize: optionalText(dto.variantSize) ?? null,
        }),
        ...(dto.variantFinish !== undefined && {
          variantFinish: optionalText(dto.variantFinish) ?? null,
        }),
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

  private async resolveProductFamilyId(
    companyId: string,
    refs: ProductReferenceIds,
    currentProductFamilyId?: string | null,
    validateCurrent = false,
  ): Promise<string | null | undefined> {
    const categoryId = refs.categoryId;
    if (!categoryId) {
      if (refs.productFamilyId || refs.productFamilyName) {
        throw new BadRequestException('Product category is required before assigning a family');
      }
      return undefined;
    }

    const familyName = optionalText(refs.productFamilyName);
    if (familyName) {
      const divisionId = optionalText(refs.divisionId) ?? null;
      const existing = await this.prisma.productFamily.findFirst({
        where: {
          companyId,
          categoryId,
          divisionId,
          deletedAt: null,
          name: { equals: familyName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existing) return existing.id;

      const created = await this.prisma.productFamily.create({
        data: {
          companyId,
          categoryId,
          divisionId,
          name: familyName,
          brand: optionalText(refs.productFamilyBrand),
        },
        select: { id: true },
      });
      return created.id;
    }

    if (refs.productFamilyId !== undefined) {
      const familyId = optionalText(refs.productFamilyId);
      if (!familyId) return null;
      return this.assertProductFamilyMatchesProduct(
        companyId,
        familyId,
        categoryId,
        refs.divisionId,
      );
    }

    if (validateCurrent && currentProductFamilyId) {
      return this.assertProductFamilyMatchesProduct(
        companyId,
        currentProductFamilyId,
        categoryId,
        refs.divisionId,
      );
    }

    return undefined;
  }

  private async assertProductFamilyMatchesProduct(
    companyId: string,
    productFamilyId: string,
    categoryId: string,
    divisionId?: string | null,
  ) {
    const family = await this.prisma.productFamily.findFirst({
      where: { id: productFamilyId, deletedAt: null, isActive: true },
      select: { id: true, companyId: true, categoryId: true, divisionId: true },
    });
    if (!family || family.companyId !== companyId) {
      throw new BadRequestException('Product family does not belong to this company');
    }
    if (family.categoryId !== categoryId) {
      throw new BadRequestException('Product family must belong to the selected category');
    }
    const targetDivisionId = optionalText(divisionId) ?? null;
    if (family.divisionId && family.divisionId !== targetDivisionId) {
      throw new BadRequestException('Product family must belong to the selected division');
    }
    return family.id;
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
