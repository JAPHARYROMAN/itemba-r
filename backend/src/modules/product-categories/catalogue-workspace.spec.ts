import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { ProductCategoriesService } from './product-categories.service';
import { ProductsService } from '../products/products.service';

const user = { id: 'user' } as any;
describe('catalogue workspace service contracts', () => {
  const scope = () => ({
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    accessibleCompanyIds: jest.fn().mockResolvedValue(['company']),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }),
  });
  it('keeps accessible companies in matching counts and aggregate counts', async () => {
    const categories = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    };
    const service = new ProductCategoriesService(
      { productCategory: categories } as any,
      {} as any,
      scope() as any,
    );
    await service.findAll({ search: 'paint', isActive: false, page: 2, limit: 20 }, user);
    expect(categories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        where: {
          companyId: { in: ['company'] },
          deletedAt: null,
          name: { contains: 'paint', mode: 'insensitive' },
          isActive: false,
        },
      }),
    );
    expect(categories.count.mock.calls[0][0].where).toEqual(
      categories.findMany.mock.calls[0][0].where,
    );
    expect(categories.groupBy.mock.calls[0][0].where).toEqual({
      companyId: { in: ['company'] },
      deletedAt: null,
      name: { contains: 'paint', mode: 'insensitive' },
    });
  });
  it('rejects forbidden category scope before database reads', async () => {
    const companyScope = scope();
    companyScope.assertCanAccessCompany.mockRejectedValue(new ForbiddenException());
    const findMany = jest.fn();
    const service = new ProductCategoriesService(
      { productCategory: { findMany } } as any,
      {} as any,
      companyScope as any,
    );
    await expect(service.findAll({ companyId: 'forbidden' }, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });
  it('clears category parent and description while retaining write scope and audit', async () => {
    const companyScope = scope(),
      log = jest.fn();
    const category = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'category',
        companyId: 'company',
        parentCategoryId: 'old',
        description: 'old',
      }),
      update: jest.fn().mockResolvedValue({
        id: 'category',
        companyId: 'company',
        parentCategoryId: null,
        description: null,
      }),
    };
    const service = new ProductCategoriesService(
      { productCategory: category } as any,
      { log } as any,
      companyScope as any,
    );
    await service.update('category', { parentCategoryId: null, description: null } as any, user);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company',
      AccessLevel.WRITE,
    );
    expect(category.update).toHaveBeenCalledWith({
      where: { id: 'category' },
      data: { parentCategoryId: null, description: null },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRODUCT_CATEGORY_UPDATE', companyId: 'company' }),
    );
  });
  it('combines division and search without losing company/category/status or pagination', async () => {
    const companyScope = scope();
    const families = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new ProductsService(
      { productFamily: families } as any,
      {} as any,
      companyScope as any,
      {} as any,
      {} as any,
    );
    await service.findFamilies(
      {
        companyId: 'company',
        categoryId: 'category',
        divisionId: 'division',
        search: 'coral',
        isActive: false,
        page: 2,
        limit: 20,
      },
      user,
    );
    const where = {
      companyId: 'company',
      deletedAt: null,
      categoryId: 'category',
      isActive: false,
      AND: [
        { OR: [{ divisionId: 'division' }, { divisionId: null }] },
        {
          OR: [
            { name: { contains: 'coral', mode: 'insensitive' } },
            { brand: { contains: 'coral', mode: 'insensitive' } },
          ],
        },
      ],
    };
    expect(families.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 20, take: 20 }),
    );
    expect(families.count).toHaveBeenCalledWith({ where });
  });
  it('retains complete inherited/override/missing and differing-price counts', async () => {
    const companyScope = scope();
    const families = {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'family', defaultSellingPrice: 100, wholesalePrice: 90 },
          { id: 'empty' },
        ]),
      count: jest.fn().mockResolvedValue(2),
    };
    const products = {
      findMany: jest.fn().mockResolvedValue([
        { productFamilyId: 'family', defaultSellingPrice: null },
        { productFamilyId: 'family', wholesalePrice: 95 },
        { productFamilyId: 'empty', defaultSellingPrice: 0 },
      ]),
    };
    const service = new ProductsService(
      { productFamily: families, product: products } as any,
      {} as any,
      companyScope as any,
      {} as any,
      {} as any,
    );
    const result = await service.findFamilies({ companyId: 'company' }, user);
    expect(result.data[0]).toMatchObject({
      productCount: 2,
      inheritedPriceCount: 1,
      overridePriceCount: 1,
      missingPriceCount: 0,
      priceExceptionCount: 1,
    });
    expect(result.data[1]).toMatchObject({
      productCount: 1,
      inheritedPriceCount: 0,
      overridePriceCount: 0,
      missingPriceCount: 1,
    });
    expect(products.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productFamilyId: { in: ['family', 'empty'] }, deletedAt: null },
      }),
    );
  });
});
