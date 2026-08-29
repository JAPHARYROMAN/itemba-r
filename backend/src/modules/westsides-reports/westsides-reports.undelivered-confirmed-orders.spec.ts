import { WestsidesReportsService } from './westsides-reports.service';

/**
 * Undelivered confirmed CREDIT orders — the revenue cutoff exposure report.
 *
 * Coverage math frozen here (it is a HEURISTIC, because delivery_note_lines
 * carry no salesOrderLineId — see DeliveryNotesService.create):
 *  - delivered quantity is matched to ordered quantity PER PRODUCT within the
 *    order, and coverage of one product is CAPPED at its ordered quantity, so
 *    over-delivery of product A can never mask a shortfall of product B;
 *  - only DELIVERED / PARTIALLY_DELIVERED notes count as coverage; DRAFT /
 *    DISPATCHED notes are in-transit context;
 *  - a fully covered order is excluded; an order with no delivery note at all
 *    is flagged with its full net revenue + snapshotted COGS as exposure;
 *  - the exposure of a partial order is the undelivered fraction of each
 *    product's net (lineTotal - taxAmount) and snapshotted cogsAmount;
 *  - a STOCK line whose cogsAmount was never snapshotted (legacy orders
 *    confirmed before COGS snapshotting) still contributes zero to the COGS
 *    exposure but the row is flagged `cogsMissing` and the totals disclose
 *    `ordersMissingCost` — the profit.service missing-cost standard. A
 *    service/non-stock line legitimately has no COGS and is never flagged.
 */
describe('WestsidesReportsService.undeliveredConfirmedOrders', () => {
  const asOfBase = new Date('2031-02-15');
  const expectedCutoff = new Date(
    asOfBase.getFullYear(),
    asOfBase.getMonth(),
    asOfBase.getDate() + 1,
  );

  // A: confirmed 45 days before the cutoff, never delivered, no note at all.
  const orderA = {
    id: 'so-a',
    salesOrderNumber: 'SO-A',
    orderDate: new Date('2031-01-01T10:00:00.000Z'),
    branchId: 'b1',
    status: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    customerId: 'c1',
    customerName: null,
    customer: { name: 'Mteja Mmoja', customerCode: 'CUST-1' },
    totalAmount: 5_000_000,
    taxAmount: 762_700,
    outstandingAmount: 5_000_000,
    lines: [
      {
        productId: 'p1',
        quantity: 100,
        lineTotal: 5_000_000,
        taxAmount: 762_700,
        cogsAmount: 3_800_000,
      },
    ],
    deliveryNotes: [],
  };

  // B: partially delivered, with an over-delivered second product and a
  // dispatched (in-transit) note that must NOT count as coverage.
  const orderB = {
    id: 'so-b',
    salesOrderNumber: 'SO-B',
    orderDate: new Date('2031-02-10T09:00:00.000Z'),
    branchId: 'b1',
    status: 'PAID',
    paymentStatus: 'PAID',
    customerId: null,
    customerName: 'Duka la Kona',
    customer: null,
    totalAmount: 1180,
    taxAmount: 180,
    outstandingAmount: 0,
    lines: [
      { productId: 'p1', quantity: 100, lineTotal: 1000, taxAmount: 150, cogsAmount: 600 },
      { productId: 'p2', quantity: 10, lineTotal: 180, taxAmount: 30, cogsAmount: 100 },
    ],
    deliveryNotes: [
      {
        id: 'dn-b1',
        deliveryNoteNumber: 'DN-B1',
        status: 'DELIVERED',
        deliveryDate: new Date('2031-02-12T00:00:00.000Z'),
        lines: [
          { productId: 'p1', deliveredQuantity: 60 },
          // Over-delivered: 25 delivered against 10 ordered. Coverage is
          // capped at 10; the excess must not offset p1's shortfall.
          { productId: 'p2', deliveredQuantity: 25 },
        ],
      },
      {
        id: 'dn-b2',
        deliveryNoteNumber: 'DN-B2',
        status: 'DISPATCHED',
        deliveryDate: new Date('2031-02-14T00:00:00.000Z'),
        lines: [{ productId: 'p1', deliveredQuantity: 20 }],
      },
    ],
  };

  // C: fully covered by a DELIVERED note — must be excluded.
  const orderC = {
    id: 'so-c',
    salesOrderNumber: 'SO-C',
    orderDate: new Date('2031-02-01T09:00:00.000Z'),
    branchId: 'b1',
    status: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    customerId: null,
    customerName: 'Kamili',
    customer: null,
    totalAmount: 590,
    taxAmount: 90,
    outstandingAmount: 590,
    lines: [{ productId: 'p1', quantity: 5, lineTotal: 590, taxAmount: 90, cogsAmount: 350 }],
    deliveryNotes: [
      {
        id: 'dn-c1',
        deliveryNoteNumber: 'DN-C1',
        status: 'DELIVERED',
        deliveryDate: new Date('2031-02-02T00:00:00.000Z'),
        lines: [{ productId: 'p1', deliveredQuantity: 5 }],
      },
    ],
  };

  // D: a note exists but is only DISPATCHED — zero coverage, all in transit.
  const orderD = {
    id: 'so-d',
    salesOrderNumber: 'SO-D',
    orderDate: new Date('2031-02-11T09:00:00.000Z'),
    branchId: 'b1',
    status: 'PARTIALLY_PAID',
    paymentStatus: 'PARTIALLY_PAID',
    customerId: null,
    customerName: 'Njiani',
    customer: null,
    totalAmount: 500,
    taxAmount: 0,
    outstandingAmount: 250,
    lines: [{ productId: 'p1', quantity: 50, lineTotal: 500, taxAmount: 0, cogsAmount: 300 }],
    deliveryNotes: [
      {
        id: 'dn-d1',
        deliveryNoteNumber: 'DN-D1',
        status: 'DISPATCHED',
        deliveryDate: new Date('2031-02-13T00:00:00.000Z'),
        lines: [{ productId: 'p1', deliveredQuantity: 50 }],
      },
    ],
  };

  // E: a legacy order confirmed before COGS snapshotting — its STOCK line has
  // cogsAmount null, and a service line (legitimately costless) rides along.
  const orderE = {
    id: 'so-e',
    salesOrderNumber: 'SO-E',
    orderDate: new Date('2031-02-12T09:00:00.000Z'),
    branchId: 'b1',
    status: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    customerId: null,
    customerName: 'Zamani',
    customer: null,
    totalAmount: 900,
    taxAmount: 0,
    outstandingAmount: 900,
    lines: [
      {
        productId: 'p-stock',
        quantity: 10,
        lineTotal: 700,
        taxAmount: 0,
        cogsAmount: null,
        product: { trackInventory: true, productType: 'FINISHED_GOODS' },
      },
      {
        productId: 'p-service',
        quantity: 1,
        lineTotal: 200,
        taxAmount: 0,
        cogsAmount: null,
        product: { trackInventory: true, productType: 'SERVICE' },
      },
    ],
    deliveryNotes: [],
  };

  function buildService(orders: unknown[]) {
    const prisma = {
      salesOrder: { findMany: jest.fn().mockResolvedValue(orders) },
    } as any;
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    } as any;
    const auditLogs = { log: jest.fn() } as any;
    return { prisma, service: new WestsidesReportsService(prisma, companyScope, auditLogs) };
  }

  const user = { id: 'user-1' } as any;
  const query = { companyId: 'company-1', branchId: 'b1', dateTo: '2031-02-15' };

  it('scopes the scan to confirmed CREDIT orders and cutoff-dated, non-cancelled delivery notes', async () => {
    const { prisma, service } = buildService([]);
    await service.undeliveredConfirmedOrders(query as any, user);

    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          branchId: 'b1',
          deletedAt: null,
          paymentMethod: 'CREDIT',
          status: { in: ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'] },
          orderDate: { lt: expectedCutoff },
        }),
        orderBy: { orderDate: 'asc' },
        take: 1001,
        select: expect.objectContaining({
          deliveryNotes: expect.objectContaining({
            where: {
              deletedAt: null,
              status: { not: 'CANCELLED' },
              deliveryDate: { lt: expectedCutoff },
            },
          }),
        }),
      }),
    );
  });

  it('flags undelivered and partial orders, excludes fully covered ones, and caps per-product coverage', async () => {
    const { service } = buildService([orderA, orderB, orderC, orderD]);
    const result: any = await service.undeliveredConfirmedOrders(query as any, user);

    // C is fully covered and gone; rows sort by exposure, largest first.
    expect(result.rows.map((row: any) => row.salesOrderId)).toEqual(['so-a', 'so-d', 'so-b']);
    expect(result.coverageBasis).toBe('PER_PRODUCT_HEURISTIC');
    expect(result.truncated).toBe(false);
    expect(result.scanTruncated).toBe(false);

    const a = result.rows[0];
    expect(a.deliveryState).toBe('NO_DELIVERY_NOTE');
    expect(a.coverageRatio).toBe(0);
    expect(a.orderedQuantity).toBe(100);
    expect(a.undeliveredQuantity).toBe(100);
    // Full-order exposure: net revenue ex-VAT and the SNAPSHOTTED COGS.
    expect(a.netRevenueExposure).toBeCloseTo(4_237_300, 6);
    expect(a.cogsExposure).toBeCloseTo(3_800_000, 6);
    expect(a.grossProfitExposure).toBeCloseTo(437_300, 6);
    // 45 days old with no note at all — stale, therefore CRITICAL.
    expect(a.daysSinceOrder).toBeGreaterThan(30);
    expect(a.readinessStatus).toBe('CRITICAL');
    expect(a.customerName).toBe('Mteja Mmoja');

    const d = result.rows[1];
    expect(d.deliveryState).toBe('NOT_DELIVERED');
    expect(d.deliveredQuantity).toBe(0);
    expect(d.inTransitQuantity).toBe(50);
    expect(d.netRevenueExposure).toBeCloseTo(500, 6);
    expect(d.cogsExposure).toBeCloseTo(300, 6);
    expect(d.readinessStatus).toBe('WARNING');

    const b = result.rows[2];
    expect(b.deliveryState).toBe('PARTIALLY_DELIVERED');
    // p1: 60 of 100 delivered. p2: capped at the 10 ordered despite 25
    // delivered — the over-delivery cannot offset p1's shortfall.
    expect(b.orderedQuantity).toBe(110);
    expect(b.deliveredQuantity).toBe(70);
    expect(b.undeliveredQuantity).toBe(40);
    expect(b.coverageRatio).toBeCloseTo(70 / 110, 10);
    // The DISPATCHED 20 units are in transit, not coverage.
    expect(b.inTransitQuantity).toBe(20);
    // Exposure = the undelivered fraction of p1 only: 0.4 x (1000-150) net,
    // 0.4 x 600 snapshotted COGS.
    expect(b.netRevenueExposure).toBeCloseTo(340, 6);
    expect(b.cogsExposure).toBeCloseTo(240, 6);
    // Full-order context figures stay whole-order.
    expect(b.netRevenue).toBe(1000);
    expect(b.cogsAmount).toBe(700);
    expect(b.deliveryNotes).toHaveLength(2);
    expect(b.readinessStatus).toBe('WARNING');
  });

  it('totals every flagged order, not just the returned rows', async () => {
    const { service } = buildService([orderA, orderB, orderC, orderD]);
    const result: any = await service.undeliveredConfirmedOrders(query as any, user);

    expect(result.totals.orderCount).toBe(3);
    expect(result.totals.orderedQuantity).toBe(260);
    expect(result.totals.deliveredQuantity).toBe(70);
    expect(result.totals.undeliveredQuantity).toBe(190);
    expect(result.totals.netRevenueExposure).toBeCloseTo(4_237_300 + 500 + 340, 6);
    expect(result.totals.cogsExposure).toBeCloseTo(3_800_000 + 300 + 240, 6);
    expect(result.totals.grossProfitExposure).toBeCloseTo(437_300 + 200 + 100, 6);
    // Every line here carries its snapshotted COGS, so no order is flagged.
    expect(result.rows.every((row: any) => row.cogsMissing === false)).toBe(true);
    expect(result.totals.ordersMissingCost).toBe(0);
    expect(result.scope).toMatchObject({ companyId: 'company-1', branchId: 'b1' });
    expect(result.rowCap).toBe(200);
    expect(result.scanCap).toBe(1000);
  });

  it('flags legacy NULL-COGS stock lines instead of silently reporting zero cost', async () => {
    const { service } = buildService([orderE]);
    const result: any = await service.undeliveredConfirmedOrders(query as any, user);

    expect(result.rows).toHaveLength(1);
    const e = result.rows[0];
    // The exposure figures keep the profit-guard snapshot semantics: a NULL
    // snapshot contributes zero cost, so the full net revenue shows as
    // gross-profit exposure — but the row now SAYS the cost is missing.
    expect(e.netRevenueExposure).toBeCloseTo(900, 6);
    expect(e.cogsExposure).toBeCloseTo(0, 6);
    expect(e.grossProfitExposure).toBeCloseTo(900, 6);
    expect(e.cogsMissing).toBe(true);
    // The readiness note carries the overstatement warning in plain words.
    expect(e._reportMeta.readiness.message).toContain('no snapshotted cost');
    expect(result.totals.ordersMissingCost).toBe(1);
  });

  it('never flags service or non-stock lines for their legitimately absent COGS', async () => {
    const serviceOnly = {
      ...orderE,
      id: 'so-f',
      salesOrderNumber: 'SO-F',
      lines: [orderE.lines[1]],
      totalAmount: 200,
      outstandingAmount: 200,
    };
    const { service } = buildService([serviceOnly]);
    const result: any = await service.undeliveredConfirmedOrders(query as any, user);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cogsMissing).toBe(false);
    expect(result.totals.ordersMissingCost).toBe(0);
  });
});
