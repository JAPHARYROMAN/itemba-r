import { ForbiddenException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { priceSourceWhere } from './price-source-where';

const user = { id: 'user' } as any;
describe('product workspace read contracts', () => {
  it('returns product identity, division and effective family pricing after checking company access', async () => {
    const record = {
      id: 'product',
      companyId: 'company',
      division: { id: 'division', name: 'Building supplies', code: 'BS' },
      defaultSellingPrice: 0,
      productFamily: { defaultSellingPrice: 18000, defaultPurchasePrice: 12000 },
    };
    const product = { findFirst: jest.fn().mockResolvedValue(record) };
    const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
    const service = new ProductsService(
      { product } as any,
      {} as any,
      companyScope as any,
      {} as any,
      {} as any,
    );
    const result = await service.findOne('product', user);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company', 'READ');
    expect(product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product', deletedAt: null },
        include: expect.objectContaining({
          division: { select: { id: true, name: true, code: true } },
        }),
      }),
    );
    expect(result).toMatchObject({
      division: record.division,
      effectiveSellingPrice: 18000,
      effectivePurchasePrice: 12000,
      priceSource: 'FAMILY_DEFAULT',
    });
    companyScope.assertCanAccessCompany.mockRejectedValue(new ForbiddenException());
    await expect(service.findOne('product', user)).rejects.toBeInstanceOf(ForbiddenException);
  });
  const create = (records: any[] = []) => {
    const product = {
      findMany: jest.fn().mockResolvedValue(records),
      count: jest.fn().mockResolvedValue(23),
    };
    const inventoryBalance = { findMany: jest.fn().mockResolvedValue([]) };
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: { in: ['company'] } }),
    };
    const service = new ProductsService(
      { product, inventoryBalance } as any,
      {} as any,
      companyScope as any,
      {} as any,
      {} as any,
    );
    return { product, inventoryBalance, companyScope, service };
  };
  it('combines company, division, search, family and pricing filters for both reads and counts', async () => {
    const { product, companyScope, service } = create();
    const result = await service.findAll(
      {
        companyId: 'company',
        divisionId: 'division',
        categoryId: 'category',
        productFamilyId: 'family',
        productType: 'STOCK_ITEM',
        status: 'ACTIVE',
        priceSource: 'FAMILY_DEFAULT',
        search: 'coral',
        page: 2,
        limit: 20,
      },
      user,
    );
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(user, 'company');
    const where = product.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      deletedAt: null,
      companyId: { in: ['company'] },
      categoryId: 'category',
      productFamilyId: 'family',
      productType: 'STOCK_ITEM',
      status: 'ACTIVE',
    });
    expect(where.AND[0]).toEqual({ OR: [{ divisionId: 'division' }, { divisionId: null }] });
    expect(where.AND[1].OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'coral', mode: 'insensitive' } },
        { barcode: { contains: 'coral', mode: 'insensitive' } },
        { productFamily: { brand: { contains: 'coral', mode: 'insensitive' } } },
      ]),
    );
    expect(where.AND[2]).toEqual(priceSourceWhere('FAMILY_DEFAULT'));
    expect(product.count).toHaveBeenCalledWith({ where });
    expect(product.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
    expect(result).toMatchObject({ total: 23, page: 2, totalPages: 2 });
  });
  it('rejects an inaccessible company before reading products or balances', async () => {
    const { service, companyScope, product, inventoryBalance } = create();
    companyScope.companyWhereFor.mockRejectedValue(new ForbiddenException());
    await expect(
      service.findAll({ companyId: 'forbidden', branchId: 'branch' }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(product.findMany).not.toHaveBeenCalled();
    expect(inventoryBalance.findMany).not.toHaveBeenCalled();
  });
  it('keeps unscoped stock unavailable while preserving inherited, overridden and missing prices', async () => {
    const base = {
      companyId: 'company',
      baseUnitId: 'unit',
      baseUnit: { name: 'Litre', symbol: 'L' },
    };
    const { service, inventoryBalance } = create([
      {
        ...base,
        id: 'inherited',
        defaultSellingPrice: 0,
        productFamily: { defaultPurchasePrice: 12, retailPrice: 20, wholesalePrice: 18 },
      },
      {
        ...base,
        id: 'override',
        defaultSellingPrice: 25,
        productFamily: { defaultSellingPrice: 20 },
      },
      { ...base, id: 'missing', defaultSellingPrice: null },
    ]);
    const result = await service.findAll({}, user);
    expect(result.data[0]).toMatchObject({
      effectiveSellingPrice: 20,
      effectivePurchasePrice: 12,
      effectiveWholesalePrice: 18,
      priceSource: 'FAMILY_DEFAULT',
    });
    expect(result.data[1]).toMatchObject({
      effectiveSellingPrice: 25,
      priceSource: 'PRODUCT_OVERRIDE',
    });
    expect(result.data[2]).toMatchObject({
      effectiveSellingPrice: null,
      effectivePurchasePrice: null,
      priceSource: 'MISSING',
    });
    expect(result.data[0]).not.toHaveProperty('availableQuantity');
    expect(inventoryBalance.findMany).not.toHaveBeenCalled();
  });
  it('scopes balances to the selected branch and accessible products, retaining zero quantities', async () => {
    const base = { companyId: 'company', baseUnitId: 'unit' };
    const { service, inventoryBalance } = create([
      { ...base, id: 'reserved' },
      { ...base, id: 'no-balance' },
    ]);
    inventoryBalance.findMany.mockResolvedValue([
      { productId: 'reserved', quantityOnHand: '4', quantityReserved: '4', averageCost: '12000' },
    ]);
    const result = await service.findAll({ branchId: 'branch' }, user);
    expect(inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branchId: 'branch',
          productId: { in: ['reserved', 'no-balance'] },
          companyId: { in: ['company'] },
        },
      }),
    );
    expect(result.data[0]).toMatchObject({
      availableQuantity: 0,
      inventoryBalance: { quantityOnHand: 4, quantityReserved: 4 },
    });
    expect(result.data[1]).toMatchObject({
      availableQuantity: 0,
      inventoryBalance: { quantityOnHand: 0 },
    });
  });
});
