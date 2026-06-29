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

describe('ProductCategoriesService parent-cycle guard', () => {
  it('rejects making a category its own parent', async () => {
    const { service } = makeService();
    await expect(service.update('A', { parentCategoryId: 'A' } as any, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a parent that is a descendant (would create a cycle)', async () => {
    const { service, prisma } = makeService();
    // A → parent C; C → B; B → A  ⇒ cycle back to A.
    const chain: Record<string, { parentCategoryId: string | null }> = {
      C: { parentCategoryId: 'B' },
      B: { parentCategoryId: 'A' },
    };
    prisma.productCategory.findFirst.mockImplementation(async ({ where }: any) => chain[where.id] ?? null);

    await expect(service.update('A', { parentCategoryId: 'C' } as any, user)).rejects.toThrow(/cycle/i);
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
