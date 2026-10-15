import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProfitService } from '../profit/profit.service';

const stamp = new Date('2026-10-13T10:00:00.000Z');
const user = {
  id: 'user',
  companyId: 'company',
  roleScopes: ['COMPANY'],
  permissions: ['products.update'],
} as any;
const initial = () => ({
  id: 'product',
  companyId: 'company',
  name: 'Old name',
  productCode: 'P-001',
  categoryId: 'category',
  divisionId: null,
  productFamilyId: null,
  productType: 'STOCK_ITEM',
  baseUnitId: 'unit',
  trackInventory: true,
  defaultPurchasePrice: null,
  defaultSellingPrice: null,
  retailPrice: null,
  wholesalePrice: null,
  deletedAt: null,
  updatedAt: stamp,
});
function fixture(overrides: Record<string, unknown> = {}) {
  let stored = { ...initial(), ...overrides };
  const product = {
    findFirst: jest.fn(async () => ({ ...stored })),
    findUnique: jest.fn(async () => ({ _count: {} })),
    updateMany: jest.fn(async ({ data }: any) => {
      stored = { ...stored, ...data };
      return { count: 1 };
    }),
    findUniqueOrThrow: jest.fn(async () => ({ ...stored })),
  };
  const db = {
    product,
    $queryRaw: jest.fn().mockResolvedValue([]),
    productFamily: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'new-family' }),
    },
    productCategory: { findFirst: jest.fn().mockResolvedValue({ companyId: 'company' }) },
    division: { findFirst: jest.fn().mockResolvedValue({ companyId: 'company' }) },
    unitOfMeasure: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'other-unit', companyId: 'company', status: 'ACTIVE' }]),
    },
    inventoryBalance: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    ...db,
    $transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => {
      const before = { ...stored };
      try {
        return await work(db);
      } catch (error) {
        stored = before;
        throw error;
      }
    }),
  };
  const audit = { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) };
  const scope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
  const profit = {
    assertProductMasterPricing: jest.fn(),
    isStockProduct: jest.fn(ProfitService.prototype.isStockProduct),
  };
  const service = new ProductsService(
    prisma as any,
    audit as any,
    scope as any,
    profit as any,
    {} as any,
  );
  return { service, db, prisma, product, audit, scope, profit, stored: () => stored };
}

describe('product metadata and definition updates', () => {
  it('trims a name-only update without requiring repair of untouched legacy prices', async () => {
    const f = fixture();
    const result = await f.service.update(
      'product',
      { name: '  New name  ', expectedUpdatedAt: stamp.toISOString() },
      user,
    );
    expect(result.name).toBe('New name');
    expect(result.updatedAt.getTime()).toBeGreaterThan(stamp.getTime());
    expect(f.profit.assertProductMasterPricing).not.toHaveBeenCalled();
    expect(f.audit.logStrictInTransaction).toHaveBeenCalledWith(
      f.db,
      expect.objectContaining({
        action: 'PRODUCT_UPDATE',
        oldValue: expect.objectContaining({ name: 'Old name' }),
        newValue: expect.objectContaining({ name: 'New name' }),
        companyId: 'company',
      }),
    );
  });
  it('rejects a stale edit before reference checks, family creation, product write or audit', async () => {
    const f = fixture();
    await expect(
      f.service.update(
        'product',
        { name: 'New', productFamilyName: 'New family', expectedUpdatedAt: '2026-10-12T10:00:00Z' },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.productFamily.findFirst).not.toHaveBeenCalled();
    expect(f.db.productFamily.create).not.toHaveBeenCalled();
    expect(f.product.updateMany).not.toHaveBeenCalled();
    expect(f.audit.logStrictInTransaction).not.toHaveBeenCalled();
    expect(f.stored().name).toBe('Old name');
  });
  it('compares against the fresh locked row, including changes made after the authorization read', async () => {
    const f = fixture({ updatedAt: new Date('2026-10-13T10:01:00Z') });
    f.product.findFirst.mockResolvedValueOnce(initial() as any);
    await expect(
      f.service.update('product', { name: 'New', expectedUpdatedAt: stamp.toISOString() }, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.product.updateMany).not.toHaveBeenCalled();
  });
  it('rolls the product change back when the strict transactional audit fails', async () => {
    const f = fixture();
    f.audit.logStrictInTransaction.mockRejectedValue(new Error('Audit unavailable'));
    await expect(f.service.update('product', { name: 'New' }, user)).rejects.toThrow(
      'Audit unavailable',
    );
    expect(f.stored().name).toBe('Old name');
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects blank names and malformed stamps without any mutation', async () => {
    const f = fixture();
    await expect(f.service.update('product', { name: '   ' }, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      f.service.update('product', { expectedUpdatedAt: 'invalid' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.product.updateMany).not.toHaveBeenCalled();
  });
  it('still validates changed prices and tracking/type dependencies', async () => {
    const f = fixture();
    f.profit.assertProductMasterPricing.mockImplementation(() => {
      throw new BadRequestException('Purchase cost required');
    });
    await expect(f.service.update('product', { defaultSellingPrice: 10 }, user)).rejects.toThrow(
      'Purchase cost required',
    );
    expect(f.profit.assertProductMasterPricing).toHaveBeenCalled();
    expect(f.product.updateMany).not.toHaveBeenCalled();
  });
  it('does not treat a supplied unchanged Decimal price as a pricing change', async () => {
    const f = fixture({ defaultPurchasePrice: new Prisma.Decimal(0) });
    await f.service.update('product', { name: 'New', defaultPurchasePrice: 0 }, user);
    expect(f.profit.assertProductMasterPricing).not.toHaveBeenCalled();
  });
  it('revalidates effective family pricing when the family assignment changes', async () => {
    const f = fixture();
    f.db.productFamily.findFirst.mockImplementation(async (args: any) =>
      args.select?.id
        ? { id: 'new-family', companyId: 'company', categoryId: 'category', divisionId: null }
        : {
            defaultPurchasePrice: new Prisma.Decimal(20),
            defaultSellingPrice: new Prisma.Decimal(10),
          },
    );
    await expect(
      f.service.update('product', { productFamilyId: 'new-family' }, user),
    ).rejects.toThrow('inherited family selling price');
    expect(f.profit.assertProductMasterPricing).toHaveBeenCalled();
    expect(f.product.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a base-unit change for a product with historical usage', async () => {
    const f = fixture();
    f.product.findUnique.mockResolvedValue({ _count: { inventoryMovements: 1 } } as any);
    await expect(f.service.update('product', { baseUnitId: 'other-unit' }, user)).rejects.toThrow(
      'base unit cannot change',
    );
    expect(f.product.updateMany).not.toHaveBeenCalled();
  });
  it('allows base-unit changes for an unused product', async () => {
    const f = fixture();
    const result = await f.service.update('product', { baseUnitId: 'other-unit' }, user);
    expect(result.baseUnitId).toBe('other-unit');
  });
  it('prevents disabling tracking with any stock, reservation or value exposure', async () => {
    const f = fixture();
    f.db.inventoryBalance.findFirst.mockResolvedValue({ id: 'balance' } as any);
    await expect(f.service.update('product', { trackInventory: false }, user)).rejects.toThrow(
      'stock, reservations or stock value remain',
    );
    expect(f.db.inventoryBalance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: 'product',
          OR: [
            { quantityOnHand: { not: 0 } },
            { quantityReserved: { not: 0 } },
            { totalValue: { not: 0 } },
          ],
        },
      }),
    );
    expect(f.product.updateMany).not.toHaveBeenCalled();
  });
  it('requires write scope before beginning a transaction', async () => {
    const f = fixture();
    f.scope.assertCanAccessCompany.mockRejectedValue(new ForbiddenException());
    await expect(f.service.update('product', { name: 'New' }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['SERVICE', 'NON_STOCK_ITEM'] as const)(
    'blocks a type-only change to %s while effective stock exposure remains',
    async (productType) => {
      const f = fixture();
      f.db.inventoryBalance.findFirst.mockResolvedValue({ id: 'exposed-balance' } as any);
      await expect(f.service.update('product', { productType }, user)).rejects.toThrow(
        'stock, reservations or stock value remain',
      );
      expect(f.stored().productType).toBe('STOCK_ITEM');
      expect(f.stored().trackInventory).toBe(true);
      expect(f.product.updateMany).not.toHaveBeenCalled();
      expect(f.audit.logStrictInTransaction).not.toHaveBeenCalled();
    },
  );
  it('permits a type-only change to a service once all stock exposure is zero', async () => {
    const f = fixture();
    const result = await f.service.update('product', { productType: 'SERVICE' }, user);
    expect(result.productType).toBe('SERVICE');
    expect(f.db.inventoryBalance.findFirst).toHaveBeenCalled();
  });
  it('normalizes names and validates the optional editor timestamp at the HTTP boundary', async () => {
    const update = plainToInstance(UpdateProductDto, {
      name: '  Renamed  ',
      expectedUpdatedAt: stamp.toISOString(),
    });
    expect(update.name).toBe('Renamed');
    expect(await validate(update)).toHaveLength(0);
    const blank = plainToInstance(UpdateProductDto, { name: '   ' });
    expect((await validate(blank)).map((issue) => issue.property)).toContain('name');
    const create = plainToInstance(CreateProductDto, { name: '  New product  ' });
    expect(create.name).toBe('New product');
  });
});
