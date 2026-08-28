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
  return {
    service: new ProfitService(prisma, companyScope, auditLogs),
    prisma,
    auditLogs,
    companyScope,
  };
}

describe('ProfitService no-loss rules', () => {
  it('audits a successful manual line validation with the executing user and company', async () => {
    const { service, auditLogs } = makeService({
      balance: { productId: 'product-1', quantityOnHand: 5, averageCost: 80 },
    });
    const user = { id: 'user-1', companyId: 'company-1' } as any;

    await service.validateSaleLinesForUser(
      {
        companyId: 'company-1',
        branchId: 'branch-1',
        lines: [{ productId: 'product-1', quantity: 1, unitPrice: 100 }],
      },
      user,
    );

    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROFIT_VALIDATION_RUN',
        entityType: 'ProfitValidation',
        companyId: 'company-1',
        userId: 'user-1',
        newValue: { lineCount: 1, hasBlockingErrors: false },
      }),
    );
  });

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

describe('ProfitService cost-gap company scope', () => {
  it('applies the company predicate to both sources and returns only the scoped product gap', async () => {
    const { service, prisma, companyScope } = makeService();
    const products = [
      {
        id: 'gap-product-a',
        productCode: 'GAP-A',
        name: 'Company A missing cost',
        companyId: 'company-1',
        divisionId: null,
        defaultPurchasePrice: 0,
        productFamily: null,
        company: { id: 'company-1', name: 'Company A', code: 'A' },
        division: null,
      },
      {
        id: 'gap-product-b',
        productCode: 'GAP-B',
        name: 'Company B missing cost',
        companyId: 'company-2',
        divisionId: null,
        defaultPurchasePrice: 0,
        productFamily: null,
        company: { id: 'company-2', name: 'Company B', code: 'B' },
        division: null,
      },
    ];
    prisma.product.findMany.mockImplementation(async ({ where }: any) =>
      products.filter((product) => product.companyId === where.companyId),
    );
    prisma.inventoryBalance.findMany.mockResolvedValue([]);

    const result = await service.costGaps({ companyId: 'company-1' }, { id: 'user-1' } as any);

    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
    expect(prisma.inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          product: expect.objectContaining({ companyId: 'company-1' }),
        }),
      }),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        type: 'PRODUCT_MASTER_COST',
        productId: 'gap-product-a',
        company: expect.objectContaining({ id: 'company-1' }),
      }),
    ]);
    expect(result.rows.some((row) => row.productId === 'gap-product-b')).toBe(false);
    expect(result.total).toBe(1);
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

describe('ProfitService customerSummary db aggregation', () => {
  it('aggregates net revenue + WAC cogs per customer, sorts by profit desc, flags missing cost', async () => {
    const { service, prisma } = makeService();
    // Orders: o1 -> cust A (rev 300, cogs 100), o2 -> cust A (rev 100, cogs 40),
    //         o3 -> cust B (rev 500, cogs 450, one stock line missing cost),
    //         o4 -> null customer / walk-in (rev 80, cogs 30).
    prisma.salesOrderLine = {
      groupBy: jest.fn(async ({ where }: any) => {
        if (where?.cogsAmount === null) {
          // missing-cost stock-only groupBy: only o3 has an uncosted stock line (rev 120)
          return [
            { salesOrderId: 'o3', _sum: { lineTotal: 120, taxAmount: 0 }, _count: { _all: 1 } },
          ];
        }
        return [
          {
            salesOrderId: 'o1',
            _sum: { quantity: 3, lineTotal: 300, taxAmount: 0, cogsAmount: 100 },
            _count: { _all: 2 },
          },
          {
            salesOrderId: 'o2',
            _sum: { quantity: 1, lineTotal: 100, taxAmount: 0, cogsAmount: 40 },
            _count: { _all: 1 },
          },
          {
            salesOrderId: 'o3',
            _sum: { quantity: 5, lineTotal: 500, taxAmount: 0, cogsAmount: 450 },
            _count: { _all: 3 },
          },
          {
            salesOrderId: 'o4',
            _sum: { quantity: 1, lineTotal: 80, taxAmount: 0, cogsAmount: 30 },
            _count: { _all: 1 },
          },
        ];
      }),
    };
    prisma.salesOrder = {
      findMany: jest.fn(async () => [
        { id: 'o1', customerId: 'A', customerName: 'Acme' },
        { id: 'o2', customerId: 'A', customerName: 'Acme' },
        { id: 'o3', customerId: 'B', customerName: 'Beta' },
        { id: 'o4', customerId: null, customerName: null },
      ]),
    };
    jest.spyOn(service as any, 'salesOrderWhere').mockResolvedValue({});

    const result = await service.customerSummary({}, { id: 'u1' } as any);

    // Totals: revenue 980, cogs 620, grossProfit 360
    expect(result.summary.revenue).toBe(980);
    expect(result.summary.cogs).toBe(620);
    expect(result.summary.grossProfit).toBe(360);
    expect(result.summary.customerCount).toBe(3);
    expect(result.summary.linesMissingCost).toBe(1);
    expect(result.summary.revenueMissingCost).toBe(120);

    // Sorted by profit desc: A (profit 260) > walk-in (profit 50) > B (profit 50)
    // A: rev 400 cogs 140 profit 260; B: rev 500 cogs 450 profit 50; walk-in: rev 80 cogs 30 profit 50
    const byId = new Map(result.customers.map((c) => [c.customerId ?? '__null__', c]));
    expect(byId.get('A')).toEqual(
      expect.objectContaining({
        customerName: 'Acme',
        revenue: 400,
        cogs: 140,
        grossProfit: 260,
        orderCount: 2,
        lineCount: 3,
        hasMissingCost: false,
      }),
    );
    expect(byId.get('B')).toEqual(
      expect.objectContaining({
        customerName: 'Beta',
        revenue: 500,
        cogs: 450,
        grossProfit: 50,
        hasMissingCost: true,
        linesMissingCost: 1,
        revenueMissingCost: 120,
      }),
    );
    const walkIn = byId.get('__null__');
    expect(walkIn).toEqual(
      expect.objectContaining({
        customerId: null,
        customerName: 'Unassigned / Walk-in',
        revenue: 80,
        grossProfit: 50,
      }),
    );
    // Profit-desc ordering: A first
    expect(result.customers[0].customerId).toBe('A');
  });
});

describe('ProfitService fixCostGap (ITMB-AUDIT-28)', () => {
  function makeFixService({ balance = null }: { balance?: any } = {}) {
    const productUpdate = jest.fn().mockResolvedValue(undefined);
    const balanceUpdate = jest.fn().mockResolvedValue(undefined);
    const balanceFindFirst = jest.fn().mockResolvedValue(balance);
    const tx = {
      product: { update: productUpdate },
      inventoryBalance: { findFirst: balanceFindFirst, update: balanceUpdate },
    };
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-1',
          companyId: 'company-1',
          divisionId: null,
          productCode: 'P1',
          name: 'Steel Bar',
          defaultPurchasePrice: null,
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new ProfitService(prisma, companyScope, auditLogs);
    return { service, prisma, auditLogs, productUpdate, balanceUpdate, balanceFindFirst };
  }

  const user = { id: 'u1' } as any;

  it('writes both money updates and the audit log inside one transaction', async () => {
    const { service, prisma, auditLogs, productUpdate, balanceUpdate } = makeFixService({
      balance: { id: 'bal-1', quantityOnHand: 4 },
    });

    const result = await service.fixCostGap(
      'product-1',
      { defaultPurchasePrice: 120, branchId: 'b9', averageCost: 90 },
      user,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(productUpdate).toHaveBeenCalledTimes(1);
    expect(balanceUpdate).toHaveBeenCalledTimes(1);
    // totalValue = onHand(4) * averageCost(90) = 360, written as a Decimal
    const balanceData = balanceUpdate.mock.calls[0][0].data;
    expect(Number(balanceData.totalValue)).toBe(360);
    expect(Number(balanceData.averageCost)).toBe(90);
    expect(result.changes).toEqual(
      expect.objectContaining({
        defaultPurchasePrice: 120,
        averageCost: 90,
        totalValue: 360,
      }),
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFIT_COST_FIX' }),
    );
  });

  it('rolls back the price write when the branch balance is missing (no partial commit, no audit)', async () => {
    const { service, prisma, auditLogs, productUpdate } = makeFixService({ balance: null });

    await expect(
      service.fixCostGap(
        'product-1',
        { defaultPurchasePrice: 120, branchId: 'b9', averageCost: 90 },
        user,
      ),
    ).rejects.toThrow('No branch inventory balance exists for this product');

    // The throw happens inside the $transaction callback, so the price update is
    // enrolled in the same aborted transaction and the audit log never runs.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(productUpdate).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('rejects a non-positive default purchase cost before opening any transaction', async () => {
    const { service, prisma } = makeFixService();

    await expect(
      service.fixCostGap('product-1', { defaultPurchasePrice: 0 }, user),
    ).rejects.toThrow('Default purchase cost must be greater than zero');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires at least one cost field to update', async () => {
    const { service, prisma } = makeFixService();

    await expect(service.fixCostGap('product-1', {}, user)).rejects.toThrow(
      'Provide a default purchase cost or branch average cost to update',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ProfitService salesOrderWhere division filter', () => {
  it('scopes a divisionId filter by the order division OR its branch division', async () => {
    const { service } = makeService();
    const where = await (service as any).salesOrderWhere({ divisionId: 'div-1' }, {
      id: 'u1',
    } as any);
    expect(where.OR).toEqual([{ divisionId: 'div-1' }, { branch: { divisionId: 'div-1' } }]);
  });
});
