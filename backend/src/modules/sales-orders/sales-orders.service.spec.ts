import { SalesOrdersService } from './sales-orders.service';
import { Prisma } from '@prisma/client';

function persistedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'so-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    customerId: null,
    customerName: 'Walk-in Customer',
    salesOrderNumber: 'SO-2026-000001',
    orderDate: new Date('2026-05-30T00:00:00.000Z'),
    dueDate: null,
    currency: 'TZS',
    salesType: 'CASH_SALE',
    paymentMethod: 'CASH',
    cashAccountId: 'cash-account-1',
    subtotal: 200,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 200,
    paidAmount: 200,
    outstandingAmount: 0,
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    receivableId: null,
    receivable: null,
    lines: [
      {
        id: 'line-1',
        productId: 'product-1',
        description: 'Item',
        quantity: 2,
        unitId: 'unit-1',
        unitPrice: 100,
        discountAmount: 0,
        taxAmount: 0,
        lineTotal: 200,
        batchId: null,
      },
    ],
    ...overrides,
  };
}

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    salesOrder: {
      create: jest.fn(async ({ data }: any) => ({ id: 'so-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'so-1', companyId: 'company-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => persistedOrder()),
      findUnique: jest.fn(async () => null),
      groupBy: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({
        _sum: { totalAmount: null, outstandingAmount: null, paidAmount: null },
      })),
      count: jest.fn(async () => 0),
    },
    salesOrderLine: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    journalEntry: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ data }: any) => ({ id: 'je-1', ...data })),
    },
    receivable: {
      create: jest.fn(async ({ data }: any) => ({ id: 'receivable-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({
        id: 'receivable-1',
        companyId: 'company-1',
        customerId: 'customer-1',
        ...data,
      })),
      aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: 0 } })),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    division: {
      findFirst: jest.fn(async () => ({ companyId: 'company-1' })),
    },
    branch: {
      findFirst: jest.fn(async () => ({
        divisionId: 'division-1',
        division: { companyId: 'company-1' },
      })),
    },
    customer: {
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({ id: 'customer-auto-1', ...data })),
      updateMany: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
    product: {
      findMany: jest.fn(async () => [{ id: 'product-1', companyId: 'company-1' }]),
      findUnique: jest.fn(async () => ({ id: 'product-1', trackInventory: false })),
    },
    unitOfMeasure: {
      findMany: jest.fn(async () => [{ id: 'unit-1', companyId: 'company-1' }]),
    },
    cashAccount: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const inventoryMovements = { createMovement: jest.fn().mockResolvedValue(undefined) } as any;
  const taxAutoApply = { applyForSalesOrder: jest.fn().mockResolvedValue({}) } as any;
  const codes = {
    next: jest.fn(async ({ entityType }: any) =>
      entityType === 'Customer' ? 'CUST-2026-000001' : 'SO-2026-000001',
    ),
  } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
  } as any;
  const postingEngine = { postLines: jest.fn().mockResolvedValue({ id: 'je-1' }) } as any;
  const accountResolver = { resolveMany: jest.fn() } as any;
  const profit = {
    assertSaleLinesProfitable: jest.fn(async ({ lines }: any) =>
      lines.map((line: any) => ({
        productId: line.productId,
        productName: 'Item',
        trackInventory: false,
        unitCostAtSale: null,
        cogsAmount: 0,
        grossProfitAmount: Number(line.quantity) * Number(line.unitPrice),
        grossMarginPct: 100,
        profitCostSource: null,
        netSalesAmount: Number(line.quantity) * Number(line.unitPrice),
        netUnitPrice: Number(line.unitPrice),
      })),
    ),
    isStockProduct: jest.fn((product: any) => product?.trackInventory !== false),
  } as any;
  const service = new SalesOrdersService(
    prisma,
    auditLogs,
    inventoryMovements,
    taxAutoApply,
    codes,
    companyScope,
    postingEngine,
    accountResolver,
    profit,
  );

  return { service, prisma };
}

const user = { id: 'user-1', permissions: ['sales.create'] } as any;
const posOnlyUser = { id: 'pos-user-1', permissions: ['pos.create'] } as any;

function createDto(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    customerName: 'Walk-in Customer',
    salesType: 'CASH_SALE',
    orderDate: '2026-05-30',
    currency: 'TZS',
    paymentMethod: 'CREDIT',
    lines: [
      {
        productId: 'product-1',
        description: 'Item',
        quantity: 2,
        unitId: 'unit-1',
        unitPrice: 100,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
    ...overrides,
  } as any;
}

describe('SalesOrdersService payment normalization', () => {
  it('does not allow a CASH_SALE to be created as a credit receivable', async () => {
    const { service } = makeService();

    await expect(service.create(createDto(), user)).rejects.toThrow(
      'Receipt account is required for non-credit sales',
    );
  });

  it('normalizes CREDIT_SALE to credit and clears receipt account fields', async () => {
    const { service, prisma } = makeService();

    await service.create(
      createDto({
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-account-1',
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentMethod: 'CREDIT',
          cashAccountId: null,
        }),
      }),
    );
  });
});

describe('SalesOrdersService per-unit discounts', () => {
  it('expands sales order line discounts per quantity before storing totals', async () => {
    const { service, prisma } = makeService();
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);

    await service.create(
      createDto({
        salesType: 'CASH_SALE',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-account-1',
        lines: [
          {
            productId: 'product-1',
            description: 'Item',
            quantity: 2,
            unitId: 'unit-1',
            unitPrice: 100,
            discountAmount: 10,
            taxAmount: 0,
          },
        ],
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 200,
          discountAmount: 20,
          totalAmount: 180,
        }),
      }),
    );
    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            quantity: 2,
            unitPrice: 100,
            discountAmount: 20,
            lineTotal: 180,
          }),
        ],
      }),
    );
  });
});

describe('SalesOrdersService walk-in customer mastering', () => {
  it('creates and links a customer master for a named walk-in sales order customer', async () => {
    const { service, prisma } = makeService();
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);

    await service.create(
      createDto({
        customerName: '  Alinani   Sinkala  ',
        salesType: 'CASH_SALE',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-account-1',
      }),
      user,
    );

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerCode: 'CUST-2026-000001',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          customerType: 'WALK_IN',
          name: 'Alinani Sinkala',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-auto-1',
          customerName: 'Alinani Sinkala',
        }),
      }),
    );
  });
});

describe('SalesOrdersService receivable customer names', () => {
  it('uses the linked customer master name when confirming a credit sale receivable', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, 'postSalesOrderLedger').mockResolvedValue({ id: 'journal-entry-1' });
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        status: 'DRAFT',
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CREDIT',
        cashAccountId: null,
        customerId: 'customer-1',
        customerName: 'Walk-in Customer',
        customer: { id: 'customer-1', name: 'Aaron Town' },
        totalAmount: 418000,
        outstandingAmount: 418000,
      }),
    );
    prisma.customer.findFirst.mockResolvedValue({
      name: 'Aaron Town',
      status: 'ACTIVE',
      creditLimit: 0,
      currentBalance: 0,
    });

    await service.confirm('so-1', user);

    expect(prisma.receivable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-1',
          customerName: 'Aaron Town',
        }),
      }),
    );
  });

  it('rejects a concurrent confirm whose atomic DRAFT->CONFIRMED claim loses the race', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(persistedOrder({ status: 'DRAFT' }));
    // A competing confirm already flipped the row to CONFIRMED, so our guarded
    // claim matches 0 rows and must abort before any posting side effects.
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.confirm('so-1', user)).rejects.toThrow('no longer DRAFT');

    expect(prisma.receivable.create).not.toHaveBeenCalled();
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
  });
});

describe('SalesOrdersService quick-sale CREDIT handling', () => {
  it('mobilePosQuickSale preserves CREDIT (no coercion to CASH)', async () => {
    const { service, prisma } = makeService();
    // Stub confirm() so we isolate the create payload (CREDIT confirm posts a
    // receivable via a heavier path covered elsewhere).
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);

    await service.mobilePosQuickSale(
      createDto({ salesType: 'CREDIT_SALE', paymentMethod: 'CREDIT', customerName: 'Walk-in' }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentMethod: 'CREDIT', cashAccountId: null }),
      }),
    );
  });

  it('quickSale still coerces CREDIT to CASH for the generic counter-sale flow', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });

    await service.quickSale(
      createDto({
        salesType: 'CASH_SALE',
        paymentMethod: 'CREDIT',
        cashAccountId: 'cash-account-1',
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentMethod: 'CASH', cashAccountId: 'cash-account-1' }),
      }),
    );
  });

  it('requires sales.create before Mobile POS can create a credit sale', async () => {
    const { service } = makeService();

    await expect(
      service.mobilePosQuickSale(
        createDto({ salesType: 'CREDIT_SALE', paymentMethod: 'CREDIT', customerName: 'Walk-in' }),
        posOnlyUser,
      ),
    ).rejects.toThrow('Credit sales require sales.create permission');
  });
});

describe('SalesOrdersService quick-sale idempotency', () => {
  function cashSaleDto(overrides: Record<string, unknown> = {}) {
    return createDto({
      salesType: 'CASH_SALE',
      paymentMethod: 'CASH',
      cashAccountId: 'cash-account-1',
      idempotencyKey: 'idem-1',
      ...overrides,
    });
  }

  it('replays a matching confirmed order and skips create/confirm', async () => {
    const { service, prisma } = makeService();
    const confirmSpy = jest.spyOn(service, 'confirm');

    const result = await service.mobilePosQuickSale(cashSaleDto(), user);

    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
    const replayCall = prisma.salesOrder.findFirst.mock.calls.find(
      (call: any[]) => call[0]?.where?.idempotencyKey === 'idem-1',
    );
    expect(replayCall).toBeDefined();
    expect(replayCall[0].where).toEqual(
      expect.objectContaining({ companyId: 'company-1', idempotencyKey: 'idem-1' }),
    );
    // #32: the replay lookup must NOT filter deletedAt (the unique index ignores it).
    expect(replayCall[0].where).not.toHaveProperty('deletedAt');
  });

  it('does not replay a matching draft order as a successful receipt', async () => {
    const { service, prisma } = makeService();
    const confirmSpy = jest.spyOn(service, 'confirm');
    prisma.salesOrder.findFirst.mockResolvedValue(persistedOrder({ status: 'DRAFT' }));

    await expect(service.mobilePosQuickSale(cashSaleDto(), user)).rejects.toThrow(
      'The previous checkout attempt was not confirmed',
    );
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('rejects an idempotency retry when the payload no longer matches', async () => {
    const { service, prisma } = makeService();
    const confirmSpy = jest.spyOn(service, 'confirm');
    prisma.salesOrder.findFirst.mockResolvedValue(persistedOrder({ customerName: 'Walk-in A' }));

    await expect(
      service.mobilePosQuickSale(cashSaleDto({ customerName: 'Walk-in B' }), user),
    ).rejects.toThrow('checkout retry key is already attached to a different sales order');
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('queries the idempotency key WITHOUT a deletedAt filter so soft-deleted keys surface (#32)', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);

    await service.mobilePosQuickSale(cashSaleDto(), user);

    const replayCall = prisma.salesOrder.findFirst.mock.calls.find(
      (call: any[]) => call[0]?.where?.idempotencyKey === 'idem-1',
    );
    expect(replayCall).toBeDefined();
    // The unique index ignores deletedAt, so the replay lookup must too —
    // otherwise a soft-deleted key wedges retries into a P2002 error loop.
    expect(replayCall[0].where).not.toHaveProperty('deletedAt');
  });

  it('returns a deterministic Conflict (not a 500 loop) when the key belongs to a soft-deleted order (#32)', async () => {
    const { service, prisma } = makeService();
    const confirmSpy = jest.spyOn(service, 'confirm');
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({ deletedAt: new Date('2026-05-30T00:00:00.000Z') }),
    );

    await expect(service.mobilePosQuickSale(cashSaleDto(), user)).rejects.toThrow(
      'belongs to a deleted sales order',
    );
    // Never reaches create()/confirm() — so it can't hit the P2002 500 loop.
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('recovers from a concurrent P2002 race by replaying the winning order', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });

    const winner = persistedOrder();
    // Pre-create replay misses; create() loses the unique-index race; the
    // post-create replay (and the findOne it triggers) return the winner.
    prisma.salesOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValue(winner);
    prisma.salesOrder.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    const result = await service.mobilePosQuickSale(cashSaleDto(), user);

    expect(prisma.salesOrder.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
  });
});

describe('SalesOrdersService cancel money guard', () => {
  it('blocks cancelling an order that has received payment', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({ status: 'CONFIRMED', paidAmount: 200, paymentStatus: 'PAID' }),
    );

    await expect(service.cancel('so-1', user)).rejects.toThrow('received payment');
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
  });

  it('allows cancelling an unpaid CONFIRMED order', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        status: 'CONFIRMED',
        paidAmount: 0,
        outstandingAmount: 200,
        paymentStatus: 'UNPAID',
        receivableId: null,
      }),
    );

    await service.cancel('so-1', user);

    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });
});

describe('SalesOrdersService cancel GL reversal (#2)', () => {
  function confirmedOrderWithJournal(overrides: Record<string, unknown> = {}) {
    return persistedOrder({
      status: 'CONFIRMED',
      salesType: 'CREDIT_SALE',
      paymentMethod: 'CREDIT',
      cashAccountId: null,
      paidAmount: 0,
      outstandingAmount: 118,
      paymentStatus: 'UNPAID',
      receivableId: null,
      journalEntryId: 'je-confirm-1',
      lines: [],
      ...overrides,
    });
  }

  // The original confirmation entry: DR AR 118 / CR Revenue 100 / CR VAT 18,
  // plus DR COGS 60 / CR Inventory 60.
  const originalEntry = {
    id: 'je-confirm-1',
    companyId: 'company-1',
    divisionId: 'division-1',
    branchId: 'branch-1',
    status: 'POSTED',
    lines: [
      { accountId: 'acct-ar', debit: 118, credit: 0, description: 'Customer receivable' },
      { accountId: 'acct-rev', debit: 0, credit: 100, description: 'Sales revenue' },
      { accountId: 'acct-vat', debit: 0, credit: 18, description: 'Output tax' },
      { accountId: 'acct-cogs', debit: 60, credit: 0, description: 'Cost of goods sold' },
      { accountId: 'acct-inv', debit: 0, credit: 60, description: 'Inventory issued' },
    ],
  };

  it('posts a balanced reversing journal that swaps debit/credit on every line', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedOrderWithJournal());
    prisma.journalEntry.findFirst.mockResolvedValue(originalEntry);

    await service.cancel('so-1', user);

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'je-confirm-1', companyId: 'company-1' }),
      }),
    );

    const reversalCall = (service as any).postingEngine.postLines.mock.calls[0][0];
    // Every original line is swapped: a debit becomes a credit of equal size.
    expect(reversalCall.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'acct-ar', debit: 0, credit: 118 }),
        expect.objectContaining({ accountId: 'acct-rev', debit: 100, credit: 0 }),
        expect.objectContaining({ accountId: 'acct-vat', debit: 18, credit: 0 }),
        expect.objectContaining({ accountId: 'acct-cogs', debit: 0, credit: 60 }),
        expect.objectContaining({ accountId: 'acct-inv', debit: 60, credit: 0 }),
      ]),
    );
    // The reversal balances (sum debit === sum credit).
    const sumDebit = reversalCall.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = reversalCall.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(sumDebit).toBe(sumCredit);
    expect(reversalCall.referenceType).toBe('SalesOrder');
    expect(reversalCall.referenceId).toBe('so-1');
  });

  it('marks the original entry REVERSED and links the reversal', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedOrderWithJournal());
    prisma.journalEntry.findFirst.mockResolvedValue(originalEntry);

    await service.cancel('so-1', user);

    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'je-confirm-1' },
        data: expect.objectContaining({ status: 'REVERSED' }),
      }),
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'je-1' },
        data: expect.objectContaining({ reversalOfId: 'je-confirm-1' }),
      }),
    );
  });

  it('does not re-reverse an already-REVERSED confirmation entry', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedOrderWithJournal());
    prisma.journalEntry.findFirst.mockResolvedValue({ ...originalEntry, status: 'REVERSED' });

    await service.cancel('so-1', user);

    expect((service as any).postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });

  it('cancels cleanly when there is no traceable confirmation journal', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      confirmedOrderWithJournal({ journalEntryId: null }),
    );
    prisma.journalEntry.findFirst.mockResolvedValue(null);

    await service.cancel('so-1', user);

    expect((service as any).postingEngine.postLines).not.toHaveBeenCalled();
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });
});

describe('SalesOrdersService workbench summary aggregation', () => {
  it('derives counts and money rollups from groupBy/_sum instead of loading rows', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 3 } },
      { status: 'CONFIRMED', _count: { _all: 4 } },
      { status: 'PARTIALLY_PAID', _count: { _all: 1 } },
      { status: 'PAID', _count: { _all: 2 } },
      { status: 'CANCELLED', _count: { _all: 1 } },
      { status: 'VOIDED', _count: { _all: 1 } },
    ]);
    prisma.salesOrder.aggregate.mockResolvedValue({
      _sum: { totalAmount: 1000, outstandingAmount: 250, paidAmount: 750 },
    });
    prisma.salesOrder.count
      .mockResolvedValueOnce(5) // unpaidCount
      .mockResolvedValueOnce(2); // overdueCreditOrders

    const summary = await service.workbenchSummary({} as any, user);

    expect(summary).toEqual({
      totalOrders: 12,
      draft: 3,
      confirmed: 7,
      cancelled: 2,
      revenue: 1000,
      outstanding: 250,
      paidAmount: 750,
      unpaidCount: 5,
      overdueCreditOrders: 2,
      blockedFailedActionCount: 0,
    });
  });

  it('excludes CANCELLED/VOIDED orders from every money rollup and count', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.groupBy.mockResolvedValue([]);

    await service.workbenchSummary({} as any, user);

    const deadExcluded = { status: { notIn: ['CANCELLED', 'VOIDED'] } };
    expect(prisma.salesOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining(deadExcluded) }),
    );
    for (const call of prisma.salesOrder.count.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining(deadExcluded));
    }
  });
});

describe('SalesOrdersService confirm currency guard', () => {
  function confirmableCashOrder(overrides: Record<string, unknown> = {}) {
    return persistedOrder({
      status: 'DRAFT',
      salesType: 'CASH_SALE',
      paymentMethod: 'CASH',
      cashAccountId: 'cash-account-1',
      paidAmount: 0,
      outstandingAmount: 200,
      paymentStatus: 'UNPAID',
      cashAccount: {
        id: 'cash-account-1',
        accountName: 'Main Till',
        accountType: 'CASH_ON_HAND',
        currency: 'TZS',
      },
      ...overrides,
    });
  }

  it('rejects a non-credit confirm when the cash account currency differs from the order currency', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      confirmableCashOrder({
        currency: 'USD',
        cashAccount: {
          id: 'cash-account-1',
          accountName: 'Main Till',
          accountType: 'CASH_ON_HAND',
          currency: 'TZS',
        },
      }),
    );

    await expect(service.confirm('so-1', user)).rejects.toThrow(
      'does not match the sales order currency',
    );
    expect(prisma.cashAccount.update).not.toHaveBeenCalled();
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
  });

  it('confirms a non-credit sale when the cash account currency matches', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, 'postSalesOrderLedger').mockResolvedValue({ id: 'journal-entry-1' });
    prisma.salesOrder.findFirst.mockResolvedValue(confirmableCashOrder());

    await service.confirm('so-1', user);

    expect(prisma.cashAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cash-account-1' },
        data: { currentBalance: { increment: 200 } },
      }),
    );
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PAID' }) }),
    );
  });
});
