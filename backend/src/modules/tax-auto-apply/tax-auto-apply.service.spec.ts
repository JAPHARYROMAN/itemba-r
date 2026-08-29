import { TaxAutoApplyService } from './tax-auto-apply.service';

describe('TaxAutoApplyService manual audit boundary', () => {
  const previousFlag = process.env.TAX_AUTO_APPLY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.TAX_AUTO_APPLY;
    else process.env.TAX_AUTO_APPLY = previousFlag;
  });

  it.each([
    {
      invoke: (service: TaxAutoApplyService, user: any) =>
        service.applyForSalesOrder('sales-order-a', user.id, undefined, user),
      sourceDelegate: 'salesOrder',
      sourceId: 'sales-order-a',
      action: 'TAX_AUTO_APPLY_SALES_ORDER',
      entityType: 'SalesOrder',
    },
    {
      invoke: (service: TaxAutoApplyService, user: any) =>
        service.applyForPurchaseOrder('purchase-order-a', user.id, undefined, user),
      sourceDelegate: 'purchaseOrder',
      sourceId: 'purchase-order-a',
      action: 'TAX_AUTO_APPLY_PURCHASE_ORDER',
      entityType: 'PurchaseOrder',
    },
    {
      invoke: (service: TaxAutoApplyService, user: any) =>
        service.applyForExpense('expense-a', user.id, undefined, user),
      sourceDelegate: 'expense',
      sourceId: 'expense-a',
      action: 'TAX_AUTO_APPLY_EXPENSE',
      entityType: 'Expense',
    },
  ])(
    'fails closed by default while still recording the manual $entityType action',
    async ({ invoke, sourceDelegate, sourceId, action, entityType }) => {
      delete process.env.TAX_AUTO_APPLY;
      const sourceLookup = jest.fn().mockResolvedValue({ companyId: 'company-a' });
      const prisma = {
        salesOrder: { findUnique: jest.fn() },
        purchaseOrder: { findUnique: jest.fn() },
        expense: { findUnique: jest.fn() },
      } as any;
      prisma[sourceDelegate].findUnique = sourceLookup;
      const companyScope = { assertCanAccessCompany: jest.fn() } as any;
      const auditLogs = { logStrict: jest.fn().mockResolvedValue(undefined) } as any;
      const service = new TaxAutoApplyService(prisma, companyScope, auditLogs);
      const user = { id: 'user-a' } as any;

      await expect(invoke(service, user)).resolves.toEqual({
        skipped: 0,
        booked: 0,
        total: 0,
        disabled: true,
      });
      expect(companyScope.assertCanAccessCompany).not.toHaveBeenCalled();
      expect(sourceLookup).toHaveBeenCalledWith({
        where: { id: sourceId },
        select: { companyId: true },
      });
      expect(auditLogs.logStrict).toHaveBeenCalledWith({
        action,
        entityType,
        entityId: sourceId,
        userId: 'user-a',
        companyId: 'company-a',
        newValue: {
          booked: 0,
          skipped: 0,
          total: 0,
          disabled: true,
          failed: false,
        },
      });
    },
  );

  it('does not create a second audit boundary for the internal confirmation caller', async () => {
    delete process.env.TAX_AUTO_APPLY;
    const prisma = {
      salesOrder: { findUnique: jest.fn() },
      purchaseOrder: { findUnique: jest.fn() },
    } as any;
    const auditLogs = { logStrict: jest.fn() } as any;
    const service = new TaxAutoApplyService(
      prisma,
      { assertCanAccessCompany: jest.fn() } as any,
      auditLogs,
    );

    await expect(service.applyForSalesOrder('sales-order-a', 'user-a')).resolves.toEqual({
      skipped: 0,
      booked: 0,
      total: 0,
      disabled: true,
    });
    expect(prisma.salesOrder.findUnique).not.toHaveBeenCalled();
    expect(auditLogs.logStrict).not.toHaveBeenCalled();
  });
});

describe('TaxAutoApplyService expense synthetic single line', () => {
  const previousFlag = process.env.TAX_AUTO_APPLY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.TAX_AUTO_APPLY;
    else process.env.TAX_AUTO_APPLY = previousFlag;
  });

  function makePrisma(expense: Record<string, unknown>) {
    return {
      expense: { findUnique: jest.fn().mockResolvedValue(expense) },
      salesOrder: { findUnique: jest.fn() },
      purchaseOrder: { findUnique: jest.fn() },
      taxCode: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'code-1',
            taxTypeId: 'type-1',
            taxRateId: null,
            taxCode: 'VAT18',
            isDefault: true,
            companyId: 'company-a',
            taxType: { taxCategory: 'VAT', taxTypeCode: 'VAT' },
          },
        ]),
      },
      taxTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'taxtx-1',
          taxTransactionNumber: data.taxTransactionNumber,
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
  }

  function makeService(prisma: any) {
    return new TaxAutoApplyService(
      prisma,
      { assertCanAccessCompany: jest.fn() } as any,
      { logStrict: jest.fn() } as any,
    );
  }

  it('books exactly ONE INPUT TaxTransaction from the expense header (taxable base = gross minus VAT)', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const prisma = makePrisma({
      companyId: 'company-a',
      divisionId: null,
      branchId: null,
      expenseDate: new Date('2026-03-10'),
      amount: 22500,
      isTaxable: true,
      taxAmount: 3430,
    });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 1, skipped: 0, total: 3430 }));
    expect(prisma.taxTransaction.create).toHaveBeenCalledTimes(1);
    const [{ data }] = prisma.taxTransaction.create.mock.calls[0];
    expect(data.sourceType).toBe('EXPENSE');
    expect(data.sourceId).toBe('expense-a');
    expect(data.direction).toBe('INPUT');
    expect(data.taxAmount).toBe(3430);
    expect(data.taxableAmount).toBe(19070);
    // The line-keyed idempotency key collapses to one stable key per expense
    // (the synthetic line id IS the expense id).
    expect(data.taxTransactionNumber).toBe('TX-EXPENSE-expense--expense-');
  });

  it('books nothing for a non-taxable expense (zero-tax skip), even when a taxAmount value is stored', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const prisma = makePrisma({
      companyId: 'company-a',
      divisionId: null,
      branchId: null,
      expenseDate: new Date('2026-03-10'),
      amount: 22500,
      isTaxable: false,
      taxAmount: 3430,
    });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 0, skipped: 1 }));
    expect(prisma.taxTransaction.create).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-booked expense key is skipped, not re-created', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const prisma = makePrisma({
      companyId: 'company-a',
      divisionId: null,
      branchId: null,
      expenseDate: new Date('2026-03-10'),
      amount: 22500,
      isTaxable: true,
      taxAmount: 3430,
    });
    prisma.taxTransaction.findFirst.mockResolvedValue({ id: 'taxtx-existing' });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 0, skipped: 1 }));
    expect(prisma.taxTransaction.create).not.toHaveBeenCalled();
  });
});
