import { BadRequestException } from '@nestjs/common';
import { ProductCategoriesService } from './product-categories.service';

function makeService() {
  const prisma: any = {
    productCategory: {
      findFirst: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ id: 'A', companyId: 'c1', ...data })),
    },
  };
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new ProductCategoriesService(prisma, auditLogs, companyScope);
  // Isolate the cycle guard from findOne + the company-scope parent check.
  jest.spyOn(service as any, 'findOne').mockResolvedValue({ id: 'A', companyId: 'c1' });
  jest.spyOn(service as any, 'assertParentCategoryBelongsToCompany').mockResolvedValue(undefined);
  return { service, prisma };
}

const user = { id: 'u1' } as any;

describe('ProductCategoriesService findAll status counts', () => {
  function makeListService() {
    const prisma: any = {
      productCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn(),
      },
    };
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      accessibleCompanyIds: jest.fn().mockResolvedValue(null),
    } as any;
    const service = new ProductCategoriesService(prisma, {} as any, companyScope);
    return { service, prisma };
  }

  it('collapses groupBy rows into flat active/inactive/total counts', async () => {
    const { service, prisma } = makeListService();
    prisma.productCategory.groupBy.mockResolvedValue([
      { isActive: true, _count: { _all: 7 } },
      { isActive: false, _count: { _all: 3 } },
    ]);

    const result = await service.findAll({} as any, user);

    expect(result.counts).toEqual({ active: 7, inactive: 3, total: 10 });
  });

  it('aggregates over the unfiltered-by-isActive scope, ignoring the isActive filter', async () => {
    const { service, prisma } = makeListService();
    prisma.productCategory.groupBy.mockResolvedValue([{ isActive: true, _count: { _all: 4 } }]);

    await service.findAll({ isActive: true, companyId: 'c1', search: 'box' } as any, user);

    // The list query carries the isActive filter; the count aggregate does not.
    expect(prisma.productCategory.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
    const groupByArgs = prisma.productCategory.groupBy.mock.calls[0][0];
    expect(groupByArgs.by).toEqual(['isActive']);
    expect(groupByArgs.where).not.toHaveProperty('isActive');
    // ...but it keeps the other filters (company scope + search).
    expect(groupByArgs.where).toEqual(
      expect.objectContaining({ companyId: 'c1', deletedAt: null }),
    );
  });

  it('defaults missing status buckets to zero', async () => {
    const { service, prisma } = makeListService();
    prisma.productCategory.groupBy.mockResolvedValue([{ isActive: true, _count: { _all: 2 } }]);

    const result = await service.findAll({} as any, user);

    expect(result.counts).toEqual({ active: 2, inactive: 0, total: 2 });
  });
});

describe('ProductCategoriesService parent-cycle guard', () => {
  it('rejects making a category its own parent', async () => {
    const { service } = makeService();
    await expect(
      service.update('A', { parentCategoryId: 'A' } as any, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a parent that is a descendant (would create a cycle)', async () => {
    const { service, prisma } = makeService();
    // A → parent C; C → B; B → A  ⇒ cycle back to A.
    const chain: Record<string, { parentCategoryId: string | null }> = {
      C: { parentCategoryId: 'B' },
      B: { parentCategoryId: 'A' },
    };
    prisma.productCategory.findFirst.mockImplementation(
      async ({ where }: any) => chain[where.id] ?? null,
    );

    await expect(service.update('A', { parentCategoryId: 'C' } as any, user)).rejects.toThrow(
      /cycle/i,
    );
    expect(prisma.productCategory.update).not.toHaveBeenCalled();
  });

  it('allows a parent that is not an ancestor of itself', async () => {
    const { service, prisma } = makeService();
    prisma.productCategory.findFirst.mockResolvedValue({ parentCategoryId: null }); // D has no parent

    await service.update('A', { parentCategoryId: 'D' } as any, user);
    expect(prisma.productCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentCategoryId: 'D' }) }),
    );
  });
});
