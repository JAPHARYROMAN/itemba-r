import { calculateReport, ReportCatalog } from './fuel-reporting.calculate';
import { ReportPayloadDto } from './fuel-reporting.dto';

const catalog: ReportCatalog = {
  tanks: [
    {
      id: 't1',
      tankName: 'Petrol tank',
      productId: 'petrol',
      productName: 'Petrol',
      capacityLitres: 30000,
    },
  ],
  nozzles: [
    {
      id: 'n1',
      nozzleCode: 'N1',
      pumpId: 'p1',
      pumpName: 'Pump 1',
      productId: 'petrol',
      productName: 'Petrol',
    },
  ],
};
function payload(): ReportPayloadDto {
  return {
    readings: [
      { nozzleId: 'n1', attendantName: 'Asha Juma', opening: 1000, closing: 1100, price: 3000 },
    ],
    dips: [{ tankId: 't1', opening: 1000, closing: 900 }],
    deliveries: [],
    expenses: [],
    creditSales: [],
    collections: { cash: 300000, mobile: 0, bank: 0, openingCash: 0, cashHandedOver: 300000 },
    receiptsConfirmed: true,
    expensesConfirmed: true,
    notes: '',
    discrepancyReason: '',
    documentIds: [],
  };
}
describe('Manual fuel report reconciliation', () => {
  it('reconciles dip volumes while a draft selling price is still blank', () => {
    const p = payload();
    p.readings[0].price = null;
    const result = calculateReport(p, catalog);
    expect(result.stock[0].difference).toBe(0);
    expect(result.litres).toBe(100);
    expect(result.discrepancies.some((d) => d.kind === 'SALES')).toBe(false);
    expect(result.issues.join(' ')).toMatch(/positive selling price/);
  });
  it('balances a complete shift and retains zero discrepancies', () => {
    const summary = calculateReport(payload(), catalog);
    expect(summary.issues).toEqual([]);
    expect(summary.sales).toBe(300000);
    expect(summary.litres).toBe(100);
    expect(summary.discrepancies).toHaveLength(3);
    expect(summary.discrepancies.every((d) => d.difference === 0)).toBe(true);
  });
  it('requires manual dips and attendant names, distinguishing blank from zero', () => {
    const p = payload();
    p.readings[0].attendantName = ' ';
    p.dips[0].closing = null;
    const s = calculateReport(p, catalog);
    expect(s.issues.join(' ')).toMatch(/attendant/);
    expect(s.issues.join(' ')).toMatch(/Manually enter/);
    expect(s.stock[0].actual).toBeNull();
    p.dips[0].opening = 100;
    p.dips[0].closing = 0;
    p.readings[0].attendantName = 'Asha';
    expect(calculateReport(p, catalog).issues).toEqual([]);
  });
  it('records shortages automatically and requires an explanation', () => {
    const p = payload();
    p.dips[0].closing = 897;
    p.collections.cashHandedOver = 299000;
    let s = calculateReport(p, catalog);
    expect(s.discrepancies.find((d) => d.kind === 'STOCK')?.difference).toBe(-3);
    expect(s.discrepancies.find((d) => d.kind === 'CASH')?.difference).toBe(-1000);
    expect(s.issues.join(' ')).toMatch(/Explain/);
    p.discrepancyReason = 'Recorded paper shortage awaiting manager review';
    s = calculateReport(p, catalog);
    expect(s.issues).toEqual([]);
    expect(s.flagged).toBe(2);
  });
  it('receives fuel by product, aggregating multiple tanks without delivery tank IDs', () => {
    const config = {
      ...catalog,
      tanks: [...catalog.tanks, { ...catalog.tanks[0], id: 't2', tankName: 'Petrol tank 2' }],
    };
    const p = payload();
    p.dips.push({ tankId: 't2', opening: 500, closing: 1000 });
    p.deliveries = [
      {
        productId: 'petrol',
        litres: 500,
        supplier: '',
        reference: '',
        totalCost: null,
        paidAmount: 0,
        paymentSource: 'OTHER',
      },
    ];
    const s = calculateReport(p, config);
    expect(s.stock[0]).toMatchObject({
      opening: 1500,
      received: 500,
      expected: 1900,
      actual: 1900,
      difference: 0,
    });
    expect(s.unpricedDeliveries).toBe(1);
    expect(s.issues).toEqual([]);
  });
  it('keeps purchases and other-account expenses separate from cash handover', () => {
    const p = payload();
    p.deliveries = [
      {
        productId: 'petrol',
        litres: 10,
        supplier: '',
        reference: '',
        totalCost: 25000,
        paidAmount: 5000,
        paymentSource: 'SHIFT_CASH',
      },
    ];
    p.dips[0].closing = 910;
    p.expenses = [
      { category: 'Maintenance', description: 'Repair', amount: 20000, paymentSource: 'OTHER' },
      { category: 'Meals', description: 'Staff meal', amount: 10000, paymentSource: 'SHIFT_CASH' },
    ];
    p.collections.cashHandedOver = 285000;
    const s = calculateReport(p, catalog);
    expect(s.expectedCash).toBe(285000);
    expect(s.expenses).toBe(30000);
    expect(s.purchases).toBe(25000);
    expect(s.sales).toBe(300000);
    expect(s.issues).toEqual([]);
  });
  it('attributes multiple price/handover intervals without double-counting credit sales', () => {
    const p = payload();
    p.readings = [
      { ...p.readings[0], closing: 1050 },
      { ...p.readings[0], attendantName: 'John', opening: 1050, closing: 1100, price: 3100 },
    ];
    p.creditSales = [{ customer: 'Customer', reference: '', amount: 5000 }];
    const s = calculateReport(p, catalog);
    expect(s.sales).toBe(305000);
    expect(s.litres).toBe(100);
    expect(s.issues).toEqual([]);
  });
  it('records stock and meter opening discontinuities against the previous shift', () => {
    const previous = payload();
    const next = payload();
    next.readings[0].opening = 1099;
    next.readings[0].closing = 1199;
    next.dips[0].opening = 899;
    next.dips[0].closing = 799;
    next.discrepancyReason = 'Paper opening corrected';
    const s = calculateReport(next, catalog, previous);
    expect(
      s.discrepancies
        .filter((d) => ['METER', 'OPENING_STOCK'].includes(d.kind))
        .map((d) => d.difference),
    ).toEqual([-1, -1]);
  });
  it('rejects unknown branch assets, duplicate dips and incomplete nozzle coverage', () => {
    const p = payload();
    p.dips.push(p.dips[0]);
    expect(() => calculateReport(p, catalog)).toThrow(/exactly one/);
    p.dips = [{ ...p.dips[0], tankId: 'foreign' }];
    expect(() => calculateReport(p, catalog)).toThrow(/outside/);
    p.dips = payload().dips;
    p.readings = [];
    expect(calculateReport(p, catalog).issues.join(' ')).toMatch(/Enter readings/);
  });
  it('uses decimal arithmetic to avoid phantom money and litre differences', () => {
    const p = payload();
    p.readings[0] = { ...p.readings[0], opening: 0.1, closing: 0.3, price: 3000 };
    p.dips[0] = { tankId: 't1', opening: 0.3, closing: 0.1 };
    p.collections.cash = 600;
    p.collections.cashHandedOver = 600;
    expect(calculateReport(p, catalog)).toMatchObject({
      litres: 0.2,
      sales: 600,
      flagged: 0,
      issues: [],
    });
  });
  it('blocks closure for negative meters, missing confirmations and partial collections', () => {
    const p = payload();
    p.readings[0].closing = 999;
    p.receiptsConfirmed = false;
    p.expensesConfirmed = false;
    p.collections.mobile = null;
    const issues = calculateReport(p, catalog).issues.join(' ');
    expect(issues).toMatch(/must not be below/);
    expect(issues).toMatch(/Confirm fuel/);
    expect(issues).toMatch(/Confirm expenses/);
    expect(issues).toMatch(/mobile money/);
  });
});
