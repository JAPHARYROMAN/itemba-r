import { BadRequestException } from '@nestjs/common';
import { ProfitCostSource } from '@prisma/client';
import { ProfitService } from './profit.service';

function makeService({
  product = {
    id: 'product-1',
    companyId: 'company-1',
    name: 'Steel Bar',
    productType: 'STOCK_ITEM',
    trackInventory: true,
    defaultPurchasePrice: 80,
  },
  balance,
}: {
  product?: any;
  balance?: any;
} = {}) {
  const prisma = {
    product: {
      findMany: jest.fn(async () => [product]),
    },
    inventoryBalance: {
      findMany: jest.fn(async () => (balance ? [balance] : [])),
    },
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  return { service: new ProfitService(prisma, companyScope), prisma };
}

describe('ProfitService no-loss rules', () => {
  it('rejects stock products without a purchase cost', () => {
    const { service } = makeService();

    expect(() =>
      service.assertProductMasterPricing({
        name: 'Steel Bar',
        productType: 'STOCK_ITEM',
        trackInventory: true,
        defaultPurchasePrice: 0,
      }),
    ).toThrow(BadRequestException);
  });

  it('blocks below-cost stock sales', async () => {
    const { service } = makeService({
      balance: {
        productId: 'product-1',
        quantityOnHand: 5,
        averageCost: 100,
      },
    });

    await expect(
      service.assertSaleLinesProfitable({
        companyId: 'company-1',
        branchId: 'branch-1',
        lines: [{ productId: 'product-1', quantity: 1, unitPrice: 100 }],
      }),
    ).rejects.toThrow('cannot be sold below cost');
  });

  it('returns frozen gross profit snapshot from branch average cost', async () => {
    const { service } = makeService({
      balance: {
        productId: 'product-1',
        quantityOnHand: 5,
        averageCost: 75,
      },
    });

    const [snapshot] = await service.assertSaleLinesProfitable({
      companyId: 'company-1',
      branchId: 'branch-1',
      lines: [{ productId: 'product-1', quantity: 2, unitPrice: 100, discountAmount: 10 }],
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        unitCostAtSale: 75,
        cogsAmount: 150,
        grossProfitAmount: 40,
        profitCostSource: ProfitCostSource.BRANCH_AVERAGE_COST,
      }),
    );
  });
});
