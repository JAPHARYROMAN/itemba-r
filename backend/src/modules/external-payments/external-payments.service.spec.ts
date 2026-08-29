import { BadRequestException } from '@nestjs/common';
import { Prisma, ExternalPaymentStatus, ExternalPaymentContext } from '@prisma/client';
import { ExternalPaymentsService } from './external-payments.service';

// ── shared mock builders ───────────────────────────────────────────────────────

function makeService(overrides: { prisma?: any } = {}) {
  const prisma =
    overrides.prisma ??
    ({
      externalPayment: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    } as any);
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const accountResolver = {
    resolve: jest.fn(),
  } as any;
  const postingEngine = {
    postLines: jest.fn(),
  } as any;
  const service = new ExternalPaymentsService(
    prisma,
    auditLogs,
    companyScope,
    accountResolver,
    postingEngine,
  );
  return { service, prisma, auditLogs, companyScope, accountResolver, postingEngine };
}

const baseDto = {
  companyId: 'company-1',
  amount: 1000,
  idempotencyKey: 'idem-1',
} as any;

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

// ── idempotency (ITMB-AUDIT-31) — unchanged behaviour ──────────────────────────

describe('ExternalPaymentsService idempotency (ITMB-AUDIT-31)', () => {
  it('returns the existing row when the idempotency key already resolves (replay)', async () => {
    const { service, prisma } = makeService();
    const existing = { id: 'pay-1', companyId: 'company-1' };
    prisma.externalPayment.findFirst.mockResolvedValueOnce(existing);

    const result = await service.createForCompany(baseDto, 'actor-1', 'company-1');

    expect(result).toBe(existing);
    expect(prisma.externalPayment.create).not.toHaveBeenCalled();
  });

  it('replays the winning row when create loses the unique-index race (P2002 fallback)', async () => {
    const { service, prisma } = makeService();
    const winner = { id: 'pay-winner', companyId: 'company-1' };
    prisma.externalPayment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    prisma.externalPayment.create.mockRejectedValueOnce(p2002());

    const result = await service.createForCompany(baseDto, 'actor-1', 'company-1');

    expect(result).toBe(winner);
    expect(prisma.externalPayment.create).toHaveBeenCalledTimes(1);
    expect(prisma.externalPayment.findFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows a P2002 that has no replayable winner', async () => {
    const { service, prisma } = makeService();
    prisma.externalPayment.findFirst.mockResolvedValue(null);
    prisma.externalPayment.create.mockRejectedValueOnce(p2002());

    await expect(service.createForCompany(baseDto, 'actor-1', 'company-1')).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('does not run the P2002 replay when no idempotency key was supplied', async () => {
    const { service, prisma } = makeService();
    prisma.externalPayment.create.mockRejectedValueOnce(p2002());

    await expect(
      service.createForCompany({ companyId: 'company-1', amount: 5 } as any, 'actor-1', 'company-1'),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(prisma.externalPayment.findFirst).not.toHaveBeenCalled();
  });

  it('creates and audits a fresh payment on the happy path', async () => {
    const { service, prisma, auditLogs } = makeService();
    const created = { id: 'pay-new', companyId: 'company-1' };
    prisma.externalPayment.findFirst.mockResolvedValueOnce(null);
    prisma.externalPayment.create.mockResolvedValueOnce(created);

    const result = await service.createForCompany(baseDto, 'actor-1', 'company-1');

    expect(result).toBe(created);
    expect(prisma.externalPayment.create).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXTERNAL_PAYMENT_CREATED' }),
    );
  });
});

// ── confirm → GL + AR relief + cash (the ops↔finance linkage fix) ──────────────

/**
 * Build a prisma mock rich enough to drive confirmTrusted / reverseTrusted:
 * a stateful $transaction proxy over externalPayment, receivable, salesOrder,
 * customer, cashAccount, chartOfAccount, journalEntry, and $queryRaw (FOR UPDATE).
 * The $transaction mock snapshots the mutable state before running the callback
 * and RESTORES it when the callback throws, emulating a real database rollback —
 * so atomicity assertions ("the status flip rolled back") are meaningful.
 */
function makeFinanceHarness(opts: {
  payment: any;
  receivable?: any;
  salesOrder?: any;
  cashAccount?: any | null;
  advanceAccountId?: string | null;
  fallbackUserId?: string | null;
}) {
  const state = {
    payment: { ...opts.payment },
    receivable: opts.receivable ? { ...opts.receivable } : null,
    salesOrder: opts.salesOrder ? { ...opts.salesOrder } : null,
    cashAccount:
      opts.cashAccount === undefined
        ? {
            id: 'cash-1',
            companyId: 'company-1',
            accountType: 'BANK',
            accountName: 'Main Bank',
            currency: 'TZS',
            currentBalance: new Prisma.Decimal(0),
            divisionId: null,
            branchId: null,
          }
        : opts.cashAccount,
    customerBalance: null as any,
    journalEntries: [] as any[],
    salesOrderUpdate: null as any,
  };

  const tx: any = {
    externalPayment: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const statusOk = where.status?.in
          ? where.status.in.includes(state.payment.status)
          : state.payment.status === where.status;
        if (where.id === state.payment.id && statusOk) {
          Object.assign(state.payment, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      findUnique: jest.fn(async () => ({ ...state.payment })),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(state.payment, data);
        return { ...state.payment };
      }),
    },
    receivable: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(state.receivable, data);
        return { ...state.receivable };
      }),
      aggregate: jest.fn(async () => ({
        _sum: { outstandingAmount: state.receivable?.outstandingAmount ?? new Prisma.Decimal(0) },
      })),
    },
    salesOrder: {
      findFirst: jest.fn(async () => (state.salesOrder ? { ...state.salesOrder } : null)),
      updateMany: jest.fn(async ({ data }: any) => {
        state.salesOrderUpdate = data;
        return { count: 1 };
      }),
    },
    customer: {
      updateMany: jest.fn(async ({ data }: any) => {
        state.customerBalance = data.currentBalance;
        return { count: 1 };
      }),
    },
    cashAccount: {
      findFirst: jest.fn(async () => (state.cashAccount ? { ...state.cashAccount } : null)),
      updateMany: jest.fn(async ({ data }: any) => {
        if (state.cashAccount && data.currentBalance?.increment) {
          state.cashAccount.currentBalance = new Prisma.Decimal(
            state.cashAccount.currentBalance,
          ).plus(data.currentBalance.increment);
        }
        if (state.cashAccount && data.currentBalance?.decrement) {
          state.cashAccount.currentBalance = new Prisma.Decimal(
            state.cashAccount.currentBalance,
          ).minus(data.currentBalance.decrement);
        }
        return { count: state.cashAccount ? 1 : 0 };
      }),
    },
    chartOfAccount: {
      findFirst: jest.fn(async () =>
        opts.advanceAccountId ? { id: opts.advanceAccountId } : null,
      ),
    },
    user: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) return where.id ? { id: where.id } : null;
        return opts.fallbackUserId ? { id: opts.fallbackUserId } : null;
      }),
    },
    journalEntry: {
      findFirst: jest.fn(async () => {
        const live = state.journalEntries.find((je) => je.status !== 'REVERSED');
        return live ? { ...live, lines: live.lines } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const je = state.journalEntries.find((j) => j.id === where.id && j.status !== 'REVERSED');
        if (je) {
          Object.assign(je, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    $queryRaw: jest.fn(async () => (state.receivable ? [{ ...state.receivable }] : [])),
  };

  const snapshot = () => ({
    payment: { ...state.payment },
    receivable: state.receivable ? { ...state.receivable } : null,
    salesOrder: state.salesOrder ? { ...state.salesOrder } : null,
    cashAccount: state.cashAccount ? { ...state.cashAccount } : state.cashAccount,
    customerBalance: state.customerBalance,
    journalEntries: state.journalEntries.map((je) => ({ ...je })),
    salesOrderUpdate: state.salesOrderUpdate,
  });

  const prisma: any = {
    externalPayment: {
      findFirst: jest.fn(async () => ({ ...state.payment })),
      findUnique: jest.fn(async () => ({ ...state.payment })),
    },
    // Emulate DB rollback: restore the pre-transaction state when the callback throws.
    $transaction: jest.fn(async (fn: any) => {
      const before = snapshot();
      try {
        return await fn(tx);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    }),
  };

  return { prisma, tx, state };
}

const CASH_ACCT = { id: 'coa-cash', accountCode: '1020', accountName: 'Bank' };
const AR_ACCT = { id: 'coa-ar', accountCode: '1100', accountName: 'AR Control' };

function wireResolver(accountResolver: any) {
  accountResolver.resolve.mockImplementation(async (_c: string, role: string) => {
    if (role === 'AR_CONTROL') return AR_ACCT;
    return CASH_ACCT; // BANK / CASH_ON_HAND
  });
}

describe('ExternalPaymentsService confirm → finance posting', () => {
  it('posts DR Cash / CR AR, relieves the linked receivable, and bumps CashAccount balance', async () => {
    const payment = {
      id: 'pay-1',
      paymentNumber: 'PAY-1',
      companyId: 'company-1',
      amount: new Prisma.Decimal(1000),
      currency: 'TZS',
      paymentMethod: 'BANK_TRANSFER',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-1',
      status: ExternalPaymentStatus.INITIATED,
      confirmedById: null,
      initiatedById: null,
      confirmedAt: null,
      payerName: 'Acme',
    };
    const receivable = {
      id: 'rec-1',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-1',
      customerName: 'Acme',
      outstandingAmount: new Prisma.Decimal(1500),
      paidAmount: new Prisma.Decimal(0),
      status: 'OPEN',
      sourceType: 'SalesOrder',
      sourceId: 'so-1',
    };
    const { prisma, state } = makeFinanceHarness({
      payment,
      receivable,
      fallbackUserId: 'user-sys',
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-1', journalNumber: 'JE-1' });

    await service.confirmForCompany('pay-1', 'actor-1', 'company-1');

    // status flipped to SUCCESS
    expect(state.payment.status).toBe(ExternalPaymentStatus.SUCCESS);

    // GL posted: DR cash 1000 / CR AR 1000, balanced
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    const posting = postingEngine.postLines.mock.calls[0][0];
    expect(posting.referenceType).toBe('ExternalPayment');
    expect(posting.referenceId).toBe('pay-1');
    const cashLine = posting.lines.find((l: any) => l.accountId === CASH_ACCT.id);
    const arLine = posting.lines.find((l: any) => l.accountId === AR_ACCT.id);
    expect(cashLine.debit.toString()).toBe('1000');
    expect(arLine.credit.toString()).toBe('1000');
    const dr = posting.lines.reduce((s: any, l: any) => s.plus(l.debit), new Prisma.Decimal(0));
    const cr = posting.lines.reduce((s: any, l: any) => s.plus(l.credit), new Prisma.Decimal(0));
    expect(dr.toString()).toBe(cr.toString());
    expect(posting.userId).toBe('user-sys'); // integration path resolved a real user

    // receivable relieved 1000 → outstanding 500, PARTIALLY_PAID
    expect(state.receivable.outstandingAmount.toString()).toBe('500');
    expect(state.receivable.paidAmount.toString()).toBe('1000');
    expect(state.receivable.status).toBe('PARTIALLY_PAID');

    // sales order synced + cash balance bumped
    expect(state.salesOrderUpdate).toMatchObject({ paymentStatus: 'PARTIALLY_PAID' });
    expect(state.cashAccount.currentBalance.toString()).toBe('1000');
    // the receiving account is stamped on the payment row (same tx as the bump)
    // so reversal unwinds exactly this account
    expect(state.payment.receivingCashAccountId).toBe('cash-1');
  });

  it('is idempotent: re-confirming a SUCCESS payment posts nothing', async () => {
    const payment = {
      id: 'pay-2',
      paymentNumber: 'PAY-2',
      companyId: 'company-1',
      amount: new Prisma.Decimal(500),
      currency: 'TZS',
      paymentMethod: 'MOBILE_MONEY',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-2',
      status: ExternalPaymentStatus.SUCCESS,
      confirmedById: null,
      initiatedById: null,
      confirmedAt: new Date(),
    };
    const { prisma } = makeFinanceHarness({ payment });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);

    await service.confirmForCompany('pay-2', 'actor-1', 'company-1');

    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('standalone receipt (no receivable) credits a customer-advance account', async () => {
    const payment = {
      id: 'pay-3',
      paymentNumber: 'PAY-3',
      companyId: 'company-1',
      amount: new Prisma.Decimal(700),
      currency: 'TZS',
      paymentMethod: 'MOBILE_MONEY',
      paymentContextType: ExternalPaymentContext.GENERAL,
      paymentContextId: null,
      status: ExternalPaymentStatus.INITIATED,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: null,
      payerName: 'Walk-in',
    };
    const { prisma, state } = makeFinanceHarness({
      payment,
      receivable: undefined,
      advanceAccountId: 'coa-advance',
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-3', journalNumber: 'JE-3' });

    await service.confirmForCompany('pay-3', 'actor-1', 'company-1');

    const posting = postingEngine.postLines.mock.calls[0][0];
    const advLine = posting.lines.find((l: any) => l.accountId === 'coa-advance');
    expect(advLine.credit.toString()).toBe('700');
    // no AR credit line (no receivable)
    expect(posting.lines.find((l: any) => l.accountId === AR_ACCT.id)).toBeUndefined();
    // balanced
    const dr = posting.lines.reduce((s: any, l: any) => s.plus(l.debit), new Prisma.Decimal(0));
    const cr = posting.lines.reduce((s: any, l: any) => s.plus(l.credit), new Prisma.Decimal(0));
    expect(dr.toString()).toBe(cr.toString());
    expect(state.cashAccount.currentBalance.toString()).toBe('700');
  });

  it('overpayment beyond outstanding splits CR AR (outstanding) + CR advance (remainder)', async () => {
    const payment = {
      id: 'pay-4',
      paymentNumber: 'PAY-4',
      companyId: 'company-1',
      amount: new Prisma.Decimal(1200),
      currency: 'TZS',
      paymentMethod: 'CARD',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-4',
      status: ExternalPaymentStatus.INITIATED,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: null,
    };
    const receivable = {
      id: 'rec-4',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-4',
      customerName: 'Beta',
      outstandingAmount: new Prisma.Decimal(1000),
      paidAmount: new Prisma.Decimal(0),
      status: 'OPEN',
      sourceType: null,
      sourceId: null,
    };
    const { prisma, state } = makeFinanceHarness({
      payment,
      receivable,
      advanceAccountId: 'coa-advance',
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-4', journalNumber: 'JE-4' });

    await service.confirmForCompany('pay-4', 'actor-1', 'company-1');

    const posting = postingEngine.postLines.mock.calls[0][0];
    const arLine = posting.lines.find((l: any) => l.accountId === AR_ACCT.id);
    const advLine = posting.lines.find((l: any) => l.accountId === 'coa-advance');
    expect(arLine.credit.toString()).toBe('1000');
    expect(advLine.credit.toString()).toBe('200');
    // receivable fully paid
    expect(state.receivable.outstandingAmount.toString()).toBe('0');
    expect(state.receivable.status).toBe('PAID');
  });

  it("SALES_ORDER context resolves the order's receivable and relieves it", async () => {
    const payment = {
      id: 'pay-5',
      paymentNumber: 'PAY-5',
      companyId: 'company-1',
      amount: new Prisma.Decimal(300),
      currency: 'TZS',
      paymentMethod: 'MOBILE_MONEY',
      paymentContextType: ExternalPaymentContext.SALES_ORDER,
      paymentContextId: 'so-5',
      status: ExternalPaymentStatus.INITIATED,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: null,
    };
    const receivable = {
      id: 'rec-5',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-5',
      customerName: 'Gamma',
      outstandingAmount: new Prisma.Decimal(300),
      paidAmount: new Prisma.Decimal(0),
      status: 'OPEN',
      sourceType: 'SalesOrder',
      sourceId: 'so-5',
    };
    const { prisma, state } = makeFinanceHarness({
      payment,
      receivable,
      salesOrder: { receivableId: 'rec-5' },
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-5', journalNumber: 'JE-5' });

    await service.confirmForCompany('pay-5', 'actor-1', 'company-1');

    expect(prisma.$transaction).toHaveBeenCalled();
    const posting = postingEngine.postLines.mock.calls[0][0];
    const arLine = posting.lines.find((l: any) => l.accountId === AR_ACCT.id);
    expect(arLine.credit.toString()).toBe('300');
    expect(state.receivable.status).toBe('PAID');
  });

  it('confirm into a locked accounting period throws and rolls back the status flip', async () => {
    // Main's postLines validates the period lock INSIDE the caller-supplied
    // transaction (posting-engine.service.ts, accountingControl.assertPostingAllowed
    // runs immediately before the JournalEntry insert). When it throws, the whole
    // confirm transaction — including the SUCCESS status claim and the receivable
    // relief that ran before the posting — must roll back, leaving the payment
    // confirmable again once the period is reopened.
    const payment = {
      id: 'pay-6',
      paymentNumber: 'PAY-6',
      companyId: 'company-1',
      amount: new Prisma.Decimal(400),
      currency: 'TZS',
      paymentMethod: 'BANK_TRANSFER',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-6',
      status: ExternalPaymentStatus.INITIATED,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: null,
      payerName: 'Epsilon',
    };
    const receivable = {
      id: 'rec-6',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-6',
      customerName: 'Epsilon',
      outstandingAmount: new Prisma.Decimal(400),
      paidAmount: new Prisma.Decimal(0),
      status: 'OPEN',
      sourceType: null,
      sourceId: null,
    };
    const { prisma, tx, state } = makeFinanceHarness({ payment, receivable });
    const { service, auditLogs, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockRejectedValue(
      new BadRequestException(
        'Posting rejected: accounting period 2026-07 is LOCKED for company company-1',
      ),
    );

    await expect(service.confirmForCompany('pay-6', 'actor-1', 'company-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // The flip was attempted inside the transaction (same tx as the posting)…
    expect(tx.externalPayment.updateMany).toHaveBeenCalledTimes(1);
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    // …and the rollback undid it plus every subledger side-effect.
    expect(state.payment.status).toBe(ExternalPaymentStatus.INITIATED);
    expect(state.receivable.outstandingAmount.toString()).toBe('400');
    expect(state.receivable.paidAmount.toString()).toBe('0');
    expect(state.receivable.status).toBe('OPEN');
    expect(state.cashAccount.currentBalance.toString()).toBe('0');
    // no CONFIRMED audit trail for a confirm that did not land
    expect(auditLogs.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXTERNAL_PAYMENT_CONFIRMED' }),
    );
  });

  it('currency mismatch: does NOT relieve the receivable — the full amount is routed to customer advance', async () => {
    // A USD receipt against a TZS receivable must never relieve it 1:1 by bare
    // numeric amount (off by the full exchange rate). The money is already
    // captured by the provider so the confirm still posts — but entirely as a
    // customer advance, leaving the receivable untouched.
    const payment = {
      id: 'pay-fx',
      paymentNumber: 'PAY-FX',
      companyId: 'company-1',
      amount: new Prisma.Decimal(100),
      currency: 'USD',
      paymentMethod: 'BANK_TRANSFER',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-fx',
      status: ExternalPaymentStatus.INITIATED,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: null,
      payerName: 'ForexCo',
    };
    const receivable = {
      id: 'rec-fx',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-fx',
      customerName: 'ForexCo',
      outstandingAmount: new Prisma.Decimal(250000),
      paidAmount: new Prisma.Decimal(0),
      status: 'OPEN',
      currency: 'TZS',
      sourceType: null,
      sourceId: null,
    };
    const { prisma, tx, state } = makeFinanceHarness({
      payment,
      receivable,
      cashAccount: null, // no USD cash account exists — GL-only posting
      advanceAccountId: 'coa-advance',
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-fx', journalNumber: 'JE-FX' });

    await service.confirmForCompany('pay-fx', 'actor-1', 'company-1');

    // GL: DR cash 100 / CR advance 100 — NO AR relief line
    const posting = postingEngine.postLines.mock.calls[0][0];
    expect(posting.lines.find((l: any) => l.accountId === AR_ACCT.id)).toBeUndefined();
    const advLine = posting.lines.find((l: any) => l.accountId === 'coa-advance');
    expect(advLine.credit.toString()).toBe('100');
    const dr = posting.lines.reduce((s: any, l: any) => s.plus(l.debit), new Prisma.Decimal(0));
    const cr = posting.lines.reduce((s: any, l: any) => s.plus(l.credit), new Prisma.Decimal(0));
    expect(dr.toString()).toBe(cr.toString());

    // the TZS receivable is completely untouched
    expect(tx.receivable.update).not.toHaveBeenCalled();
    expect(state.receivable.outstandingAmount.toString()).toBe('250000');
    expect(state.receivable.paidAmount.toString()).toBe('0');
    expect(state.receivable.status).toBe('OPEN');

    // no cash account matched → nothing stamped, no cache bumped
    expect(tx.externalPayment.update).not.toHaveBeenCalled();
  });
});

describe('ExternalPaymentsService reverse → mirror unwind', () => {
  it('posts the mirror JE, restores the receivable, and decrements CashAccount balance', async () => {
    const payment = {
      id: 'pay-r',
      paymentNumber: 'PAY-R',
      companyId: 'company-1',
      amount: new Prisma.Decimal(1000),
      currency: 'TZS',
      paymentMethod: 'BANK_TRANSFER',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-r',
      status: ExternalPaymentStatus.SUCCESS,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: new Date(),
    };
    const receivable = {
      id: 'rec-r',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-r',
      customerName: 'Delta',
      // state AFTER the original relief of 1000 against a 1000 receivable
      outstandingAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(1000),
      status: 'PAID',
      sourceType: 'SalesOrder',
      sourceId: 'so-r',
    };
    const { prisma, state } = makeFinanceHarness({
      payment,
      receivable,
      cashAccount: {
        id: 'cash-1',
        companyId: 'company-1',
        accountType: 'BANK',
        accountName: 'Main Bank',
        currency: 'TZS',
        currentBalance: new Prisma.Decimal(1000),
        divisionId: null,
        branchId: null,
      },
    });
    // seed the original JE so reverse can find + mirror it
    state.journalEntries.push({
      id: 'je-orig',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      status: 'POSTED',
      lines: [
        {
          accountId: CASH_ACCT.id,
          debit: new Prisma.Decimal(1000),
          credit: new Prisma.Decimal(0),
          description: 'cash',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: AR_ACCT.id,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(1000),
          description: 'Settle receivable: Delta',
          divisionId: null,
          branchId: null,
        },
      ],
    });

    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-rev', journalNumber: 'JE-REV' });

    await service.reverseForCompany('pay-r', 'actor-1', 'company-1');

    expect(state.payment.status).toBe(ExternalPaymentStatus.REVERSED);

    // mirror JE: swap Dr/Cr
    const posting = postingEngine.postLines.mock.calls[0][0];
    const cashLine = posting.lines.find((l: any) => l.accountId === CASH_ACCT.id);
    const arLine = posting.lines.find((l: any) => l.accountId === AR_ACCT.id);
    expect(cashLine.credit.toString()).toBe('1000'); // was debit
    expect(arLine.debit.toString()).toBe('1000'); // was credit

    // original JE marked REVERSED
    expect(state.journalEntries[0].status).toBe('REVERSED');

    // receivable restored
    expect(state.receivable.outstandingAmount.toString()).toBe('1000');
    expect(state.receivable.paidAmount.toString()).toBe('0');
    expect(state.receivable.status).toBe('OPEN');

    // cash balance decremented back to 0
    expect(state.cashAccount.currentBalance.toString()).toBe('0');
  });

  it('is idempotent: re-reversing a REVERSED payment posts nothing', async () => {
    const payment = {
      id: 'pay-r2',
      paymentNumber: 'PAY-R2',
      companyId: 'company-1',
      amount: new Prisma.Decimal(100),
      currency: 'TZS',
      paymentMethod: 'MOBILE_MONEY',
      paymentContextType: ExternalPaymentContext.GENERAL,
      paymentContextId: null,
      status: ExternalPaymentStatus.REVERSED,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: new Date(),
    };
    const { prisma } = makeFinanceHarness({ payment });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);

    await service.reverseForCompany('pay-r2', 'actor-1', 'company-1');

    expect(postingEngine.postLines).not.toHaveBeenCalled();
  });

  it('restores only what THIS payment applied (from the JE AR line), not the full payment amount', async () => {
    // Receivable 1500: a customer-payment relieved 500 first; this external
    // payment of 1200 then applied 1000 to AR and parked 200 as advance
    // (post-confirm state: paid=1500, outstanding=0, PAID). Reversing must
    // restore exactly 1000 — restoring min(1200, paidAmount)=1200 would erase
    // part of the other payment's relief and diverge from the mirror JE, which
    // only debits AR 1000.
    const payment = {
      id: 'pay-ov',
      paymentNumber: 'PAY-OV',
      companyId: 'company-1',
      amount: new Prisma.Decimal(1200),
      currency: 'TZS',
      paymentMethod: 'BANK_TRANSFER',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-ov',
      status: ExternalPaymentStatus.SUCCESS,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: new Date(),
      receivingCashAccountId: 'cash-1',
    };
    const receivable = {
      id: 'rec-ov',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-ov',
      customerName: 'Acme',
      outstandingAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(1500), // 500 customer-payment + 1000 this payment
      status: 'PAID',
      currency: 'TZS',
      sourceType: null,
      sourceId: null,
    };
    const { prisma, state } = makeFinanceHarness({ payment, receivable });
    state.journalEntries.push({
      id: 'je-ov',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      status: 'POSTED',
      lines: [
        {
          accountId: CASH_ACCT.id,
          debit: new Prisma.Decimal(1200),
          credit: new Prisma.Decimal(0),
          description: 'External payment PAY-OV received (BANK_TRANSFER)',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: AR_ACCT.id,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(1000),
          description: 'Settle receivable: Acme',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'coa-advance',
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(200),
          description: 'Customer advance / credit on account: Acme',
          divisionId: null,
          branchId: null,
        },
      ],
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-rev', journalNumber: 'JE-REV' });

    await service.reverseForCompany('pay-ov', 'actor-1', 'company-1');

    // subledger restored by exactly the 1000 this payment applied — the other
    // payment's 500 relief survives
    expect(state.receivable.outstandingAmount.toString()).toBe('1000');
    expect(state.receivable.paidAmount.toString()).toBe('500');
    expect(state.receivable.status).toBe('PARTIALLY_PAID');

    // and the mirror JE agrees: AR debited 1000, not 1200
    const posting = postingEngine.postLines.mock.calls[0][0];
    const arLine = posting.lines.find((l: any) => l.accountId === AR_ACCT.id);
    expect(arLine.debit.toString()).toBe('1000');
  });

  it('receivable already PAID at confirm (pure advance receipt): reverse never touches the receivable', async () => {
    // Confirm found the receivable PAID, so the whole 700 was parked as an
    // advance — in the AR-control fallback line, which also credits AR control
    // but must NOT count as applied relief. Reverse must not reopen a
    // receivable this payment never relieved (the mirror JE has no
    // "Settle receivable" AR movement to back it).
    const payment = {
      id: 'pay-pd',
      paymentNumber: 'PAY-PD',
      companyId: 'company-1',
      amount: new Prisma.Decimal(700),
      currency: 'TZS',
      paymentMethod: 'MOBILE_MONEY',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-pd',
      status: ExternalPaymentStatus.SUCCESS,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: new Date(),
      receivingCashAccountId: 'cash-1',
    };
    const receivable = {
      id: 'rec-pd',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-pd',
      customerName: 'Zeta',
      outstandingAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(1500), // settled entirely by OTHER payments
      status: 'PAID',
      currency: 'TZS',
      sourceType: null,
      sourceId: null,
    };
    const { prisma, tx, state } = makeFinanceHarness({ payment, receivable });
    state.journalEntries.push({
      id: 'je-pd',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      status: 'POSTED',
      lines: [
        {
          accountId: CASH_ACCT.id,
          debit: new Prisma.Decimal(700),
          credit: new Prisma.Decimal(0),
          description: 'External payment PAY-PD received (MOBILE_MONEY)',
          divisionId: null,
          branchId: null,
        },
        {
          // credits AR control, but is the advance-held fallback — NOT relief
          accountId: AR_ACCT.id,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(700),
          description:
            'Customer advance held in AR (no customer-advance account configured): Zeta',
          divisionId: null,
          branchId: null,
        },
      ],
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-rev', journalNumber: 'JE-REV' });

    await service.reverseForCompany('pay-pd', 'actor-1', 'company-1');

    // status flipped and the mirror JE posted (cash + advance-in-AR unwound)…
    expect(state.payment.status).toBe(ExternalPaymentStatus.REVERSED);
    expect(postingEngine.postLines).toHaveBeenCalledTimes(1);
    // …but the receivable was never touched: this payment applied 0 to it
    expect(tx.receivable.update).not.toHaveBeenCalled();
    expect(state.receivable.outstandingAmount.toString()).toBe('0');
    expect(state.receivable.paidAmount.toString()).toBe('1500');
    expect(state.receivable.status).toBe('PAID');
  });

  it('legacy no-JE confirm (pre-posting-path): reverse is a pure status flip touching nothing', async () => {
    // Payments confirmed before this posting path existed have no JE, posted no
    // relief, and bumped no cash cache. Reversing one must not restore a
    // receivable other payments legitimately relieved (that would move the
    // subledger with zero GL counterpart).
    const payment = {
      id: 'pay-lg',
      paymentNumber: 'PAY-LG',
      companyId: 'company-1',
      amount: new Prisma.Decimal(800),
      currency: 'TZS',
      paymentMethod: 'MOBILE_MONEY',
      paymentContextType: ExternalPaymentContext.RECEIVABLE,
      paymentContextId: 'rec-lg',
      status: ExternalPaymentStatus.SUCCESS,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: new Date(),
      receivingCashAccountId: null,
    };
    const receivable = {
      id: 'rec-lg',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      customerId: 'cust-lg',
      customerName: 'Legacy Co',
      outstandingAmount: new Prisma.Decimal(400),
      paidAmount: new Prisma.Decimal(600), // relieved via customer-payments, NOT this payment
      status: 'PARTIALLY_PAID',
      currency: 'TZS',
      sourceType: null,
      sourceId: null,
    };
    // NO journal entries seeded — legacy confirm was a pure status flip.
    const { prisma, tx, state } = makeFinanceHarness({ payment, receivable });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);

    await service.reverseForCompany('pay-lg', 'actor-1', 'company-1');

    // reversed as a pure status flip…
    expect(state.payment.status).toBe(ExternalPaymentStatus.REVERSED);
    // …with NO subledger, GL, or cash-cache movement of any kind
    expect(tx.receivable.update).not.toHaveBeenCalled();
    expect(state.receivable.outstandingAmount.toString()).toBe('400');
    expect(state.receivable.paidAmount.toString()).toBe('600');
    expect(state.receivable.status).toBe('PARTIALLY_PAID');
    expect(postingEngine.postLines).not.toHaveBeenCalled();
    expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
    expect(state.cashAccount.currentBalance.toString()).toBe('0');
  });

  it('unwinds exactly the persisted receiving cash account, not a re-resolved one', async () => {
    // Confirm stamped receivingCashAccountId='cash-old'. The roster has since
    // changed (re-resolution would now return 'cash-new'). Reverse must
    // decrement the stored account — without re-resolving and without an
    // isActive filter — so a deactivated account is still unwound.
    const payment = {
      id: 'pay-st',
      paymentNumber: 'PAY-ST',
      companyId: 'company-1',
      amount: new Prisma.Decimal(500),
      currency: 'TZS',
      paymentMethod: 'BANK_TRANSFER',
      paymentContextType: ExternalPaymentContext.GENERAL,
      paymentContextId: null,
      status: ExternalPaymentStatus.SUCCESS,
      confirmedById: 'user-1',
      initiatedById: null,
      confirmedAt: new Date(),
      receivingCashAccountId: 'cash-old',
    };
    const { prisma, tx, state } = makeFinanceHarness({
      payment,
      cashAccount: {
        id: 'cash-new', // what re-resolution would (wrongly) pick today
        companyId: 'company-1',
        accountType: 'BANK',
        accountName: 'New Bank',
        currency: 'TZS',
        currentBalance: new Prisma.Decimal(0),
        divisionId: null,
        branchId: null,
      },
    });
    state.journalEntries.push({
      id: 'je-st',
      companyId: 'company-1',
      divisionId: null,
      branchId: null,
      status: 'POSTED',
      lines: [
        {
          accountId: CASH_ACCT.id,
          debit: new Prisma.Decimal(500),
          credit: new Prisma.Decimal(0),
          description: 'External payment PAY-ST received (BANK_TRANSFER)',
          divisionId: null,
          branchId: null,
        },
        {
          accountId: 'coa-advance',
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(500),
          description: 'Customer advance / credit on account: payer',
          divisionId: null,
          branchId: null,
        },
      ],
    });
    const { service, postingEngine, accountResolver } = makeService({ prisma });
    wireResolver(accountResolver);
    postingEngine.postLines.mockResolvedValue({ id: 'je-rev', journalNumber: 'JE-REV' });

    await service.reverseForCompany('pay-st', 'actor-1', 'company-1');

    // no re-resolution happened at all…
    expect(tx.cashAccount.findFirst).not.toHaveBeenCalled();
    // …and the decrement targeted exactly the stored account, sans isActive filter
    expect(tx.cashAccount.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = tx.cashAccount.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 'cash-old', companyId: 'company-1' });
    expect(data.currentBalance.decrement.toString()).toBe('500');
  });
});
