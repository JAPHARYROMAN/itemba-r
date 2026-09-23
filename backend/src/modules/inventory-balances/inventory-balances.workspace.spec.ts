import { InventoryBalancesService } from './inventory-balances.service';

const user = { id: 'user', companyId: 'company', companyAccess: [] } as any;
function service(rows: any[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  return {
    findMany,
    service: new InventoryBalancesService({ inventoryBalance: { findMany } } as any, {} as any),
  };
}
const row = {
  id: 'balance',
  companyId: 'company',
  quantityOnHand: 40,
  quantityReserved: 5,
  averageCost: 100,
  totalValue: 4000,
  product: { reorderLevel: 10 },
  lastMovementAt: new Date('2026-09-17T00:00:00Z'),
};
describe('Inventory balance workspace contracts', () => {
  it('uses the same company, division, branch, product, category, family, search, cost and age filters for rows and totals', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-18T00:00:00Z'));
    const { service: subject, findMany } = service([row]);
    const query = {
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      productId: 'product',
      categoryId: 'category',
      productFamilyId: 'family',
      search: ' cement ',
      costStatus: 'MISSING_COST' as const,
      staleDays: 60,
    };
    await subject.findAll(query, user);
    await subject.summary(query, user);
    clock.mockRestore();
    expect(findMany.mock.calls[0][0]).toEqual(findMany.mock.calls[1][0]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      productId: 'product',
      product: {
        categoryId: 'category',
        productFamilyId: 'family',
        OR: expect.arrayContaining([
          { name: { contains: 'cement', mode: 'insensitive' } },
          { barcode: { contains: 'cement', mode: 'insensitive' } },
        ]),
      },
      AND: expect.arrayContaining([
        { averageCost: { lte: 0 } },
        { OR: [{ lastMovementAt: { lte: expect.any(Date) } }, { lastMovementAt: null }] },
      ]),
    });
  });
  it('keeps aggregate totals across all pages and applies stock classification before pagination', async () => {
    const { service: subject } = service(
      Array.from({ length: 30 }, (_, index) => ({
        ...row,
        id: String(index),
        quantityOnHand: index === 0 ? 0 : 40,
      })),
    );
    const page = await subject.findAll({ page: 2, limit: 25 }, user);
    expect(page.total).toBe(30);
    expect(page.data).toHaveLength(5);
    const totals = await subject.summary({}, user);
    expect(totals).toMatchObject({ totalSkus: 30, totalValue: 120000, oversold: 1 });
    const oversold = await subject.findAll({ stockStatus: 'OVERSOLD', page: 1, limit: 25 }, user);
    expect(oversold.total).toBe(1);
    expect(oversold.data[0]).toMatchObject({ quantityOnHand: 0, quantityAvailable: -5 });
  });
  it('preserves zero reorder levels, missing costs and never-moved age classification', async () => {
    const { service: subject } = service([
      {
        ...row,
        quantityOnHand: 1,
        quantityReserved: 0,
        averageCost: 0,
        totalValue: 0,
        lastMovementAt: null,
        product: { reorderLevel: 0, minimumStockLevel: 10 },
      },
    ]);
    const result = await subject.findAll({ staleDays: 30 }, user);
    expect(result.data[0]).toMatchObject({
      reorderLevel: 0,
      stockStatus: 'IN_STOCK',
      costStatus: 'MISSING_COST',
      daysSinceMovement: null,
      isStale: true,
      totalValue: 0,
    });
    expect(await subject.summary({ staleDays: 30 }, user)).toMatchObject({
      missingCost: 1,
      staleStock: 1,
      lowStock: 0,
    });
  });
});
