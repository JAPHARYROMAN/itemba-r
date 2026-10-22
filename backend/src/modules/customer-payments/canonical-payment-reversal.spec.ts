import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerPaymentsService } from './customer-payments.service';
import { SupplierPaymentsService } from '../supplier-payments/supplier-payments.service';

jest.mock('../party-balance/party-balance.helper', () => ({
  refreshCachedPartyBalance: jest.fn(async () => {}),
}));

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const user: AuthUser = {
  id: 'actor',
  email: 'actor@example.test',
  roles: [],
  permissions: [],
  roleScopes: [],
  companyAccess: [{ companyId: 'company', accessLevel: 'MANAGE' }],
  divisionAccess: [],
  branchAccess: [{ branchId: 'branch-a', accessLevel: 'MANAGE' }],
};
function copy<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, copy(row)])) as T;
  return value;
}

function fixture(kind: 'customer' | 'supplier') {
  const customer = kind === 'customer';
  const referenceType = customer ? 'CustomerPayment' : 'SupplierPayment';
  let state: any = {
    payment: {
      id: 'payment',
      paymentNumber: 'PAY-1',
      companyId: 'company',
      divisionId: 'division-a',
      branchId: 'branch-a',
      currency: 'TZS',
      customerId: 'party',
      supplierId: 'party',
      amount: D(100),
      status: 'COMPLETED',
      journalEntryId: 'journal',
      reversalJournalEntryId: null,
      cashAccountId: 'cash',
      notes: 'Original remittance note',
      sourceType: 'Payable',
      cashDeskMovementId: null,
      deskPayment: null,
      deletedAt: null,
      allocations: [
        customer
          ? { receivableId: 'document', amount: D(100) }
          : { payableId: 'document', amount: D(100) },
      ],
    },
    documents: [
      {
        id: 'document',
        companyId: 'company',
        divisionId: 'division-a',
        branchId: 'branch-a',
        customerId: 'party',
        supplierId: 'party',
        amount: D(100),
        outstandingAmount: D(0),
        paidAmount: D(100),
        status: 'PAID',
        currency: 'TZS',
        sourceType: null,
        sourceId: null,
      },
    ],
    cash: {
      id: 'cash',
      companyId: 'company',
      divisionId: 'division-a',
      branchId: 'branch-a',
      currency: 'TZS',
    },
    cashBalance: D(1000),
    carried: null,
    journal: {
      id: 'journal',
      companyId: 'company',
      divisionId: 'division-a',
      branchId: 'branch-a',
      status: 'POSTED',
      deletedAt: null,
      referenceType,
      referenceId: 'payment',
      lines: [
        {
          accountId: 'control',
          debit: D(customer ? 0 : 100),
          credit: D(customer ? 100 : 0),
          partyType: customer ? 'CUSTOMER' : 'SUPPLIER',
          customerId: customer ? 'party' : null,
          supplierId: customer ? null : 'party',
        },
        {
          accountId: 'cash-ledger',
          debit: D(customer ? 100 : 0),
          credit: D(customer ? 0 : 100),
          partyType: 'NONE',
        },
      ],
    },
    mirrors: [],
    audits: [],
  };
  const payment = {
    updateMany: jest.fn(async ({ where, data }) => {
      if (state.payment.status !== where.status || state.payment.deletedAt) return { count: 0 };
      Object.assign(state.payment, copy(data));
      return { count: 1 };
    }),
    findFirst: jest.fn(async () => copy(state.payment)),
    update: jest.fn(async ({ data }) => {
      Object.assign(state.payment, copy(data));
      return copy(state.payment);
    }),
  };
  const document = {
    update: jest.fn(async ({ where, data }) => {
      const row = state.documents.find((item: any) => item.id === where.id);
      Object.assign(row, copy(data));
      return copy(row);
    }),
  };
  const tx: any = {
    $queryRaw: jest.fn(async (strings, ...values) => {
      const sql = Array.from(strings.strings ?? strings).join('?');
      return sql.includes('FROM "receivables"') || sql.includes('FROM "payables"')
        ? copy(state.documents.filter((row: any) => row.id === values[0]))
        : [];
    }),
    customerPayment: payment,
    supplierPayment: payment,
    receivable: document,
    payable: document,
    cashAccount: {
      findFirst: jest.fn(async () => copy(state.cash)),
      updateMany: jest.fn(async ({ data }) => {
        if (!state.cash) return { count: 0 };
        state.cashBalance = data.currentBalance.increment
          ? state.cashBalance.plus(data.currentBalance.increment)
          : state.cashBalance.minus(data.currentBalance.decrement);
        return { count: 1 };
      }),
    },
    cashDeskMovement: { findUnique: jest.fn(async () => copy(state.carried)) },
    journalEntry: {
      findFirst: jest.fn(async () => copy(state.journal)),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!state.journal || state.journal.status !== where.status || state.journal.deletedAt)
          return { count: 0 };
        Object.assign(state.journal, copy(data));
        return { count: 1 };
      }),
    },
    supplierInvoice: { findMany: jest.fn(async () => []) },
    purchaseOrder: { findMany: jest.fn(async () => []) },
    salesOrder: { findFirst: jest.fn(async () => null) },
  };
  const prisma: any = {
    $transaction: jest.fn(async (run) => {
      const before = copy(state);
      try {
        return await run(tx);
      } catch (error) {
        state = before;
        throw error;
      }
    }),
  };
  const company = {
    assertCanAccessCompany: jest.fn(async (_actor, companyId) => {
      if (companyId !== 'company') throw new ForbiddenException('Wrong company');
    }),
  };
  const posting = {
    postLines: jest.fn(async (input, transaction) => {
      expect(transaction).toBe(tx);
      state.mirrors.push(copy(input));
      return { id: 'mirror', journalNumber: 'JE-MIRROR' };
    }),
  };
  const audit = {
    logStrictInTransaction: jest.fn(async (transaction, row) => {
      expect(transaction).toBe(tx);
      state.audits.push(copy(row));
    }),
  };
  const cashBook = { reverseInTransaction: jest.fn(async () => ({ id: 'cash-mirror' })) };
  const resolver = {} as any;
  const codes = {} as any;
  const service = customer
    ? new CustomerPaymentsService(
        prisma,
        audit as any,
        company as any,
        resolver,
        posting as any,
        codes,
        cashBook as any,
      )
    : new SupplierPaymentsService(
        prisma,
        audit as any,
        company as any,
        resolver,
        posting as any,
        codes,
        cashBook as any,
      );
  const reverse = (actor = user, reason = 'Incorrect payment amount') =>
    service.reverse('payment', { reason } as any, actor);
  return { state: () => state, tx, prisma, service, posting, audit, cashBook, reverse };
}

describe.each(['customer', 'supplier'] as const)('%s canonical reversal guards', (kind) => {
  it.each(['payment', 'cash', 'second allocated document'])(
    'requires MANAGE scope over the %s and rolls back its claim',
    async (area) => {
      const f = fixture(kind);
      if (area === 'payment') f.state().payment.branchId = 'branch-b';
      if (area === 'cash') f.state().cash.branchId = 'branch-b';
      if (area === 'second allocated document') {
        f.state().documents.push({
          ...copy(f.state().documents[0]),
          id: 'second',
          branchId: 'branch-b',
        });
        f.state().payment.allocations.push(
          kind === 'customer'
            ? { receivableId: 'second', amount: D(100) }
            : { payableId: 'second', amount: D(100) },
        );
        f.state().payment.amount = D(200);
        f.state().journal.lines[0].debit = D(kind === 'customer' ? 0 : 200);
        f.state().journal.lines[0].credit = D(kind === 'customer' ? 200 : 0);
        f.state().journal.lines[1].debit = D(kind === 'customer' ? 200 : 0);
        f.state().journal.lines[1].credit = D(kind === 'customer' ? 0 : 200);
      }
      await expect(f.reverse()).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.state().payment.status).toBe('COMPLETED');
      expect(
        f
          .state()
          .documents.every((row: any) => row.paidAmount.eq(100) && row.outstandingAmount.isZero()),
      ).toBe(true);
      expect(f.state().cashBalance.toNumber()).toBe(1000);
      expect(f.state().mirrors).toHaveLength(0);
      expect(f.audit.logStrictInTransaction).not.toHaveBeenCalled();
    },
  );

  it('does not accept WRITE access for a financial reversal', async () => {
    const f = fixture(kind);
    await expect(
      f.reverse({ ...user, branchAccess: [{ branchId: 'branch-a', accessLevel: 'WRITE' }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.state().payment.status).toBe('COMPLETED');
  });

  it.each([
    'nonpositive allocation',
    'insufficient paid balance',
    'negative outstanding',
    'allocation total exceeds cash',
  ])('rejects inconsistent exact-delta evidence: %s', async (problem) => {
    const f = fixture(kind);
    if (problem === 'nonpositive allocation') f.state().payment.allocations[0].amount = D(0);
    if (problem === 'insufficient paid balance') f.state().documents[0].paidAmount = D(99);
    if (problem === 'negative outstanding') f.state().documents[0].outstandingAmount = D(-1);
    if (problem === 'allocation total exceeds cash') f.state().payment.amount = D(99);
    await expect(f.reverse()).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().payment.status).toBe('COMPLETED');
    expect(f.state().journal.status).toBe('POSTED');
    expect(f.state().cashBalance.toNumber()).toBe(1000);
    expect(f.state().mirrors).toHaveLength(0);
    expect(f.audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'REVERSED', 'deleted', 'missing', 'foreign payment'])(
    'does not mirror %s journal evidence',
    async (badEvidence) => {
      const f = fixture(kind);
      if (badEvidence === 'missing') f.state().journal = null;
      else if (badEvidence === 'deleted') f.state().journal.deletedAt = new Date();
      else if (badEvidence === 'foreign payment') f.state().journal.referenceId = 'somebody-else';
      else f.state().journal.status = badEvidence;
      await expect(f.reverse()).rejects.toBeInstanceOf(ConflictException);
      expect(f.state().payment.status).toBe('COMPLETED');
      expect(f.state().documents[0].paidAmount.toNumber()).toBe(100);
      expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(0);
      expect(f.state().cashBalance.toNumber()).toBe(1000);
      expect(f.state().mirrors).toHaveLength(0);
    },
  );

  it('claims only a POSTED original, preserves notes, and records the reason atomically', async () => {
    const f = fixture(kind);
    await f.reverse();
    expect(f.tx.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'POSTED', deletedAt: null }),
      }),
    );
    expect(f.tx.journalEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'journal', status: 'POSTED', deletedAt: null } }),
    );
    expect(f.state().payment.notes).toBe('Original remittance note');
    expect(f.state().journal.reversalReason).toBe('Incorrect payment amount');
    expect(f.state().documents[0].paidAmount.toNumber()).toBe(0);
    expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(100);
    expect(f.state().cashBalance.toNumber()).toBe(kind === 'customer' ? 900 : 1100);
    expect(f.tx.cashAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company',
          divisionId: 'division-a',
          branchId: 'branch-a',
          currency: 'TZS',
        }),
      }),
    );
    expect(f.state().mirrors).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
  });

  it('aborts on a lost original-journal claim or a cash row disappearing after authorization', async () => {
    const f = fixture(kind);
    f.tx.journalEntry.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.reverse()).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().payment.status).toBe('COMPLETED');
    f.tx.cashAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.reverse()).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().payment.status).toBe('COMPLETED');
    expect(f.state().journal.status).toBe('POSTED');
    expect(f.state().mirrors).toHaveLength(0);
  });

  it('rolls back cash, subledger, payment, and mirror if strict audit fails', async () => {
    const f = fixture(kind);
    f.audit.logStrictInTransaction.mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(f.reverse()).rejects.toThrow('Audit unavailable');
    expect(f.state().payment.status).toBe('COMPLETED');
    expect(f.state().payment.notes).toBe('Original remittance note');
    expect(f.state().journal.status).toBe('POSTED');
    expect(f.state().documents[0].paidAmount.toNumber()).toBe(100);
    expect(f.state().cashBalance.toNumber()).toBe(1000);
    expect(f.state().mirrors).toHaveLength(0);
    expect(f.state().audits).toHaveLength(0);
  });

  it('rejects a punctuation-only reason before opening the transaction', async () => {
    const f = fixture(kind);
    await expect(f.reverse(user, '...')).rejects.toThrow('reversal reason');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

it('routes an Expense payment to its owner and preserves the trusted owner transaction path', async () => {
  const f = fixture('supplier');
  f.state().payment.sourceType = 'Expense';
  f.state().documents[0].sourceType = 'Expense';
  f.state().journal.referenceType = 'Expense';
  f.state().journal.referenceId = 'expense';
  await expect(f.reverse()).rejects.toThrow('in Expenses');
  expect(f.state().payment.status).toBe('COMPLETED');
  await f.prisma.$transaction((tx: any) =>
    (f.service as SupplierPaymentsService).reverseInTransaction(
      tx,
      user,
      'payment',
      'Owner expense correction',
      { fromDesk: true },
    ),
  );
  expect(f.state().payment.status).toBe('REVERSED');
  expect(f.state().mirrors).toHaveLength(1);
});

it('blocks a customer Cash Desk-owned movement at the public endpoint before changing its balances', async () => {
  const f = fixture('customer');
  f.state().carried = { id: 'movement', journalEntryId: null };
  await expect(f.reverse()).rejects.toThrow('in Cash Desk');
  expect(f.state().payment.status).toBe('COMPLETED');
  expect(f.state().documents[0].paidAmount.toNumber()).toBe(100);
  expect(f.state().mirrors).toHaveLength(0);
  expect(f.cashBook.reverseInTransaction).not.toHaveBeenCalled();
});

it('blocks an Expense allocation even when its old payment header only says Payable', async () => {
  const f = fixture('supplier');
  f.state().documents[0].sourceType = 'Expense';
  await expect(f.reverse()).rejects.toThrow('in Expenses');
  expect(f.state().payment.status).toBe('COMPLETED');
  expect(f.state().mirrors).toHaveLength(0);
});

it('preserves Invoice Desk ownership even when its old payment backlink is missing', async () => {
  const f = fixture('supplier');
  f.state().payment.sourceType = 'InvoiceDeskInvoice';
  await expect(f.reverse()).rejects.toThrow('in Invoice Desk');
  expect(f.state().payment.status).toBe('COMPLETED');
  expect(f.state().mirrors).toHaveLength(0);
});
