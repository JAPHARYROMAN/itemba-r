import { SalesOrdersService } from './sales-orders.service';
import { AccessLevel, Prisma } from '@prisma/client';

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
      updateMany: jest.fn(async () => ({ count: 1 })),
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
      findMany: jest.fn(async () => []),
      create: jest.fn(),
      update: jest.fn(),
    },
    creditNote: {
      findFirst: jest.fn(async () => null),
    },
    inventoryMovement: {
      // Default: no prior movements recorded for the order under test. Cancel
      // tests that assert stock reversal override the SALE_ISSUE lookup.
      findMany: jest.fn(async () => []),
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

  return { service, prisma, auditLogs, companyScope };
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

describe('SalesOrdersService receipt-account reads', () => {
  it('returns an empty result without provisioning or reactivating an account', async () => {
    const { service, prisma, auditLogs } = makeService();

    const result = await service.findReceiptAccounts(
      {
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        paymentMethod: 'CASH',
      },
      posOnlyUser,
    );

    expect(result).toEqual([]);
    expect(prisma.cashAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          deletedAt: null,
          isActive: true,
          accountType: { in: ['CASH_ON_HAND', 'PETTY_CASH'] },
        }),
      }),
    );
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(prisma.cashAccount.findFirst).not.toHaveBeenCalled();
    expect(prisma.cashAccount.create).not.toHaveBeenCalled();
    expect(prisma.cashAccount.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('enforces company scope and returns only the exact requested branch/division receipt account', async () => {
    const { service, prisma, companyScope } = makeService();
    const matching = {
      id: 'receipt-account-a',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountName: 'Exact till',
      accountType: 'CASH_ON_HAND',
    };
    prisma.cashAccount.findMany.mockResolvedValue([
      matching,
      {
        ...matching,
        id: 'wrong-branch',
        branchId: 'branch-2',
        accountName: 'Other till',
      },
      {
        ...matching,
        id: 'wrong-division',
        divisionId: 'division-2',
        accountName: 'Other division till',
      },
    ]);

    const result = await service.findReceiptAccounts(
      {
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        paymentMethod: 'CASH',
        limit: 20,
      },
      posOnlyUser,
    );

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      posOnlyUser,
      'company-1',
      AccessLevel.READ,
    );
    expect(prisma.cashAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          deletedAt: null,
          isActive: true,
          accountType: { in: ['CASH_ON_HAND', 'PETTY_CASH'] },
        }),
      }),
    );
    expect(result).toEqual([matching]);
  });
});

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

  it('normalizes a legacy CASH_SALE/CREDIT row during an unrelated draft update', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({ status: 'DRAFT', paymentMethod: 'CREDIT' }),
    );
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });

    await service.update('so-1', { notes: 'Updated notes' }, user);

    expect(prisma.salesOrder.update).toHaveBeenCalledWith({
      where: { id: 'so-1' },
      data: expect.objectContaining({
        notes: 'Updated notes',
        paymentMethod: 'CASH',
        cashAccountId: 'cash-account-1',
      }),
    });
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

describe('SalesOrdersService receipt-account branch guard (shared cash-account-scope helper)', () => {
  it('rejects a cash receipt account scoped to a DIFFERENT branch than the order', async () => {
    const { service, prisma } = makeService();
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-2', // order is on branch-1
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        createDto({
          salesType: 'CASH_SALE',
          paymentMethod: 'CASH',
          cashAccountId: 'cash-account-1',
        }),
        user,
      ),
    ).rejects.toThrow('Cash account does not belong to the selected branch');
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
  });

  it('rejects an unscoped (NULL-branch) cash account — strict mode requires the exact branch', async () => {
    const { service, prisma } = makeService();
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        createDto({
          salesType: 'CASH_SALE',
          paymentMethod: 'CASH',
          cashAccountId: 'cash-account-1',
        }),
        user,
      ),
    ).rejects.toThrow('Cash account does not belong to the selected division');
  });

  it('accepts a company-wide (NULL-scope) BANK account for a bank-settled sale', async () => {
    const { service, prisma } = makeService();
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      accountType: 'BANK',
    });
    prisma.customer.findFirst.mockResolvedValue(null);

    await service.create(
      createDto({
        salesType: 'CASH_SALE',
        paymentMethod: 'BANK_TRANSFER',
        cashAccountId: 'cash-account-1',
      }),
      user,
    );
    expect(prisma.salesOrder.create).toHaveBeenCalled();
  });
});

describe('SalesOrdersService document (order-level) discount', () => {
  it('reduces the order total by the document discount and folds it into discountAmount (create)', async () => {
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
        documentDiscount: 30,
        lines: [
          {
            productId: 'product-1',
            description: 'Item',
            quantity: 2,
            unitId: 'unit-1',
            unitPrice: 100,
            discountAmount: 10, // per-unit => 20 line discount
            taxAmount: 18, // caller-supplied VAT (not recomputed on discount)
          },
        ],
      }),
      user,
    );

    // subtotal 200, line discount 20, document discount 30 => aggregate discount 50.
    // totalAmount = 200 - 20 + 18 - 30 = 168. VAT (18) is untouched by the doc discount.
    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 200,
          discountAmount: 50,
          documentDiscount: 30,
          taxAmount: 18,
          totalAmount: 168,
          outstandingAmount: 168,
        }),
      }),
    );
  });

  it('defaults documentDiscount to 0 and leaves totals unchanged (backward-compatible)', async () => {
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
      createDto({ salesType: 'CASH_SALE', paymentMethod: 'CASH', cashAccountId: 'cash-account-1' }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 200,
          discountAmount: 0,
          documentDiscount: 0,
          totalAmount: 200,
        }),
      }),
    );
  });

  it('rejects a document discount larger than the net-of-line-discount subtotal', async () => {
    const { service, prisma } = makeService();
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        createDto({
          salesType: 'CASH_SALE',
          paymentMethod: 'CASH',
          cashAccountId: 'cash-account-1',
          documentDiscount: 500, // > 200 gross line total
        }),
        user,
      ),
    ).rejects.toThrow('Document discount cannot exceed the order subtotal after line discounts');
  });

  it('posts a balanced JE and creates a receivable at the discounted total when confirming a credit sale', async () => {
    const { service, prisma } = makeService();
    // A DRAFT credit order that was created with a 30 document discount:
    // subtotal 200, VAT 18, total 168 (revenue-side discount, VAT frozen).
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        status: 'DRAFT',
        salesType: 'CREDIT_SALE',
        paymentMethod: 'CREDIT',
        cashAccountId: null,
        customerId: 'customer-1',
        customer: { id: 'customer-1', name: 'Aaron Town' },
        subtotal: 200,
        discountAmount: 50,
        documentDiscount: 30,
        taxAmount: 18,
        totalAmount: 168,
        paidAmount: 0,
        outstandingAmount: 168,
        paymentStatus: 'UNPAID',
        lines: [
          {
            id: 'line-1',
            productId: 'product-1',
            description: 'Item',
            quantity: 2,
            unitId: 'unit-1',
            unitPrice: 100,
            discountAmount: 20,
            taxAmount: 18,
            lineTotal: 168,
            batchId: null,
          },
        ],
      }),
    );
    prisma.customer.findFirst.mockResolvedValue({
      name: 'Aaron Town',
      status: 'ACTIVE',
      creditLimit: 0,
      currentBalance: 0,
    });
    // Non-stock product => no COGS/inventory legs.
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: false });
    // Let the real postSalesOrderLedger run so we assert the actual JE lines.
    (service as any).accountResolver.resolveMany.mockResolvedValue({
      AR_CONTROL: { id: 'acct-ar' },
      SALES_REVENUE: { id: 'acct-rev' },
      TAX_VAT_PAYABLE: { id: 'acct-vat' },
    });

    await service.confirm('so-1', user);

    // Receivable is raised for the DISCOUNTED total (168), not the gross.
    expect(prisma.receivable.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 168,
          outstandingAmount: 168,
        }),
      }),
    );

    // The posted journal entry reflects the discounted total: DR AR 168,
    // CR Revenue 150 (168 - 18 VAT), CR VAT 18. It balances.
    const jeCall = (service as any).postingEngine.postLines.mock.calls[0][0];
    expect(jeCall.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'acct-ar', debit: 168, credit: 0 }),
        expect.objectContaining({ accountId: 'acct-rev', debit: 0, credit: 150 }),
        expect.objectContaining({ accountId: 'acct-vat', debit: 0, credit: 18 }),
      ]),
    );
    const sumDebit = jeCall.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = jeCall.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(sumDebit).toBe(sumCredit);
    expect(sumDebit).toBe(168);
  });
});

describe('SalesOrdersService POS / cash-sale output VAT', () => {
  // A CASH_SALE that mimics the Mobile POS / Quick-Sale / Kaunta front ends,
  // which POST every line with taxAmount: 0. The server must carve 18% output
  // VAT OUT of the VAT-inclusive shelf price instead of booking the whole
  // tender as revenue.
  function posDto(overrides: Record<string, unknown> = {}) {
    return createDto({
      salesType: 'CASH_SALE',
      paymentMethod: 'CASH',
      cashAccountId: 'cash-account-1',
      lines: [
        {
          productId: 'product-1',
          description: 'Item',
          quantity: 1,
          unitId: 'unit-1',
          unitPrice: 1180, // VAT-inclusive till price
          discountAmount: 0,
          taxAmount: 0, // hardcoded by POS front ends
        },
      ],
      ...overrides,
    });
  }

  function primeCashSale(prisma: any, product: Record<string, unknown>) {
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);
    // Shared by the company-ownership line check AND the VAT derivation lookup.
    prisma.product.findMany.mockResolvedValue([
      { id: 'product-1', companyId: 'company-1', ...product },
    ]);
  }

  it('carves 18% output VAT out of the inclusive price for a taxable product (1180 -> 1000 net + 180 VAT)', async () => {
    const { service, prisma } = makeService();
    primeCashSale(prisma, { isTaxable: true, taxRate: null }); // null rate => standard 18%

    await service.create(posDto(), user);

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 1000, // net revenue base
          taxAmount: 180, // carved-out output VAT
          totalAmount: 1180, // gross tendered — net + vat == gross
        }),
      }),
    );
    // Line persists the NET unit price with the VAT broken out.
    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            unitPrice: 1000,
            taxAmount: 180,
            lineTotal: 1180,
          }),
        ],
      }),
    );
  });

  it('uses the product-specific taxRate when set instead of the 18% default', async () => {
    const { service, prisma } = makeService();
    // 5% inclusive: net = 1050 / 1.05 = 1000, tax = 50.
    primeCashSale(prisma, { isTaxable: true, taxRate: 5 });

    await service.create(
      posDto({
        lines: [
          {
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1050,
            discountAmount: 0,
            taxAmount: 0,
          },
        ],
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 1000, taxAmount: 50, totalAmount: 1050 }),
      }),
    );
  });

  it('leaves a non-taxable product entirely as revenue (no VAT booked)', async () => {
    const { service, prisma } = makeService();
    primeCashSale(prisma, { isTaxable: false, taxRate: null });

    await service.create(posDto(), user);

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 1180, taxAmount: 0, totalAmount: 1180 }),
      }),
    );
  });

  it('treats a 0%-rated taxable product as VAT-free (whole tender is revenue)', async () => {
    const { service, prisma } = makeService();
    primeCashSale(prisma, { isTaxable: true, taxRate: 0 });

    await service.create(posDto(), user);

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 1180, taxAmount: 0, totalAmount: 1180 }),
      }),
    );
  });

  it('does NOT re-derive or double VAT when the caller already supplied a per-line taxAmount', async () => {
    const { service, prisma } = makeService();
    primeCashSale(prisma, { isTaxable: true, taxRate: null });

    // Caller (a normal SO) sends net price 1000 + explicit VAT 180 on top.
    await service.create(
      posDto({
        lines: [
          {
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 180,
          },
        ],
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // taxAmount stays exactly what the caller supplied; unitPrice untouched.
        data: expect.objectContaining({ subtotal: 1000, taxAmount: 180, totalAmount: 1180 }),
      }),
    );
  });

  it('posts DR Cash gross / CR Revenue net / CR VAT on confirm of a taxable cash sale', async () => {
    const { service, prisma } = makeService();
    // DRAFT cash sale already carved to net 1000 + VAT 180 at create time.
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        status: 'DRAFT',
        subtotal: 1000,
        taxAmount: 180,
        totalAmount: 1180,
        paidAmount: 0,
        outstandingAmount: 1180,
        paymentStatus: 'UNPAID',
        lines: [
          {
            id: 'line-1',
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 180,
            lineTotal: 1180,
            batchId: null,
          },
        ],
      }),
    );
    prisma.product.findUnique.mockResolvedValue({ id: 'product-1', trackInventory: false });
    (service as any).accountResolver.resolveMany.mockResolvedValue({
      CASH_ON_HAND: { id: 'acct-cash' },
      SALES_REVENUE: { id: 'acct-rev' },
      TAX_VAT_PAYABLE: { id: 'acct-vat' },
    });

    await service.confirm('so-1', user);

    const jeCall = (service as any).postingEngine.postLines.mock.calls[0][0];
    expect(jeCall.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'acct-cash', debit: 1180, credit: 0 }),
        expect.objectContaining({ accountId: 'acct-rev', debit: 0, credit: 1000 }),
        expect.objectContaining({ accountId: 'acct-vat', debit: 0, credit: 180 }),
      ]),
    );
    const sumDebit = jeCall.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = jeCall.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(sumDebit).toBe(sumCredit);
    expect(sumDebit).toBe(1180);
    // Cash account credited with the GROSS tender.
    expect(prisma.cashAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentBalance: { increment: 1180 } } }),
    );
  });

  it('replays an idempotent POS retry whose original gross payload was persisted as derived net + VAT', async () => {
    const { service, prisma } = makeService();
    const confirmSpy = jest.spyOn(service, 'confirm');
    primeCashSale(prisma, { isTaxable: true, taxRate: null });
    // First attempt persisted the DERIVED figures: net 1000 + VAT 180 == gross 1180.
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        subtotal: 1000,
        taxAmount: 180,
        totalAmount: 1180,
        paidAmount: 1180,
        outstandingAmount: 0,
        lines: [
          {
            id: 'line-1',
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 180,
            lineTotal: 1180,
            batchId: null,
          },
        ],
      }),
    );

    // The retry carries the ORIGINAL gross/untaxed payload; the derivation must
    // run before the replay matcher so the signatures line up with the stored
    // net lines instead of 409ing every legitimate retry.
    const result = await service.mobilePosQuickSale(posDto({ idempotencyKey: 'idem-1' }), user);

    expect(result).toEqual(expect.objectContaining({ id: 'so-1' }));
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('derives VAT on the Kaunta / Mobile POS Lite path (lines built server-side with taxAmount: 0)', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'confirm').mockResolvedValue({ id: 'so-1' } as any);
    primeCashSale(prisma, { isTaxable: true, taxRate: null });
    // Replay pre-check misses (fresh key); later findFirst calls serve findOne.
    prisma.salesOrder.findFirst.mockResolvedValueOnce(null);

    await service.mobilePosLiteQuickSale(
      posDto({ idempotencyKey: 'kaunta-idem-1' }),
      user,
      'terminal-1',
      'KAUNTA-01',
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 1000,
          taxAmount: 180,
          totalAmount: 1180,
          mobilePosTerminalId: 'terminal-1',
        }),
      }),
    );
  });

  it('re-derives VAT when a DRAFT is updated with gross untaxed lines (edit cannot strip VAT)', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(persistedOrder({ status: 'DRAFT' }));
    primeCashSale(prisma, { isTaxable: true, taxRate: null });

    await service.update(
      'so-1',
      {
        lines: [
          {
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1180,
            discountAmount: 0,
            taxAmount: 0,
          },
        ],
      } as any,
      user,
    );

    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ unitPrice: 1000, taxAmount: 180, lineTotal: 1180 })],
      }),
    );
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 1000, taxAmount: 180, totalAmount: 1180 }),
      }),
    );
  });

  it('rewrites stored lines on a documentDiscount-only update when derivation nets them (header and lines stay reconciled)', async () => {
    const { service, prisma } = makeService();
    // Legacy DRAFT: stored line is still GROSS/untaxed (created before the
    // inclusive-VAT derivation existed, or while the product was non-taxable).
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        status: 'DRAFT',
        subtotal: 1180,
        taxAmount: 0,
        totalAmount: 1180,
        documentDiscount: 0,
        lines: [
          {
            id: 'line-1',
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1180,
            discountAmount: 0,
            taxAmount: 0,
            lineTotal: 1180,
            batchId: null,
          },
        ],
      }),
    );
    primeCashSale(prisma, { isTaxable: true, taxRate: null });

    // PATCH carries ONLY a document discount — no lines, no branch.
    await service.update('so-1', { documentDiscount: 100 } as any, user);

    // The derivation netted the reconstructed line, so the stored line rows
    // MUST be rewritten too — otherwise the header would say 1000 net + 180
    // VAT while the rows still said gross 1180 / tax 0, and confirm() would
    // post VAT to the GL that taxAutoApply (reading the lines) never mirrors
    // into the TaxTransaction filing ledger.
    expect(prisma.salesOrderLine.deleteMany).toHaveBeenCalledWith({
      where: { salesOrderId: 'so-1' },
    });
    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ unitPrice: 1000, taxAmount: 180, lineTotal: 1180 })],
      }),
    );
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 1000,
          taxAmount: 180,
          documentDiscount: 100,
          discountAmount: 100,
          totalAmount: 1080,
        }),
      }),
    );
  });

  it('does not touch stored lines on a documentDiscount-only update when nothing needed deriving', async () => {
    const { service, prisma } = makeService();
    // Already-derived DRAFT: stored line carries its VAT, derivation is a no-op.
    prisma.salesOrder.findFirst.mockResolvedValue(
      persistedOrder({
        status: 'DRAFT',
        subtotal: 1000,
        taxAmount: 180,
        totalAmount: 1180,
        documentDiscount: 0,
        lines: [
          {
            id: 'line-1',
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 180,
            lineTotal: 1180,
            batchId: null,
          },
        ],
      }),
    );
    primeCashSale(prisma, { isTaxable: true, taxRate: null });

    await service.update('so-1', { documentDiscount: 100 } as any, user);

    expect(prisma.salesOrderLine.deleteMany).not.toHaveBeenCalled();
    expect(prisma.salesOrderLine.createMany).not.toHaveBeenCalled();
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 1000,
          taxAmount: 180,
          documentDiscount: 100,
          totalAmount: 1080,
        }),
      }),
    );
  });

  it('honours an explicit operator zero-VAT override (taxManual) on a taxable product', async () => {
    const { service, prisma } = makeService();
    primeCashSale(prisma, { isTaxable: true, taxRate: null });

    // Sales-order editor flow: VAT-relieved customer, operator manually set the
    // line tax to 0 on a taxable product. The server must NOT carve 18% back
    // out of the entered price.
    await service.create(
      posDto({
        lines: [
          {
            productId: 'product-1',
            description: 'Item',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 0,
            taxManual: true,
          },
        ],
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 1000, taxAmount: 0, totalAmount: 1000 }),
      }),
    );
    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ unitPrice: 1000, taxAmount: 0, lineTotal: 1000 })],
      }),
    );
  });

  it('still derives VAT for unflagged taxAmount:0 lines alongside a taxManual override', async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { id: 'product-1', companyId: 'company-1', isTaxable: true, taxRate: null },
      { id: 'product-2', companyId: 'company-1', isTaxable: true, taxRate: null },
    ]);
    prisma.cashAccount.findFirst.mockResolvedValue({
      id: 'cash-account-1',
      companyId: 'company-1',
      divisionId: 'division-1',
      branchId: 'branch-1',
      accountType: 'CASH_ON_HAND',
    });
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.unitOfMeasure.findMany.mockResolvedValue([{ id: 'unit-1', companyId: 'company-1' }]);

    await service.create(
      posDto({
        lines: [
          {
            productId: 'product-1',
            description: 'Exempt line',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1000,
            discountAmount: 0,
            taxAmount: 0,
            taxManual: true, // operator's explicit zero — trusted verbatim
          },
          {
            productId: 'product-2',
            description: 'POS line',
            quantity: 1,
            unitId: 'unit-1',
            unitPrice: 1180,
            discountAmount: 0,
            taxAmount: 0, // unflagged — still derived (net 1000 + VAT 180)
          },
        ],
      }),
      user,
    );

    expect(prisma.salesOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: 2000, taxAmount: 180, totalAmount: 2180 }),
      }),
    );
    expect(prisma.salesOrderLine.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ unitPrice: 1000, taxAmount: 0, lineTotal: 1000 }),
          expect.objectContaining({ unitPrice: 1000, taxAmount: 180, lineTotal: 1180 }),
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

  it('blocks cancelling when an ISSUED credit note references the order (double-reversal guard)', async () => {
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
    prisma.creditNote.findFirst.mockResolvedValue({ id: 'cn-1' });

    await expect(service.cancel('so-1', user)).rejects.toThrow('issued credit note');
    // Company-scoped, ISSUED-only lookup against this sales order.
    expect(prisma.creditNote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          salesOrderId: 'so-1',
          companyId: 'company-1',
          status: 'ISSUED',
          deletedAt: null,
        }),
      }),
    );
    // No reversal / cancellation side effects run once the guard trips.
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
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

    // The original is flipped via an ATOMIC claim guarded on not-already-REVERSED,
    // so two concurrent cancels can't both post a reversal.
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'je-confirm-1', status: { not: 'REVERSED' } }),
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

  it('does not re-reverse an already-REVERSED confirmation entry (atomic claim loses)', async () => {
    const { service, prisma } = makeService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedOrderWithJournal());
    prisma.journalEntry.findFirst.mockResolvedValue({ ...originalEntry, status: 'REVERSED' });
    // The atomic claim matches no row (already reversed / lost the race).
    prisma.journalEntry.updateMany.mockResolvedValue({ count: 0 });

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

describe('SalesOrdersService cancel phantom-inventory guard', () => {
  const stockLine = {
    id: 'line-1',
    productId: 'product-1',
    description: 'Item',
    quantity: 10,
    unitId: 'unit-1',
    unitPrice: 100,
    discountAmount: 0,
    taxAmount: 0,
    lineTotal: 1000,
    batchId: null,
    unitCostAtSale: 6,
    cogsAmount: 60,
  };

  function confirmedStockOrder(overrides: Record<string, unknown> = {}) {
    return persistedOrder({
      status: 'CONFIRMED',
      salesType: 'CREDIT_SALE',
      paymentMethod: 'CREDIT',
      cashAccountId: null,
      paidAmount: 0,
      outstandingAmount: 1000,
      paymentStatus: 'UNPAID',
      receivableId: null,
      journalEntryId: null,
      lines: [stockLine],
      ...overrides,
    });
  }

  function makeStockService() {
    const ctx = makeService();
    // Treat product-1 as a tracked stock product for these tests.
    ctx.prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      trackInventory: true,
      defaultPurchasePrice: 6,
    });
    return ctx;
  }

  it('does NOT reverse stock for a converted order that never issued stock (no SALE_ISSUE)', async () => {
    const { service, prisma } = makeStockService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedStockOrder());
    // No SALE_ISSUE (and no SALES_RETURN) movements exist for this order.
    prisma.inventoryMovement.findMany.mockResolvedValue([]);

    await service.cancel('so-1', user);

    // Critically: NO phantom SALES_RETURN is posted.
    expect((service as any).inventoryMovements.createMovement).not.toHaveBeenCalled();
    expect(prisma.salesOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });

  it('reverses stock only up to the quantity that was actually issued', async () => {
    const { service, prisma } = makeStockService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedStockOrder());
    prisma.inventoryMovement.findMany.mockImplementation(async ({ where }: any) => {
      if (where.movementType === 'SALE_ISSUE') {
        return [{ productId: 'product-1', quantity: 10 }];
      }
      return []; // no prior SALES_RETURN
    });

    await service.cancel('so-1', user);

    const createMovement = (service as any).inventoryMovements.createMovement;
    expect(createMovement).toHaveBeenCalledTimes(1);
    expect(createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: 'SALES_RETURN',
        productId: 'product-1',
        quantity: 10,
        referenceType: 'SalesOrder',
        referenceId: 'so-1',
      }),
    );
  });

  it('does not over-reverse when stock was already partially returned', async () => {
    const { service, prisma } = makeStockService();
    prisma.salesOrder.findFirst.mockResolvedValue(confirmedStockOrder());
    // Issued 10, already returned 4 → only 6 remain to reverse.
    prisma.inventoryMovement.findMany.mockImplementation(async ({ where }: any) => {
      if (where.movementType === 'SALE_ISSUE') {
        return [{ productId: 'product-1', quantity: 10 }];
      }
      return [{ productId: 'product-1', quantity: 4 }];
    });

    await service.cancel('so-1', user);

    const createMovement = (service as any).inventoryMovements.createMovement;
    expect(createMovement).toHaveBeenCalledTimes(1);
    expect(createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ movementType: 'SALES_RETURN', quantity: 6 }),
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
