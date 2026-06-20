import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { auditFor, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { QueryProductFamilyDto } from './dto/query-product-family.dto';
import { CreateProductFamilyDto, UpdateProductFamilyDto } from './dto/manage-product-family.dto';
import { ProfitService } from '../profit/profit.service';
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

type FamilyVariantProductPlan = {
  family: {
    id: string;
    name: string;
    defaultPurchasePrice: Prisma.Decimal | number | string | null;
    defaultSellingPrice: Prisma.Decimal | number | string | null;
    wholesalePrice: Prisma.Decimal | number | string | null;
    retailPrice: Prisma.Decimal | number | string | null;
  };
  defaultPurchasePrice: Prisma.Decimal | number | string | null;
};

function generateProductCode(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PRD-${timestamp}${suffix}`;
}

function normalizeProductCode(productCode?: string): string | undefined {
  const trimmed = productCode?.trim();
  return trimmed || undefined;
}

function optionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function nullablePrice(value: number | string | Prisma.Decimal | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return Number(value);
}

function positivePrice(value: unknown) {
  const price = Number(value ?? 0);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function pricesAreDifferent(a: unknown, b: unknown) {
  const left = positivePrice(a);
  const right = positivePrice(b);
  if (left == null || right == null) return false;
  return Math.abs(left - right) > 0.0001;
}

function familyDefaultSellingPrice(family: {
  defaultSellingPrice?: unknown;
  retailPrice?: unknown;
  wholesalePrice?: unknown;
}) {
  return (
    positivePrice(family.defaultSellingPrice) ??
    positivePrice(family.retailPrice) ??
    positivePrice(family.wholesalePrice)
  );
}

function familyVariantLabel(familyName: string) {
  const trimmed = familyName.trim();
  const match = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(l|ltr|litre|liter|litres|liters)$/i);
  if (!match) return trimmed;
  return `${match[1].replace(',', '.')} LTR`;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly profit: ProfitService,
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
      supplierId,
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
    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: {
          id: supplierId,
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
        select: {
          companyId: true,
          productCategories: { select: { productCategoryId: true } },
        },
      });
      if (supplier) {
        await this.companyScope.assertCanAccessCompany(user, supplier.companyId);
        const supplierCategoryIds = supplier.productCategories.map((link) => link.productCategoryId);
        if (supplierCategoryIds.length > 0) {
          where.categoryId = categoryId
            ? { in: supplierCategoryIds.filter((id) => id === categoryId) }
            : { in: supplierCategoryIds };
        }
      }
    }
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
        { variantFinish: { contains: search, mode: 'insensitive' as const } },
        { category: { name: { contains: search, mode: 'insensitive' as const } } },
        { productFamily: { name: { contains: search, mode: 'insensitive' as const } } },
        { productFamily: { brand: { contains: search, mode: 'insensitive' as const } } },
        {
          category: {
            supplierLinks: {
              some: {
                supplier: {
                  deletedAt: null,
                  OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    { legalName: { contains: search, mode: 'insensitive' as const } },
                    { supplierCode: { contains: search, mode: 'insensitive' as const } },
                  ],
                },
              },
            },
          },
        },
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
          category: {
            select: {
              id: true,
              name: true,
              supplierLinks: {
                where: { supplier: { deletedAt: null } },
                select: {
                  supplier: {
                    select: {
                      id: true,
                      name: true,
                      legalName: true,
                      supplierCode: true,
                    },
                  },
                },
              },
            },
          },
          productFamily: {
            select: {
              id: true,
              name: true,
              brand: true,
              defaultPurchasePrice: true,
              defaultSellingPrice: true,
              wholesalePrice: true,
              retailPrice: true,
            },
          },
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
      defaultPurchasePrice?: unknown;
      defaultSellingPrice?: unknown;
      retailPrice?: unknown;
      wholesalePrice?: unknown;
      productFamily?: {
        defaultPurchasePrice?: unknown;
        defaultSellingPrice?: unknown;
        retailPrice?: unknown;
        wholesalePrice?: unknown;
      } | null;
      baseUnit?: { name?: string | null; symbol?: string | null } | null;
    },
  >(products: TProduct[], branchId?: string | null) {
    const balanceByProductId = new Map<
      string,
      {
        quantityOnHand: number;
        quantityReserved: number;
        availableQuantity: number;
        averageCost: number;
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
          averageCost: true,
        },
      });

      for (const balance of balances) {
        const quantityOnHand = Number(balance.quantityOnHand);
        const quantityReserved = Number(balance.quantityReserved);
        balanceByProductId.set(balance.productId, {
          quantityOnHand,
          quantityReserved,
          availableQuantity: Math.max(0, quantityOnHand - quantityReserved),
          averageCost: Number(balance.averageCost),
        });
      }
    }

    return products.map((product) => {
      const balance = branchId
        ? (balanceByProductId.get(product.id) ?? {
          quantityOnHand: 0,
          quantityReserved: 0,
          availableQuantity: 0,
          averageCost: 0,
        })
        : null;
      const productSellingPrice = positivePrice(product.defaultSellingPrice);
      const productPurchasePrice = positivePrice(product.defaultPurchasePrice);
      const productRetailPrice = positivePrice(product.retailPrice);
      const productWholesalePrice = positivePrice(product.wholesalePrice);
      const familyPurchasePrice = positivePrice(product.productFamily?.defaultPurchasePrice);
      const familySellingPrice = positivePrice(product.productFamily?.defaultSellingPrice);
      const familyRetailPrice = positivePrice(product.productFamily?.retailPrice);
      const familyWholesalePrice = positivePrice(product.productFamily?.wholesalePrice);
      const effectiveSellingPrice =
        productSellingPrice ??
        productRetailPrice ??
        productWholesalePrice ??
        familySellingPrice ??
        familyRetailPrice ??
        familyWholesalePrice;
      const effectivePurchasePrice = productPurchasePrice ?? familyPurchasePrice;
      const effectiveWholesalePrice = productWholesalePrice ?? familyWholesalePrice;
      const effectiveRetailPrice = productRetailPrice ?? familyRetailPrice;
      const priceSource =
        productSellingPrice != null || productRetailPrice != null || productWholesalePrice != null
          ? 'PRODUCT_OVERRIDE'
          : effectiveSellingPrice != null
            ? 'FAMILY_DEFAULT'
            : 'MISSING';

      return {
        ...product,
        defaultUnitId: product.baseUnitId,
        effectiveSellingPrice,
        effectivePurchasePrice,
        effectiveWholesalePrice,
        effectiveRetailPrice,
        priceSource,
        sellingPrice: effectiveSellingPrice,
        unitName: product.baseUnit?.name ?? null,
        unitSymbol: product.baseUnit?.symbol ?? null,
        ...(balance
          ? {
              inventoryBalance: {
                branchId,
                quantityOnHand: balance.quantityOnHand,
                quantityReserved: balance.quantityReserved,
                averageCost: balance.averageCost,
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

    const enrichedData = await this.withFamilyPriceCounts(data);

    return { data: enrichedData, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createFamily(dto: CreateProductFamilyDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertFamilyReferences(dto.companyId, dto.categoryId, dto.divisionId);
    this.assertFamilyPricing(dto);

    const divisionId = optionalText(dto.divisionId) ?? null;
    const duplicate = await this.prisma.productFamily.findFirst({
      where: {
        companyId: dto.companyId,
        categoryId: dto.categoryId,
        divisionId,
        deletedAt: null,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('A product family with this name already exists in this category');
    }

    const record = await this.prisma.productFamily.create({
      data: {
        companyId: dto.companyId,
        divisionId,
        categoryId: dto.categoryId,
        name: dto.name.trim(),
        brand: optionalText(dto.brand),
        description: optionalText(dto.description),
        defaultPurchasePrice: nullablePrice(dto.defaultPurchasePrice),
        defaultSellingPrice: nullablePrice(dto.defaultSellingPrice),
        wholesalePrice: nullablePrice(dto.wholesalePrice),
        retailPrice: nullablePrice(dto.retailPrice),
        isActive: dto.isActive ?? true,
      },
      include: {
        category: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
      },
    });

    await this.auditLogs.log({
      action: 'PRODUCT_FAMILY_CREATE',
      entityType: 'ProductFamily',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      newValue: record as any,
    });

    const [enriched] = await this.withFamilyPriceCounts([record]);
    return enriched;
  }

  async updateFamily(id: string, dto: UpdateProductFamilyDto, user: AuthUser) {
    const existing = await this.prisma.productFamily.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Product family not found');
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);

    const categoryId = dto.categoryId ?? existing.categoryId;
    const divisionId =
      dto.divisionId !== undefined ? (optionalText(dto.divisionId) ?? null) : existing.divisionId;
    await this.assertFamilyReferences(existing.companyId, categoryId, divisionId);
    this.assertFamilyPricing({
      defaultPurchasePrice:
        dto.defaultPurchasePrice !== undefined ? dto.defaultPurchasePrice : existing.defaultPurchasePrice,
      defaultSellingPrice:
        dto.defaultSellingPrice !== undefined ? dto.defaultSellingPrice : existing.defaultSellingPrice,
      wholesalePrice: dto.wholesalePrice !== undefined ? dto.wholesalePrice : existing.wholesalePrice,
      retailPrice: dto.retailPrice !== undefined ? dto.retailPrice : existing.retailPrice,
    });

    const nextName = optionalText(dto.name) ?? existing.name;
    if (nextName !== existing.name || categoryId !== existing.categoryId || divisionId !== existing.divisionId) {
      const duplicate = await this.prisma.productFamily.findFirst({
        where: {
          companyId: existing.companyId,
          categoryId,
          divisionId,
          deletedAt: null,
          name: { equals: nextName, mode: 'insensitive' },
          NOT: { id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException('A product family with this name already exists in this category');
      }
    }

    const record = await this.prisma.productFamily.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined && { categoryId }),
        ...(dto.divisionId !== undefined && { divisionId }),
        ...(dto.name !== undefined && { name: nextName }),
        ...(dto.brand !== undefined && { brand: optionalText(dto.brand) ?? null }),
        ...(dto.description !== undefined && { description: optionalText(dto.description) ?? null }),
        ...(dto.defaultPurchasePrice !== undefined && {
          defaultPurchasePrice: nullablePrice(dto.defaultPurchasePrice),
        }),
        ...(dto.defaultSellingPrice !== undefined && {
          defaultSellingPrice: nullablePrice(dto.defaultSellingPrice),
        }),
        ...(dto.wholesalePrice !== undefined && {
          wholesalePrice: nullablePrice(dto.wholesalePrice),
        }),
        ...(dto.retailPrice !== undefined && { retailPrice: nullablePrice(dto.retailPrice) }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        category: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
      },
    });

    await this.auditLogs.log({
      action: 'PRODUCT_FAMILY_UPDATE',
      entityType: 'ProductFamily',
      entityId: id,
      userId: user.id,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    const [enriched] = await this.withFamilyPriceCounts([record]);
    return enriched;
  }

  async removeFamily(id: string, user: AuthUser) {
    const existing = await this.prisma.productFamily.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Product family not found');
    await this.companyScope.assertCanAccessCompany(user, existing.companyId, AccessLevel.WRITE);

    const productCount = await this.prisma.product.count({
      where: { productFamilyId: id, deletedAt: null },
    });
    if (productCount > 0) {
      throw new BadRequestException('Product family is in use. Deactivate it instead of deleting it.');
    }

    await this.prisma.productFamily.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogs.log({
      action: 'PRODUCT_FAMILY_DELETE',
      entityType: 'ProductFamily',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing as any,
      severity: AuditSeverity.HIGH,
    });

    return { success: true };
  }

  private async withFamilyPriceCounts<
    TFamily extends {
      id: string;
      defaultSellingPrice?: unknown;
      wholesalePrice?: unknown;
      retailPrice?: unknown;
    },
  >(families: TFamily[]) {
    if (!families.length) return families;
    const familyIds = families.map((family) => family.id);
    const products = await this.prisma.product.findMany({
      where: { productFamilyId: { in: familyIds }, deletedAt: null },
      select: {
        productFamilyId: true,
        defaultSellingPrice: true,
        wholesalePrice: true,
        retailPrice: true,
      },
    });
    const byFamilyId = new Map<
      string,
      {
        productCount: number;
        inheritedPriceCount: number;
        overridePriceCount: number;
        missingPriceCount: number;
        priceExceptionCount: number;
      }
    >();

    for (const family of families) {
      byFamilyId.set(family.id, {
        productCount: 0,
        inheritedPriceCount: 0,
        overridePriceCount: 0,
        missingPriceCount: 0,
        priceExceptionCount: 0,
      });
    }

    const familyById = new Map(families.map((family) => [family.id, family]));
    for (const product of products) {
      const familyId = product.productFamilyId;
      if (!familyId) continue;
      const stats = byFamilyId.get(familyId);
      const family = familyById.get(familyId);
      if (!stats || !family) continue;

      stats.productCount += 1;
      const hasProductPrice =
        positivePrice(product.defaultSellingPrice) != null ||
        positivePrice(product.retailPrice) != null ||
        positivePrice(product.wholesalePrice) != null;
      const hasFamilyPrice =
        positivePrice(family.defaultSellingPrice) != null ||
        positivePrice(family.retailPrice) != null ||
        positivePrice(family.wholesalePrice) != null;

      if (hasProductPrice) stats.overridePriceCount += 1;
      if (!hasProductPrice && hasFamilyPrice) stats.inheritedPriceCount += 1;
      if (!hasProductPrice && !hasFamilyPrice) stats.missingPriceCount += 1;
      if (
        pricesAreDifferent(product.defaultSellingPrice, family.defaultSellingPrice) ||
        pricesAreDifferent(product.retailPrice, family.retailPrice) ||
        pricesAreDifferent(product.wholesalePrice, family.wholesalePrice)
      ) {
        stats.priceExceptionCount += 1;
      }
    }

    return families.map((family) => ({
      ...family,
      ...(byFamilyId.get(family.id) ?? {
        productCount: 0,
        inheritedPriceCount: 0,
        overridePriceCount: 0,
        missingPriceCount: 0,
        priceExceptionCount: 0,
      }),
    }));
  }

  private async assertFamilyReferences(
    companyId: string,
    categoryId: string,
    divisionId?: string | null,
  ) {
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { companyId: true },
    });
    if (!category || category.companyId !== companyId) {
      throw new BadRequestException('Product family category must belong to this company');
    }

    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Product family division must belong to this company');
      }
    }
  }

  private async findFamilyPricing(productFamilyId?: string | null) {
    if (!productFamilyId) return null;
    return this.prisma.productFamily.findFirst({
      where: { id: productFamilyId, deletedAt: null, isActive: true },
      select: {
        defaultPurchasePrice: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
      },
    });
  }

  private async buildFamilyVariantProductPlan(
    dto: CreateProductDto,
    selectedProductFamilyId: string,
  ): Promise<{
    create: FamilyVariantProductPlan[];
    skipped: Array<{ productFamilyId: string; familyName: string; reason: string }>;
  }> {
    const divisionId = optionalText(dto.divisionId) ?? null;
    const families = await this.prisma.productFamily.findMany({
      where: {
        companyId: dto.companyId,
        categoryId: dto.categoryId,
        deletedAt: null,
        isActive: true,
        id: { not: selectedProductFamilyId },
        ...(divisionId
          ? { OR: [{ divisionId }, { divisionId: null }] }
          : { divisionId: null }),
      },
      select: {
        id: true,
        name: true,
        defaultPurchasePrice: true,
        defaultSellingPrice: true,
        wholesalePrice: true,
        retailPrice: true,
      },
      orderBy: [{ name: 'asc' }],
    });
    if (!families.length) return { create: [], skipped: [] };

    const existingProducts = await this.prisma.product.findMany({
      where: {
        companyId: dto.companyId,
        categoryId: dto.categoryId,
        productFamilyId: { in: families.map((family) => family.id) },
        deletedAt: null,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
        ...(divisionId ? { divisionId } : { divisionId: null }),
        ...(optionalText(dto.variantColor)
          ? { variantColor: { equals: optionalText(dto.variantColor), mode: 'insensitive' } }
          : {}),
        ...(optionalText(dto.variantFinish)
          ? { variantFinish: { equals: optionalText(dto.variantFinish), mode: 'insensitive' } }
          : {}),
      },
      select: { productFamilyId: true },
    });
    const existingFamilyIds = new Set(
      existingProducts
        .map((product) => product.productFamilyId)
        .filter((id): id is string => Boolean(id)),
    );

    const create: FamilyVariantProductPlan[] = [];
    const skipped: Array<{ productFamilyId: string; familyName: string; reason: string }> = [];
    for (const family of families) {
      if (existingFamilyIds.has(family.id)) {
        skipped.push({
          productFamilyId: family.id,
          familyName: family.name,
          reason: 'A product with this name already exists in this family.',
        });
        continue;
      }

      create.push({
        family,
        defaultPurchasePrice: family.defaultPurchasePrice ?? dto.defaultPurchasePrice ?? null,
      });
    }

    return { create, skipped };
  }

  private async assertFamilyVariantProductPlanIsValid(
    dto: CreateProductDto,
    plan: {
      create: FamilyVariantProductPlan[];
    },
  ) {
    for (const item of plan.create) {
      if (familyDefaultSellingPrice(item.family) == null) {
        throw new BadRequestException(
          `Product family ${item.family.name} must have a selling, retail, or wholesale price before auto-generating products`,
        );
      }
      this.profit.assertProductMasterPricing({
        name: `${dto.name} ${item.family.name}`,
        productType: dto.productType,
        trackInventory: dto.trackInventory ?? true,
        defaultPurchasePrice: item.defaultPurchasePrice,
      });
      await this.assertInheritedFamilyPriceAboveProductCost({
        productName: `${dto.name} ${item.family.name}`,
        productType: dto.productType,
        trackInventory: dto.trackInventory ?? true,
        defaultPurchasePrice: item.defaultPurchasePrice,
        defaultSellingPrice: null,
        retailPrice: null,
        wholesalePrice: null,
        productFamilyId: item.family.id,
      });
    }
  }

  private async createFamilyVariantProducts(
    dto: CreateProductDto,
    userId: string,
    plan: {
      create: FamilyVariantProductPlan[];
      skipped: Array<{ productFamilyId: string; familyName: string; reason: string }>;
    },
  ) {
    const created = [];
    for (const item of plan.create) {
      const variantLabel = familyVariantLabel(item.family.name);
      const record = await this.prisma.product.create({
        data: {
          productCode: generateProductCode(),
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          categoryId: dto.categoryId,
          productFamilyId: item.family.id,
          name: dto.name,
          variantName: variantLabel,
          variantColor: optionalText(dto.variantColor),
          variantSize: variantLabel,
          variantFinish: optionalText(dto.variantFinish),
          description: dto.description,
          productType: dto.productType,
          baseUnitId: dto.baseUnitId,
          purchaseUnitId: dto.purchaseUnitId,
          salesUnitId: dto.salesUnitId,
          defaultPurchasePrice: item.defaultPurchasePrice,
          defaultSellingPrice: null,
          wholesalePrice: null,
          retailPrice: null,
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

      const meta = auditFor('Product', 'CREATE');
      await this.auditLogs.log({
        action: meta.action,
        entityType: 'Product',
        entityId: record.id,
        userId,
        companyId: record.companyId,
        newValue: {
          ...record,
          generatedFromFamilyVariantCreate: true,
        },
        severity: meta.severity,
      });

      created.push(record);
    }

    return { created, skipped: plan.skipped };
  }

  private assertFamilyPricing(prices: {
    defaultPurchasePrice?: number | string | Prisma.Decimal | null;
    defaultSellingPrice?: number | string | Prisma.Decimal | null;
    wholesalePrice?: number | string | Prisma.Decimal | null;
    retailPrice?: number | string | Prisma.Decimal | null;
  }) {
    const defaultPurchasePrice = positivePrice(prices.defaultPurchasePrice);
    if (defaultPurchasePrice == null) return;

    for (const [label, raw] of [
      ['default selling price', prices.defaultSellingPrice],
      ['retail price', prices.retailPrice],
      ['wholesale price', prices.wholesalePrice],
    ] as const) {
      const price = positivePrice(raw);
      if (price != null && price <= defaultPurchasePrice) {
        throw new BadRequestException(`Family ${label} must be greater than family purchase price`);
      }
    }
  }

  private async assertInheritedFamilyPriceAboveProductCost(input: {
    productName: string;
    productType?: string | null;
    trackInventory?: boolean | null;
    defaultPurchasePrice?: number | string | Prisma.Decimal | null;
    defaultSellingPrice?: number | string | Prisma.Decimal | null;
    retailPrice?: number | string | Prisma.Decimal | null;
    wholesalePrice?: number | string | Prisma.Decimal | null;
    productFamilyId?: string | null;
  }) {
    if (!this.profit.isStockProduct(input)) return;
    if (!input.productFamilyId) return;

    const hasProductSalePrice =
      positivePrice(input.defaultSellingPrice) != null ||
      positivePrice(input.retailPrice) != null ||
      positivePrice(input.wholesalePrice) != null;
    if (hasProductSalePrice) return;

    const family = await this.prisma.productFamily.findFirst({
      where: { id: input.productFamilyId, deletedAt: null, isActive: true },
      select: {
        defaultPurchasePrice: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
      },
    });
    const cost =
      positivePrice(input.defaultPurchasePrice) ?? positivePrice(family?.defaultPurchasePrice);
    if (cost == null) return;

    const inheritedPrice =
      positivePrice(family?.defaultSellingPrice) ??
      positivePrice(family?.retailPrice) ??
      positivePrice(family?.wholesalePrice);
    if (inheritedPrice != null && inheritedPrice <= cost) {
      throw new BadRequestException(
        `${input.productName} inherited family selling price must be greater than purchase cost`,
      );
    }
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
    const [enriched] = await this.withProductListAliasesAndAvailability([record]);
    return enriched;
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
    const familyPricing = await this.findFamilyPricing(productFamilyId);
    const effectiveDefaultPurchasePrice =
      dto.defaultPurchasePrice ?? familyPricing?.defaultPurchasePrice ?? null;
    const familyVariantPlan =
      dto.createFamilyVariants && productFamilyId
        ? await this.buildFamilyVariantProductPlan(dto, productFamilyId)
        : { create: [], skipped: [] };

    const existing = await this.prisma.product.findFirst({
      where: { productCode, companyId: dto.companyId, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException('A product with this code already exists in the company');
    }
    this.profit.assertProductMasterPricing({
      ...dto,
      trackInventory: dto.trackInventory ?? true,
      defaultPurchasePrice: effectiveDefaultPurchasePrice,
    });
    await this.assertInheritedFamilyPriceAboveProductCost({
      productName: dto.name,
      productType: dto.productType,
      trackInventory: dto.trackInventory ?? true,
      defaultPurchasePrice: effectiveDefaultPurchasePrice,
      defaultSellingPrice: dto.defaultSellingPrice,
      retailPrice: dto.retailPrice,
      wholesalePrice: dto.wholesalePrice,
      productFamilyId,
    });
    await this.assertFamilyVariantProductPlanIsValid(dto, familyVariantPlan);

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
        defaultPurchasePrice: effectiveDefaultPurchasePrice,
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

    const familyVariantProducts = await this.createFamilyVariantProducts(
      dto,
      userId,
      familyVariantPlan,
    );

    return {
      ...record,
      generatedFamilyProducts: familyVariantProducts.created,
      skippedFamilyProducts: familyVariantProducts.skipped,
    };
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
    const effectiveProductFamilyId =
      productFamilyId !== undefined ? productFamilyId : existing.productFamilyId;
    const familyPricing = await this.findFamilyPricing(effectiveProductFamilyId);
    const effectiveDefaultPurchasePrice =
      dto.defaultPurchasePrice !== undefined
        ? dto.defaultPurchasePrice
        : existing.defaultPurchasePrice ?? familyPricing?.defaultPurchasePrice ?? null;

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
    this.profit.assertProductMasterPricing({
      name: dto.name ?? existing.name,
      productType: dto.productType ?? existing.productType,
      trackInventory: dto.trackInventory ?? existing.trackInventory,
      defaultPurchasePrice: effectiveDefaultPurchasePrice,
      defaultSellingPrice:
        dto.defaultSellingPrice !== undefined
          ? dto.defaultSellingPrice
          : existing.defaultSellingPrice,
      retailPrice: dto.retailPrice !== undefined ? dto.retailPrice : existing.retailPrice,
      wholesalePrice:
        dto.wholesalePrice !== undefined ? dto.wholesalePrice : existing.wholesalePrice,
    });
    await this.assertInheritedFamilyPriceAboveProductCost({
      productName: dto.name ?? existing.name,
      productType: dto.productType ?? existing.productType,
      trackInventory: dto.trackInventory ?? existing.trackInventory,
      defaultPurchasePrice: effectiveDefaultPurchasePrice,
      defaultSellingPrice:
        dto.defaultSellingPrice !== undefined
          ? dto.defaultSellingPrice
          : existing.defaultSellingPrice,
      retailPrice: dto.retailPrice !== undefined ? dto.retailPrice : existing.retailPrice,
      wholesalePrice:
        dto.wholesalePrice !== undefined ? dto.wholesalePrice : existing.wholesalePrice,
      productFamilyId: effectiveProductFamilyId,
    });

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
