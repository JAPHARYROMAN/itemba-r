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
        // The ledger insert is createMany + skipDuplicates (compiles to
        // INSERT ... ON CONFLICT DO NOTHING); count 0 means the key was taken.
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(0),
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
      currency: 'TZS',
      isTaxable: true,
      taxAmount: 3430,
    });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 1, skipped: 0, total: 3430 }));
    expect(prisma.taxTransaction.createMany).toHaveBeenCalledTimes(1);
    const [{ data: rows, skipDuplicates }] = prisma.taxTransaction.createMany.mock.calls[0];
    // Conflict-safe at the SQL level: ON CONFLICT DO NOTHING, never a 23505
    // statement error that would abort a caller's transaction.
    expect(skipDuplicates).toBe(true);
    expect(rows).toHaveLength(1);
    const [data] = rows;
    expect(data.id).toEqual(expect.any(String));
    expect(data.sourceType).toBe('EXPENSE');
    expect(data.sourceId).toBe('expense-a');
    expect(data.direction).toBe('INPUT');
    expect(data.taxAmount).toBe(3430);
    expect(data.taxableAmount).toBe(19070);
    expect(data.currency).toBe('TZS');
    // One stable key per expense, built from the FULL expense id — truncation
    // would collapse the key to 32 bits and let two different expenses whose
    // ids share a prefix silently masquerade as already-booked.
    expect(data.taxTransactionNumber).toBe('TX-EXPENSE-expense-a');
    // The synthetic-line pre-check is source-scoped: a colliding key from a
    // DIFFERENT document can never satisfy the idempotency lookup.
    expect(prisma.taxTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-a',
          taxTransactionNumber: 'TX-EXPENSE-expense-a',
          sourceType: 'EXPENSE',
          sourceId: 'expense-a',
          deletedAt: null,
        }),
      }),
    );
  });

  it('stamps the expense currency on the compliance row (no hardcoded TZS for multi-currency expenses)', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const prisma = makePrisma({
      companyId: 'company-a',
      divisionId: null,
      branchId: null,
      expenseDate: new Date('2026-03-10'),
      amount: 1180,
      currency: 'USD',
      isTaxable: true,
      taxAmount: 180,
    });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 1 }));
    const [{ data: rows }] = prisma.taxTransaction.createMany.mock.calls[0];
    // A USD 180 input VAT recorded as "TZS 180" would understate the VAT
    // return by orders of magnitude — the row must carry the source currency.
    expect(rows[0].currency).toBe('USD');
    expect(rows[0].taxAmount).toBe(180);
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
    expect(prisma.taxTransaction.createMany).not.toHaveBeenCalled();
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
    expect(prisma.taxTransaction.createMany).not.toHaveBeenCalled();
  });

  it('treats an ON CONFLICT no-op held by the SAME expense as a clean idempotent skip', async () => {
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
    // The pre-check misses (e.g. a soft-deleted row, or a concurrent apply
    // committed between check and insert), the INSERT hits ON CONFLICT DO
    // NOTHING, and the re-fetch shows the key belongs to THIS expense.
    prisma.taxTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sourceType: 'EXPENSE', sourceId: 'expense-a' });
    prisma.taxTransaction.createMany.mockResolvedValue({ count: 0 });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 0, skipped: 1 }));
    expect(result.failed).toBeUndefined();
    // Nothing was inserted, so nothing gets posted.
    expect(prisma.taxTransaction.update).not.toHaveBeenCalled();
  });

  it('flags (never silently skips) a key held by a DIFFERENT source document', async () => {
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
    prisma.taxTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sourceType: 'EXPENSE', sourceId: 'expense-other' });
    prisma.taxTransaction.createMany.mockResolvedValue({ count: 0 });
    const service = makeService(prisma);

    const result = await service.applyForExpense('expense-a', 'user-a');

    // A genuine number collision must surface as a reconcilable failure — a
    // silent "skipped" would permanently drop this expense's input VAT from
    // the filing ledger while the GL carries it.
    expect(result.failed).toBe(true);
    expect(result.error).toContain('collision');
    expect(result.booked).toBe(0);
    expect(prisma.taxTransaction.update).not.toHaveBeenCalled();
  });
});

describe('TaxAutoApplyService savepoint containment inside a caller transaction', () => {
  const previousFlag = process.env.TAX_AUTO_APPLY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.TAX_AUTO_APPLY;
    else process.env.TAX_AUTO_APPLY = previousFlag;
  });

  function makeTx(expense: Record<string, unknown>) {
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
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(0),
    } as any;
  }

  function savepointCalls(tx: any): string[] {
    return tx.$executeRaw.mock.calls.map((call: any[]) =>
      Array.isArray(call[0]) ? call[0].join('') : String(call[0]),
    );
  }

  const taxableExpense = {
    companyId: 'company-a',
    divisionId: null,
    branchId: null,
    expenseDate: new Date('2026-03-10'),
    amount: 22500,
    currency: 'TZS',
    isTaxable: true,
    taxAmount: 3430,
  };

  it('wraps the per-line write in SAVEPOINT / RELEASE when running on a caller tx', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const tx = makeTx(taxableExpense);
    const service = new TaxAutoApplyService(
      // Standalone prisma is never touched when a tx is provided.
      {} as any,
      { assertCanAccessCompany: jest.fn() } as any,
      { logStrict: jest.fn() } as any,
    );

    const result = await service.applyForExpense('expense-a', 'user-a', tx);

    expect(result).toEqual(expect.objectContaining({ booked: 1 }));
    const raw = savepointCalls(tx);
    expect(raw.some((sql) => sql.includes('SAVEPOINT tax_auto_apply_line'))).toBe(true);
    expect(raw.some((sql) => sql.includes('RELEASE SAVEPOINT tax_auto_apply_line'))).toBe(true);
  });

  it('a P2002-style statement failure inside the shared tx rolls back to the savepoint and still returns (the approval can commit)', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const tx = makeTx(taxableExpense);
    // The INSERT dies at the DB level inside the caller's transaction (e.g. a
    // unique-constraint race the ON CONFLICT clause did not cover, or an FK
    // violation). Without the savepoint the whole approval transaction is
    // aborted and every later statement fails with 25P02.
    tx.taxTransaction.createMany.mockRejectedValue(
      Object.assign(
        new Error('Unique constraint failed on the fields: (`companyId`,`taxTransactionNumber`)'),
        {
          code: 'P2002',
        },
      ),
    );
    const service = new TaxAutoApplyService(
      {} as any,
      { assertCanAccessCompany: jest.fn() } as any,
      { logStrict: jest.fn() } as any,
    );

    const result = await service.applyForExpense('expense-a', 'user-a', tx);

    // apply() swallows the line failure (soft-fail contract)...
    expect(result).toEqual(expect.objectContaining({ booked: 0, skipped: 1 }));
    // ...and the enclosing transaction was restored to the savepoint, so the
    // caller's remaining statements (the approval's final expense.update)
    // still commit instead of dying with 25P02.
    const raw = savepointCalls(tx);
    const savepointIndex = raw.findIndex((sql) => sql.includes('SAVEPOINT tax_auto_apply_line'));
    const rollbackIndex = raw.findIndex((sql) =>
      sql.includes('ROLLBACK TO SAVEPOINT tax_auto_apply_line'),
    );
    expect(savepointIndex).toBeGreaterThanOrEqual(0);
    expect(rollbackIndex).toBeGreaterThan(savepointIndex);
    expect(tx.taxTransaction.update).not.toHaveBeenCalled();
  });

  it('issues no savepoints on a standalone (non-tx) call — each statement is its own transaction', async () => {
    process.env.TAX_AUTO_APPLY = 'true';
    const prisma = makeTx(taxableExpense);
    const service = new TaxAutoApplyService(
      prisma,
      { assertCanAccessCompany: jest.fn() } as any,
      { logStrict: jest.fn() } as any,
    );

    const result = await service.applyForExpense('expense-a', 'user-a');

    expect(result).toEqual(expect.objectContaining({ booked: 1 }));
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
