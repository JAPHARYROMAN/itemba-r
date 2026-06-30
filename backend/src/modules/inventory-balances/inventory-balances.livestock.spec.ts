import { Prisma } from '@prisma/client';
import { InventoryBalancesService } from './inventory-balances.service';

/**
 * liveStock risk KPIs — findings #8, #21, #29.
 *
 * #8  criticalCount must count DISTINCT critical rows (no double-count of a row
 *     that is simultaneously OUT/LOW and negative); it must equal the length of
 *     the criticalItems list.
 * #21 the `negative` KPI must fire on truly-negative ON-HAND (ledger corruption),
 *     NOT on over-reservation; over-reservation is surfaced as `oversold`.
 * #29 money totals (totalValue, riskValue, criticalValue) must be summed as
 *     Prisma.Decimal so they reconcile exactly, not drift via JS float addition.
 */

function makeBalance(over: Partial<Record<string, any>> = {}) {
  return {
    id: over.id ?? 'b1',
    productId: over.productId ?? 'p1',
    branchId: over.branchId ?? 'br1',
    quantityOnHand: new Prisma.Decimal(over.quantityOnHand ?? 0),
    quantityReserved: new Prisma.Decimal(over.quantityReserved ?? 0),
    averageCost: new Prisma.Decimal(over.averageCost ?? 0),
    totalValue: new Prisma.Decimal(over.totalValue ?? 0),
    lastMovementAt: over.lastMovementAt ?? null,
    product: {
      id: over.productId ?? 'p1',
      productCode: 'PC',
      name: over.name ?? 'Product',
      sku: 'SKU',
      barcode: null,
      minimumStockLevel: over.minimumStockLevel ?? null,
      reorderLevel: over.reorderLevel ?? null,
    },
    branch: { id: over.branchId ?? 'br1', name: 'Branch 1', code: 'B1' },
  };
}

function makeService(balances: any[]) {
  const findMany = jest.fn().mockResolvedValue(balances);
  const prisma = { inventoryBalance: { findMany } } as any;
  const companyScope = {
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-A' }),
  } as any;
  const service = new InventoryBalancesService(prisma, companyScope);
  return { service, findMany };
}

const user = { id: 'u1', companyId: 'company-A', companyAccess: [] } as any;

describe('InventoryBalancesService.liveStock risk KPIs', () => {
  it('#8: criticalCount counts distinct rows and equals criticalItems length', async () => {
    // One LOW + over-reserved row (would have been counted twice by the old
    // out+low+negative sum) plus one healthy OK row.
    const { service } = makeService([
      // onHand 5, reserved 8, threshold 10 -> available -3 -> status LOW, oversold.
      makeBalance({
        id: 'b1',
        quantityOnHand: 5,
        quantityReserved: 8,
        reorderLevel: 10,
        totalValue: 50,
      }),
      // healthy
      makeBalance({
        id: 'b2',
        quantityOnHand: 100,
        quantityReserved: 0,
        reorderLevel: 10,
        totalValue: 999,
      }),
    ]);

    const res = await service.liveStock({}, user);

    expect(res.totals.low).toBe(1);
    expect(res.totals.out).toBe(0);
    // single critical row, counted once
    expect(res.risk.criticalCount).toBe(1);
    expect(res.risk.criticalItems).toHaveLength(1);
    expect(res.risk.criticalCount).toBe(res.risk.criticalItems.length);
  });

  it('#21: negative tracks truly-negative on-hand; oversold tracks over-reservation', async () => {
    const { service } = makeService([
      // SKU A: onHand 10, reserved 15 -> available -5. Legitimate oversell, NOT corruption.
      makeBalance({ id: 'a', quantityOnHand: 10, quantityReserved: 15, reorderLevel: 5 }),
      // SKU B: onHand -3, reserved 0 -> genuine ledger corruption.
      makeBalance({ id: 'b', quantityOnHand: -3, quantityReserved: 0, reorderLevel: 5 }),
    ]);

    const res = await service.liveStock({}, user);

    // Only SKU B has negative on-hand.
    expect(res.totals.negative).toBe(1);
    // Both rows are over-reserved/available<0.
    expect(res.totals.oversold).toBe(2);
  });

  it('#21: a single corrupt OUT+negative row is not double counted in criticalCount', async () => {
    const { service } = makeService([
      makeBalance({
        id: 'b',
        quantityOnHand: -4,
        quantityReserved: 0,
        reorderLevel: 5,
        totalValue: 0,
      }),
    ]);

    const res = await service.liveStock({}, user);

    expect(res.totals.out).toBe(1); // onHand <= 0
    expect(res.totals.negative).toBe(1); // onHand < 0
    // Still ONE critical row, not out+negative=2.
    expect(res.risk.criticalCount).toBe(1);
    expect(res.risk.criticalItems).toHaveLength(1);
  });

  it('#29: money totals are summed exactly as Decimal (no float drift)', async () => {
    // 0.10 + 0.20 + 0.30 = 0.60 exactly; naive float sum yields 0.6000000000000001.
    const { service } = makeService([
      makeBalance({ id: 'b1', quantityOnHand: 1, reorderLevel: 0, totalValue: 0.1 }),
      makeBalance({ id: 'b2', quantityOnHand: 1, reorderLevel: 0, totalValue: 0.2 }),
      makeBalance({ id: 'b3', quantityOnHand: 1, reorderLevel: 0, totalValue: 0.3 }),
    ]);

    const res = await service.liveStock({}, user);

    expect(res.totals.totalValue).toBe(0.6);
    // exact, not 0.6000000000000001
    expect(res.totals.totalValue.toString()).toBe('0.6');
  });

  it('#29: criticalValue equals the Decimal sum of risk values and matches totals.riskValue', async () => {
    const { service } = makeService([
      // LOW row contributes its totalValue to riskValue.
      makeBalance({
        id: 'b1',
        quantityOnHand: 1,
        quantityReserved: 0,
        reorderLevel: 10,
        totalValue: 0.1,
      }),
      makeBalance({
        id: 'b2',
        quantityOnHand: 1,
        quantityReserved: 0,
        reorderLevel: 10,
        totalValue: 0.2,
      }),
    ]);

    const res = await service.liveStock({}, user);

    expect(res.risk.criticalValue).toBe(res.totals.riskValue);
    expect(res.risk.criticalValue).toBe(0.3);
  });

  it('does not leak internal Decimal/classification fields into the response items', async () => {
    const { service } = makeService([
      makeBalance({ id: 'b1', quantityOnHand: 0, reorderLevel: 10, totalValue: 5 }),
    ]);

    const res = await service.liveStock({}, user);
    const item = res.risk.criticalItems[0] as any;

    expect(item).not.toHaveProperty('totalValueDecimal');
    expect(item).not.toHaveProperty('riskValueDecimal');
    expect(item).not.toHaveProperty('isCritical');
    expect(item).not.toHaveProperty('negativeOnHand');
    expect(item).not.toHaveProperty('oversold');
    // public money fields stay plain numbers
    expect(typeof item.totalValue).toBe('number');
    expect(typeof res.locations[0].totalValue).toBe('number');
  });
});
