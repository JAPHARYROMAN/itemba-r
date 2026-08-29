import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerPaymentsService } from './customer-payments.service';
import { CustomerPaymentStatus } from './dto/customer-payment-status.enum';

const user = { id: 'user-1' } as any;

function receivable(overrides: Record<string, any> = {}) {
  return {
    id: 'rec-1',
    companyId: 'company-1',
    customerId: 'customer-1',
    outstandingAmount: new Prisma.Decimal(100),
    paidAmount: new Prisma.Decimal(0),
    status: 'OPEN',
    sourceType: null,
    sourceId: null,
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, any> = {}) {
  return {
    id: 'pay-1',
    paymentNumber: 'CPY-2026-000001',
    companyId: 'company-1',
    divisionId: null,
    branchId: null,
    customerId: 'customer-1',
    amount: new Prisma.Decimal(150),
    method: 'CASH',
    reference: null,
    paymentDate: new Date('2026-06-01T00:00:00.000Z'),
    appliedAmount: new Prisma.Decimal(150),
    unappliedAmount: new Prisma.Decimal(0),
    currency: 'TZS',
    status: CustomerPaymentStatus.COMPLETED,
    cashAccountId: 'cash-1',
    journalEntryId: 'je-1',
    reversalJournalEntryId: null,
    notes: null,
    createdById: 'user-1',
    reversedById: null,
    reversedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Build a service with a mocked Prisma. `receivablesById` maps receivable id ->
 * the row returned by the FOR UPDATE lock ($queryRaw). Receivable `update`
 * captures the last-written data per id so tests can assert the decrement.
 */
function makeService(
  opts: {
    receivablesById?: Record<string, any>;
    customer?: Record<string, any> | null;
    cashAccount?: Record<string, any> | null;
    advanceAccountId?: string | null;
    paymentAllocations?: Array<{ receivableId: string; amount: Prisma.Decimal }>;
    paymentStatus?: CustomerPaymentStatus;
    updateManyCount?: number;
    originalJournalLines?: Array<any>;
    postLines?: jest.Mock;
    /** When true, the original JE lookup returns null (mirror reversal cannot post). */
    originalJournalMissing?: boolean;
    /** Overrides for the reversed payment row returned by customerPayment.findFirst. */
    paymentOverrides?: Record<string, any>;
  } = {},
) {
  const receivablesById = opts.receivablesById ?? { 'rec-1': receivable() };
  const receivableUpdates: Record<string, any> = {};

  const cashAccount =
    opts.cashAccount === undefined
      ? {
          id: 'cash-1',
          companyId: 'company-1',
          divisionId: null,
          branchId: null,
          accountType: 'CASH_ON_HAND',
          accountName: 'Main Till',
          currency: 'TZS',
        }
      : opts.cashAccount;

  // Captures the last cashAccount.updateMany data so tests can assert the
  // currentBalance increment (create) / decrement (reverse).
  const cashAccountUpdates: any[] = [];

  const customer =
    opts.customer === undefined
      ? { companyId: 'company-1', divisionId: null, branchId: null, name: 'Acme Ltd' }
      : opts.customer;

  const originalJournalLines = opts.originalJournalLines ?? [
    {
      accountId: 'acc-cash',
      debit: new Prisma.Decimal(150),
      credit: new Prisma.Decimal(0),
      description: 'Payment received',
      divisionId: null,
      branchId: null,
    },
    {
      accountId: 'acc-ar',
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(150),
      description: 'Settle receivables',
      divisionId: null,
      branchId: null,
    },
  ];

  const tx: any = {
    $queryRaw: jest.fn(async (_strings: any, id: string) => {
      const row = receivablesById[id];
      return row ? [row] : [];
    }),
    receivable: {
      update: jest.fn(async ({ where, data }: any) => {
        const base = receivablesById[where.id] ?? receivable({ id: where.id });
        const merged = { ...base, ...data };
        receivableUpdates[where.id] = merged;
        return merged;
      }),
      aggregate: jest.fn(async () => ({ _sum: { outstandingAmount: new Prisma.Decimal(0) } })),
    },
    customer: {
      findFirst: jest.fn(async () => customer),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    cashAccount: {
      findFirst: jest.fn(async () => cashAccount),
      updateMany: jest.fn(async ({ data }: any) => {
        cashAccountUpdates.push(data);
        return { count: 1 };
      }),
    },
    chartOfAccount: {
      findFirst: jest.fn(async () =>
        opts.advanceAccountId ? { id: opts.advanceAccountId } : null,
      ),
    },
    salesOrder: { updateMany: jest.fn(async () => ({ count: 1 })) },
    customerPayment: {
      create: jest.fn(async ({ data }: any) => paymentRow({ ...data, id: 'pay-1' })),
      update: jest.fn(async ({ data }: any) =>
        paymentRow({ ...data, allocations: opts.paymentAllocations ?? [] }),
      ),
      updateMany: jest.fn(async () => ({ count: opts.updateManyCount ?? 1 })),
      findFirst: jest.fn(async () =>
        paymentRow({
          status: opts.paymentStatus ?? CustomerPaymentStatus.COMPLETED,
          allocations: opts.paymentAllocations ?? [
            { receivableId: 'rec-1', amount: new Prisma.Decimal(150) },
          ],
          ...(opts.paymentOverrides ?? {}),
        }),
      ),
    },
    journalEntry: {
      findFirst: jest.fn(async () =>
        opts.originalJournalMissing
          ? null
          : {
              id: 'je-1',
              companyId: 'company-1',
              divisionId: null,
              branchId: null,
              lines: originalJournalLines,
            },
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };

  const prisma: any = {
    customerPayment: {
      findFirst: jest.fn(async () => paymentRow()),
      findMany: jest.fn(async () => [paymentRow()]),
      count: jest.fn(async () => 1),
    },
    customer: { findFirst: jest.fn(async () => customer) },
    cashAccount: { findFirst: jest.fn(async () => cashAccount) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    accessibleCompanyIds: jest.fn().mockResolvedValue(['company-1']),
  } as any;
  const accountResolver = {
    resolve: jest.fn(async (_c: string, role: string) => ({
      id: role === 'AR_CONTROL' ? 'acc-ar' : role === 'BANK' ? 'acc-bank' : 'acc-cash',
      accountCode: role === 'AR_CONTROL' ? '1100' : '1000',
      accountName: role,
    })),
  } as any;
  const postLines =
    opts.postLines ??
    jest.fn(async () => ({ id: 'je-1', journalNumber: 'JE-CUSTOMER_PAYMENTS-1' }));
  const postingEngine = { postLines } as any;
  const codes = { next: jest.fn(async () => 'CPY-2026-000001') } as any;

  const service = new CustomerPaymentsService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    codes,
  );
  return {
    service,
    prisma,
    tx,
    receivableUpdates,
    cashAccountUpdates,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
    postLines,
    codes,
  };
}

describe('CustomerPaymentsService.create — allocation across multiple receivables', () => {
  it('allocates one payment across multiple receivables and decrements each outstanding', async () => {
    const { service, tx, receivableUpdates } = makeService({
      receivablesById: {
        'rec-1': receivable({ id: 'rec-1', outstandingAmount: new Prisma.Decimal(100) }),
        'rec-2': receivable({ id: 'rec-2', outstandingAmount: new Prisma.Decimal(50) }),
      },
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 150,
        method: 'CASH',
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [
          { receivableId: 'rec-1', amount: 100 },
          { receivableId: 'rec-2', amount: 50 },
        ],
      } as any,
      user,
    );

    // rec-1 fully paid (100 -> 0, PAID), rec-2 fully paid (50 -> 0, PAID).
    expect(Number(receivableUpdates['rec-1'].outstandingAmount)).toBe(0);
    expect(receivableUpdates['rec-1'].status).toBe('PAID');
    expect(Number(receivableUpdates['rec-2'].outstandingAmount)).toBe(0);
    expect(receivableUpdates['rec-2'].status).toBe('PAID');
    expect(tx.customerPayment.create).toHaveBeenCalled();
  });

  it('sets PARTIALLY_PAID when an allocation is less than the outstanding', async () => {
    const { service, receivableUpdates } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 40,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 40 }],
      } as any,
      user,
    );

    expect(Number(receivableUpdates['rec-1'].outstandingAmount)).toBe(60);
    expect(receivableUpdates['rec-1'].status).toBe('PARTIALLY_PAID');
  });

  it('holds the remainder (amount - sum) as unappliedAmount on the payment', async () => {
    // Pay 150, allocate 100 -> 50 unapplied.
    const { service, tx } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
      advanceAccountId: 'acc-advance',
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 150,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 100 }],
      } as any,
      user,
    );

    const createArg = tx.customerPayment.create.mock.calls[0][0].data;
    expect(Number(createArg.appliedAmount)).toBe(100);
    expect(Number(createArg.unappliedAmount)).toBe(50);
  });

  it('rejects over-allocation (sum of allocations exceeds payment amount)', async () => {
    const { service, tx } = makeService();
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 100,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [
            { receivableId: 'rec-1', amount: 80 },
            { receivableId: 'rec-2', amount: 40 },
          ],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.customerPayment.create).not.toHaveBeenCalled();
  });

  it('rejects an allocation that exceeds a receivable outstanding balance', async () => {
    const { service } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(30) }) },
    });
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 50,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [{ receivableId: 'rec-1', amount: 50 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a receivable belonging to a different customer', async () => {
    const { service } = makeService({
      receivablesById: { 'rec-1': receivable({ customerId: 'customer-OTHER' }) },
    });
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 50,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [{ receivableId: 'rec-1', amount: 50 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a receivable belonging to a different company (cross-company leak)', async () => {
    const { service } = makeService({
      receivablesById: { 'rec-1': receivable({ companyId: 'company-OTHER' }) },
    });
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 50,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [{ receivableId: 'rec-1', amount: 50 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing receivable', async () => {
    const { service } = makeService({ receivablesById: {} });
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 50,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [{ receivableId: 'rec-missing', amount: 50 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate receivable ids across allocations', async () => {
    const { service } = makeService();
    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 100,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [
            { receivableId: 'rec-1', amount: 40 },
            { receivableId: 'rec-1', amount: 40 },
          ],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CustomerPaymentsService.create — balanced GL posting', () => {
  it('posts DR Cash (full) / CR AR (applied) / CR Advance (unapplied) and it balances', async () => {
    const { service, postLines } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
      advanceAccountId: 'acc-advance',
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 150,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 100 }],
      } as any,
      user,
    );

    const posting = postLines.mock.calls[0][0];
    const totalDebit = posting.lines.reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0);
    const totalCredit = posting.lines.reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(150);

    const cashLine = posting.lines.find((l: any) => l.accountId === 'acc-cash');
    const arLine = posting.lines.find((l: any) => l.accountId === 'acc-ar');
    const advanceLine = posting.lines.find((l: any) => l.accountId === 'acc-advance');
    expect(Number(cashLine.debit)).toBe(150);
    expect(Number(arLine.credit)).toBe(100);
    expect(Number(advanceLine.credit)).toBe(50);
  });

  it('falls back to crediting AR for the unapplied remainder when no advance account exists', async () => {
    const { service, postLines } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
      advanceAccountId: null,
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 150,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 100 }],
      } as any,
      user,
    );

    const posting = postLines.mock.calls[0][0];
    const totalDebit = posting.lines.reduce((s: number, l: any) => s + Number(l.debit ?? 0), 0);
    const totalCredit = posting.lines.reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
    expect(totalDebit).toBe(totalCredit);
    // No advance account -> both applied + unapplied credit AR (total 150).
    const arCredits = posting.lines
      .filter((l: any) => l.accountId === 'acc-ar')
      .reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0);
    expect(arCredits).toBe(150);
    expect(posting.lines.some((l: any) => l.accountId === 'acc-advance')).toBe(false);
  });

  it('resolves the BANK GL debit role when the cash account is a bank account', async () => {
    const { service, accountResolver } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        accountType: 'BANK',
        accountName: 'CRDB Current',
      },
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 100,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 100 }],
      } as any,
      user,
    );

    const roles = accountResolver.resolve.mock.calls.map((c: any[]) => c[1]);
    expect(roles).toContain('BANK');
    expect(roles).not.toContain('CASH_ON_HAND');
  });

  it('throws (and never posts) when the advance account collides with the cash/bank debit account', async () => {
    // Mis-seeded chart: the customer-advance liability resolves to the very same
    // account we DEBIT for the cash receipt (acc-cash). Posting the unapplied
    // remainder there would emit Dr Cash / Cr Cash — a self-cancelling no-op.
    const { service, postLines } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
      advanceAccountId: 'acc-cash',
    });

    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 150,
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [{ receivableId: 'rec-1', amount: 100 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(postLines).not.toHaveBeenCalled();
  });

  it('does NOT throw on advance/cash collision when there is no unapplied remainder', async () => {
    // Same mis-seeded collision, but the payment is fully applied (no advance line
    // is ever needed), so the guard must not fire.
    const { service, postLines } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(150) }) },
      advanceAccountId: 'acc-cash',
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 150,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 150 }],
      } as any,
      user,
    );

    expect(postLines).toHaveBeenCalledTimes(1);
    const posting = postLines.mock.calls[0][0];
    // Only Dr Cash / Cr AR — no self-cancelling line against acc-cash.
    expect(posting.lines).toHaveLength(2);
  });
});

describe('CustomerPaymentsService.reverse — restores receivables + mirror JE', () => {
  it('restores each allocated receivable outstanding and posts a mirror JE', async () => {
    const { service, postLines, receivableUpdates, tx } = makeService({
      paymentAllocations: [
        { receivableId: 'rec-1', amount: new Prisma.Decimal(100) },
        { receivableId: 'rec-2', amount: new Prisma.Decimal(50) },
      ],
      receivablesById: {
        'rec-1': receivable({
          id: 'rec-1',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(100),
          status: 'PAID',
        }),
        'rec-2': receivable({
          id: 'rec-2',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(50),
          status: 'PAID',
        }),
      },
    });

    await service.reverse('pay-1', { reason: 'bounced cheque' } as any, user);

    // rec-1 restored 0 -> 100, rec-2 restored 0 -> 50.
    expect(Number(receivableUpdates['rec-1'].outstandingAmount)).toBe(100);
    expect(receivableUpdates['rec-1'].status).toBe('OPEN');
    expect(Number(receivableUpdates['rec-2'].outstandingAmount)).toBe(50);

    // Mirror JE posted with swapped debit/credit.
    expect(postLines).toHaveBeenCalledTimes(1);
    const posting = postLines.mock.calls[0][0];
    const cashLine = posting.lines.find((l: any) => l.accountId === 'acc-cash');
    const arLine = posting.lines.find((l: any) => l.accountId === 'acc-ar');
    expect(Number(cashLine.credit)).toBe(150);
    expect(Number(arLine.debit)).toBe(150);
    // Original JE claimed REVERSED first.
    expect(tx.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVERSED' }) }),
    );
  });

  it('does NOT resurrect the balance of a WRITTEN_OFF receivable', async () => {
    const { service, receivableUpdates } = makeService({
      paymentAllocations: [{ receivableId: 'rec-1', amount: new Prisma.Decimal(100) }],
      receivablesById: {
        'rec-1': receivable({
          id: 'rec-1',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(100),
          status: 'WRITTEN_OFF',
        }),
      },
    });

    await service.reverse('pay-1', {} as any, user);
    expect(receivableUpdates['rec-1']).toBeUndefined();
  });

  it('throws ConflictException and never posts when the payment is already REVERSED (double-reverse guard)', async () => {
    const { service, postLines } = makeService({
      updateManyCount: 0,
      paymentStatus: CustomerPaymentStatus.REVERSED,
    });

    await expect(service.reverse('pay-1', {} as any, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(postLines).not.toHaveBeenCalled();
  });

  it('claims COMPLETED -> REVERSED via a guarded updateMany', async () => {
    const { service, tx } = makeService({
      paymentAllocations: [{ receivableId: 'rec-1', amount: new Prisma.Decimal(150) }],
    });
    await service.reverse('pay-1', {} as any, user);
    expect(tx.customerPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'pay-1',
          status: CustomerPaymentStatus.COMPLETED,
          deletedAt: null,
        }),
        data: expect.objectContaining({ status: CustomerPaymentStatus.REVERSED }),
      }),
    );
  });

  it('throws (rolling back the reversal) when a JE was expected but the mirror could not post', async () => {
    // The payment HAS a journalEntryId ('je-1') but the JE lookup returns null
    // (deleted, or a lost claim race). Restoring receivables + flipping REVERSED
    // without a mirror JE would leave the original Dr Cash / Cr AR live with no
    // offset, so the whole reversal must roll back.
    const { service } = makeService({
      paymentAllocations: [{ receivableId: 'rec-1', amount: new Prisma.Decimal(150) }],
      receivablesById: {
        'rec-1': receivable({
          id: 'rec-1',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(150),
          status: 'PAID',
        }),
      },
      originalJournalMissing: true,
    });

    await expect(service.reverse('pay-1', {} as any, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does NOT throw when a payment that never posted a JE (journalEntryId null) is reversed', async () => {
    // A never-posted payment (journalEntryId null) legitimately has no mirror to
    // post; reversePaymentJournal returns null and the reversal proceeds.
    const { service, postLines } = makeService({
      paymentAllocations: [{ receivableId: 'rec-1', amount: new Prisma.Decimal(150) }],
      paymentOverrides: { journalEntryId: null },
      receivablesById: {
        'rec-1': receivable({
          id: 'rec-1',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(150),
          status: 'PAID',
        }),
      },
      originalJournalMissing: true,
    });

    await expect(service.reverse('pay-1', {} as any, user)).resolves.toBeDefined();
    // No mirror JE posted (nothing to reverse), and no throw.
    expect(postLines).not.toHaveBeenCalled();
  });
});

describe('CustomerPaymentsService — CashAccount.currentBalance maintenance', () => {
  it('increments CashAccount.currentBalance by the full payment amount on create', async () => {
    const { service, cashAccountUpdates } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 150,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        // 100 applied + 50 unapplied — the WHOLE 150 hit the cash account.
        allocations: [{ receivableId: 'rec-1', amount: 100 }],
      } as any,
      user,
    );

    expect(cashAccountUpdates).toHaveLength(1);
    expect(Number(cashAccountUpdates[0].currentBalance.increment)).toBe(150);
  });

  it('scopes the cash-account balance update by id + companyId', async () => {
    const { service, tx } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
    });

    await service.create(
      {
        companyId: 'company-1',
        customerId: 'customer-1',
        amount: 100,
        paymentDate: '2026-06-01',
        cashAccountId: 'cash-1',
        allocations: [{ receivableId: 'rec-1', amount: 100 }],
      } as any,
      user,
    );

    expect(tx.cashAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cash-1', companyId: 'company-1', deletedAt: null }),
        data: { currentBalance: { increment: expect.anything() } },
      }),
    );
  });

  it('rejects a payment whose currency differs from the cash account currency', async () => {
    const { service, tx } = makeService({
      receivablesById: { 'rec-1': receivable({ outstandingAmount: new Prisma.Decimal(100) }) },
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        accountType: 'BANK',
        accountName: 'USD Account',
        currency: 'USD',
      },
    });

    await expect(
      service.create(
        {
          companyId: 'company-1',
          customerId: 'customer-1',
          amount: 100,
          currency: 'TZS',
          paymentDate: '2026-06-01',
          cashAccountId: 'cash-1',
          allocations: [{ receivableId: 'rec-1', amount: 100 }],
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Never mutated the receivable or the cash balance on a currency mismatch.
    expect(tx.customerPayment.create).not.toHaveBeenCalled();
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
  });

  it('decrements CashAccount.currentBalance by the payment amount on reverse (mirror of create)', async () => {
    const { service, cashAccountUpdates } = makeService({
      paymentAllocations: [{ receivableId: 'rec-1', amount: new Prisma.Decimal(150) }],
      receivablesById: {
        'rec-1': receivable({
          id: 'rec-1',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(150),
          status: 'PAID',
        }),
      },
    });

    await service.reverse('pay-1', { reason: 'bounced cheque' } as any, user);

    expect(cashAccountUpdates).toHaveLength(1);
    expect(Number(cashAccountUpdates[0].currentBalance.decrement)).toBe(150);
  });

  it('does NOT touch CashAccount.currentBalance on reverse when no mirror JE posted (never-posted payment)', async () => {
    const { service, tx } = makeService({
      paymentAllocations: [{ receivableId: 'rec-1', amount: new Prisma.Decimal(150) }],
      paymentOverrides: { journalEntryId: null },
      receivablesById: {
        'rec-1': receivable({
          id: 'rec-1',
          outstandingAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(150),
          status: 'PAID',
        }),
      },
      originalJournalMissing: true,
    });

    await service.reverse('pay-1', {} as any, user);
    // No cash leg was ever posted -> nothing to unwind.
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
  });
});

describe('CustomerPaymentsService.create — branch custody guard (shared cash-account-scope helper)', () => {
  const baseDto = (overrides: Record<string, any> = {}) => ({
    companyId: 'company-1',
    customerId: 'customer-1',
    amount: 150,
    method: 'CASH',
    paymentDate: '2026-06-01',
    cashAccountId: 'cash-1',
    allocations: [{ receivableId: 'rec-1', amount: 100 }],
    ...overrides,
  });

  it('rejects a cash account scoped to a DIFFERENT branch than the payment', async () => {
    const { service, prisma } = makeService({
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-2', // payment names branch-1
        accountType: 'CASH_ON_HAND',
        accountName: 'Kariakoo Cash',
        currency: 'TZS',
      },
    });

    await expect(
      service.create(baseDto({ divisionId: 'division-1', branchId: 'branch-1' }) as any, user),
    ).rejects.toThrow('Cash account does not belong to the selected branch');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a cash account scoped to a DIFFERENT division than the payment', async () => {
    const { service } = makeService({
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-2',
        branchId: 'branch-2',
        accountType: 'CASH_ON_HAND',
        accountName: 'Other Division Cash',
        currency: 'TZS',
      },
    });

    await expect(
      service.create(baseDto({ divisionId: 'division-1', branchId: 'branch-1' }) as any, user),
    ).rejects.toThrow('Cash account does not belong to the selected division');
  });

  it('accepts an unscoped (NULL-branch) legacy account for a branch-scoped payment', async () => {
    // Accounts created before the branch-scoping migration carry NULL scope;
    // they must keep receiving payments exactly as before.
    const { service, cashAccountUpdates } = makeService();

    const result = await service.create(
      baseDto({ divisionId: 'division-1', branchId: 'branch-1' }) as any,
      user,
    );

    expect(result).toBeTruthy();
    expect(cashAccountUpdates).toHaveLength(1);
    expect(Number(cashAccountUpdates[0].currentBalance.increment)).toBe(150);
  });

  it('accepts a branch-scoped account when the payment carries no branch context (legacy caller)', async () => {
    const { service, cashAccountUpdates } = makeService({
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        accountType: 'CASH_ON_HAND',
        accountName: 'Branch Cash',
        currency: 'TZS',
      },
    });

    const result = await service.create(baseDto() as any, user);

    expect(result).toBeTruthy();
    expect(cashAccountUpdates).toHaveLength(1);
  });

  it('accepts a company-wide (NULL-scope) BANK account regardless of the payment branch', async () => {
    const { service, cashAccountUpdates } = makeService({
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        divisionId: null,
        branchId: null,
        accountType: 'BANK',
        accountName: 'Main Bank',
        currency: 'TZS',
      },
    });

    const result = await service.create(
      baseDto({ method: 'BANK_TRANSFER', divisionId: 'division-1', branchId: 'branch-1' }) as any,
      user,
    );

    expect(result).toBeTruthy();
    expect(cashAccountUpdates).toHaveLength(1);
  });
});
