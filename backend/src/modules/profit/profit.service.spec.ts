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
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  return { service: new ProfitService(prisma, companyScope, auditLogs), prisma, auditLogs };
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
    const { service, auditLogs } = makeService({
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
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFIT_VALIDATION_BLOCKED' }),
    );
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

describe('ProfitService productSummary missing-cost flagging', () => {
  it('flags only stock lines that have no recorded cost', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrderLine = {
      findMany: jest.fn(async () => [
        {
          productId: 'p1',
          quantity: 2,
          unitPrice: 100,
          discountAmount: 0,
          cogsAmount: null, // stock line, no snapshot → flagged
          product: { id: 'p1', productCode: 'P1', name: 'Steel', productType: 'STOCK_ITEM', trackInventory: true },
        },
        {
          productId: 'p2',
          quantity: 1,
          unitPrice: 50,
          discountAmount: 0,
          cogsAmount: 30, // costed → not flagged
          product: { id: 'p2', productCode: 'P2', name: 'Pipe', productType: 'STOCK_ITEM', trackInventory: true },
        },
        {
          productId: 'p3',
          quantity: 1,
          unitPrice: 40,
          discountAmount: 0,
          cogsAmount: null, // service, no COGS by design → not flagged
          product: { id: 'p3', productCode: 'P3', name: 'Install', productType: 'SERVICE', trackInventory: false },
        },
      ]),
    };
    jest.spyOn(service as any, 'salesOrderWhere').mockResolvedValue({});
    jest.spyOn(service as any, 'costGaps').mockResolvedValue({ total: 0 });

    const result = await service.productSummary({}, { id: 'u1' } as any);

    expect(result.summary.linesMissingCost).toBe(1);
    expect(result.summary.revenueMissingCost).toBe(200);
  });
});
