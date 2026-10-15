import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';

const user = {
  id: 'user',
  companyId: 'company',
  roleScopes: ['COMPANY'],
  permissions: ['inventory.view'],
} as any;
const record = (id: string, name: string) => ({
  id,
  name,
  companyId: 'company',
  baseUnitId: 'unit',
  productCode: id,
});
function fixture() {
  const product = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const branch = {
    findFirst: jest.fn().mockResolvedValue({
      id: 'branch',
      divisionId: 'division',
      division: { companyId: 'company' },
    }),
  };
  const inventoryBalance = { findMany: jest.fn().mockResolvedValue([]) };
  const organization = { assertCanAccessScope: jest.fn().mockResolvedValue(undefined) };
  const companyScope = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }) };
  const db = { product, branch, inventoryBalance };
  const prisma = { ...db, $transaction: jest.fn((work: (client: any) => unknown) => work(db)) };
  const service = new ProductsService(
    prisma as any,
    {} as any,
    companyScope as any,
    {} as any,
    {} as any,
    organization as any,
  );
  return { service, product, branch, inventoryBalance, organization, companyScope, prisma };
}

describe('product lookup ranking and scoped availability', () => {
  it('returns the exact identifier before alphabetical fuzzy matches and before the lookup limit', async () => {
    const f = fixture();
    f.product.count.mockResolvedValueOnce(1).mockResolvedValueOnce(101);
    f.product.findMany
      .mockResolvedValueOnce([record('EXACT', 'Zebra exact item')])
      .mockResolvedValueOnce(
        Array.from({ length: 7 }, (_, index) =>
          record(`fuzzy-${index}`, `Alphabetical fuzzy ${index}`),
        ),
      );
    const result = await f.service.findAll(
      { search: '  eXaCt  ', companyId: 'company', status: 'ACTIVE', limit: 8 },
      user,
    );
    expect(result.data.map((row) => row.id)).toEqual([
      'EXACT',
      ...Array.from({ length: 7 }, (_, i) => `fuzzy-${i}`),
    ]);
    expect(result.total).toBe(101);
    const exact = f.product.findMany.mock.calls[0][0];
    const fuzzy = f.product.findMany.mock.calls[1][0];
    expect(exact).toMatchObject({ skip: 0, take: 1, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    expect(exact.where.AND[0]).toMatchObject({ companyId: 'company', status: 'ACTIVE' });
    expect(exact.where.AND[1]).toEqual({
      OR: [
        { productCode: { equals: 'eXaCt', mode: 'insensitive' } },
        { sku: { equals: 'eXaCt', mode: 'insensitive' } },
        { barcode: { equals: 'eXaCt', mode: 'insensitive' } },
      ],
    });
    expect(fuzzy).toMatchObject({ skip: 0, take: 7 });
    expect(fuzzy.where.AND[1]).toMatchObject({
      AND: [
        { NOT: { productCode: { equals: 'eXaCt', mode: 'insensitive' } } },
        { OR: [{ sku: null }, { NOT: { sku: { equals: 'eXaCt', mode: 'insensitive' } } }] },
        { OR: [{ barcode: null }, { NOT: { barcode: { equals: 'eXaCt', mode: 'insensitive' } } }] },
      ],
    });
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
  it('paginates across the exact/fuzzy boundary without dropping or duplicating fuzzy rows', async () => {
    const f = fixture();
    f.product.count.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
    f.product.findMany
      .mockResolvedValueOnce([record('exact-last', 'Last exact')])
      .mockResolvedValueOnce([record('fuzzy-first', 'First fuzzy')]);
    const page = await f.service.findAll({ search: 'SKU', page: 2, limit: 2 }, user);
    expect(page.data.map((row) => row.id)).toEqual(['exact-last', 'fuzzy-first']);
    expect(f.product.findMany.mock.calls[0][0]).toMatchObject({ skip: 2, take: 1 });
    expect(f.product.findMany.mock.calls[1][0]).toMatchObject({ skip: 0, take: 1 });
    f.product.findMany.mockClear();
    f.product.count.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
    f.product.findMany.mockResolvedValueOnce([
      record('fuzzy-second', 'Second fuzzy'),
      record('fuzzy-third', 'Third fuzzy'),
    ]);
    const next = await f.service.findAll({ search: 'SKU', page: 3, limit: 2 }, user);
    expect(next.data.map((row) => row.id)).toEqual(['fuzzy-second', 'fuzzy-third']);
    expect(f.product.findMany).toHaveBeenCalledTimes(1);
    expect(f.product.findMany.mock.calls[0][0]).toMatchObject({ skip: 1, take: 2 });
  });
  it('rejects a branch outside authorized company scope before reading products or stock', async () => {
    const f = fixture();
    f.branch.findFirst.mockResolvedValue(null as any);
    await expect(
      f.service.findAll({ companyId: 'company', branchId: 'other-company-branch' }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'other-company-branch',
          deletedAt: null,
          division: { deletedAt: null, AND: [{ companyId: 'company' }] },
        },
      }),
    );
    expect(f.product.findMany).not.toHaveBeenCalled();
    expect(f.inventoryBalance.findMany).not.toHaveBeenCalled();
  });
  it('checks organization grants before returning another branch availability', async () => {
    const f = fixture();
    f.organization.assertCanAccessScope.mockRejectedValue(new ForbiddenException('Branch denied'));
    await expect(f.service.findAll({ branchId: 'branch' }, user)).rejects.toThrow('Branch denied');
    expect(f.organization.assertCanAccessScope).toHaveBeenCalledWith(user, 'division', 'branch');
    expect(f.inventoryBalance.findMany).not.toHaveBeenCalled();
    expect(f.product.findMany).not.toHaveBeenCalled();
  });
  it('preserves over-reservation and scopes availability to the branch company and eligible division', async () => {
    const f = fixture();
    f.product.findMany.mockResolvedValue([record('stock', 'Stock item')]);
    f.inventoryBalance.findMany.mockResolvedValue([
      { productId: 'stock', quantityOnHand: '2', quantityReserved: '5', averageCost: '10' },
    ] as any);
    const result = await f.service.findAll({ branchId: 'branch' }, user);
    expect(result.data[0]).toMatchObject({
      availableQuantity: -3,
      inventoryBalance: { quantityOnHand: 2, quantityReserved: 5, branchId: 'branch' },
    });
    expect(f.product.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: 'company',
      OR: [{ divisionId: 'division' }, { divisionId: null }],
    });
    expect(f.inventoryBalance.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: { in: ['company'] },
      branchId: 'branch',
    });
  });
});
