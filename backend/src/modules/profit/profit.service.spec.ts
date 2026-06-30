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

describe('ProfitService productSummary db aggregation', () => {
  it('aggregates totals from groupBy (revenue = lineTotal - tax) and flags missing-cost stock lines', async () => {
    const { service, prisma } = makeService();
    // Stock line p1: revenue 200, no cost → flagged. p2: revenue 50, cost 30 → costed.
    // The missing-cost groupBy already excludes service/non-stock lines via product where.
    prisma.salesOrderLine = {
      groupBy: jest.fn(async ({ where }: any) => {
        if (where?.cogsAmount === null) {
          // missing-cost stock-only groupBy
          return [{ productId: 'p1', _sum: { lineTotal: 200, taxAmount: 0 }, _count: { _all: 1 } }];
        }
        return [
          {
            productId: 'p1',
            _sum: { quantity: 2, lineTotal: 200, taxAmount: 0, cogsAmount: null },
            _count: { _all: 1 },
          },
          {
            productId: 'p2',
            _sum: { quantity: 1, lineTotal: 50, taxAmount: 0, cogsAmount: 30 },
            _count: { _all: 1 },
          },
        ];
      }),
    };
    prisma.product = {
      findMany: jest.fn(async () => [
        { id: 'p1', productCode: 'P1', name: 'Steel' },
        { id: 'p2', productCode: 'P2', name: 'Pipe' },
      ]),
    };
    jest.spyOn(service as any, 'salesOrderWhere').mockResolvedValue({});
    jest.spyOn(service as any, 'costGaps').mockResolvedValue({ total: 0 });

    const result = await service.productSummary({}, { id: 'u1' } as any);

    expect(result.summary.revenue).toBe(250);
    expect(result.summary.cogs).toBe(30);
    expect(result.summary.grossProfit).toBe(220);
    expect(result.summary.linesMissingCost).toBe(1);
    expect(result.summary.revenueMissingCost).toBe(200);
    // products sorted by revenue desc; p1 carries the missing-cost flag
    expect(result.products.map((row) => row.productId)).toEqual(['p1', 'p2']);
    expect(result.products[0]).toEqual(
      expect.objectContaining({ productId: 'p1', revenue: 200, cogs: 0, hasMissingCost: true }),
    );
    expect(result.products[1]).toEqual(
      expect.objectContaining({ productId: 'p2', revenue: 50, cogs: 30, hasMissingCost: false }),
    );
  });
});

describe('ProfitService salesOrderWhere division filter', () => {
  it('scopes a divisionId filter by the order division OR its branch division', async () => {
    const { service } = makeService();
    const where = await (service as any).salesOrderWhere(
      { divisionId: 'div-1' },
      { id: 'u1' } as any,
    );
    expect(where.OR).toEqual([
      { divisionId: 'div-1' },
      { branch: { divisionId: 'div-1' } },
    ]);
  });
});
