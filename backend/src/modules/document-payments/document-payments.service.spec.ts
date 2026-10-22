import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { DocumentPaymentKind, DocumentPaymentsService } from './document-payments.service';

jest.mock('../party-balance/party-balance.helper', () => ({
  refreshCachedPartyBalance: jest.fn(async () => {}),
}));
jest.mock('../../common/services/pos-draft-policy', () => ({
  assertLegacyPosWriteAllowed: jest.fn(async () => {}),
}));

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const user: AuthUser = {
  id: 'actor',
  email: 'actor@example.test',
  roles: [],
  permissions: [
    'receivables.manage',
    'payables.manage',
    'customer-payments.manage',
    'supplier-payments.manage',
  ],
};
function copy<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T;
  return value;
}

function fixture(kind: DocumentPaymentKind = 'receivable') {
  const referenceType = kind === 'receivable' ? 'Receivable' : 'Payable';
  const number = kind === 'receivable' ? 'AR-1' : 'AP-1';
  const document = {
    id: 'document',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    customerId: null,
    supplierId: null,
    customerName: 'Unlinked',
    supplierName: 'Unlinked',
    receivableNumber: number,
    payableNumber: number,
    currency: 'TZS',
    amount: D(100),
    paidAmount: D(50),
    outstandingAmount: D(35),
    status: 'PARTIALLY_PAID',
    sourceType: null,
    sourceId: null,
    deletedAt: null,
  };
  const cash = {
    id: 'cash',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    currency: 'TZS',
    accountName: 'Drawer',
    ledgerAccountId: 'cash-ledger',
    currentBalance: D(1000),
    isActive: true,
    deletedAt: null,
  };
  const journal = {
    id: 'journal',
    journalNumber: 'JE-1',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    description: `${referenceType} settlement ${number}`,
    referenceType,
    referenceId: document.id,
    transactionDate: new Date('2026-10-01T00:00:00.000Z'),
    status: 'POSTED',
    totalDebit: D(20),
    totalCredit: D(20),
    reversedAt: null,
    reversalOfId: null,
    deletedAt: null,
    lines: [
      {
        accountId: 'control',
        companyId: 'company',
        debit: D(kind === 'payable' ? 20 : 0),
        credit: D(kind === 'receivable' ? 20 : 0),
        description: 'Control',
        partyType: 'NONE',
        customerId: null,
        supplierId: null,
      },
      {
        accountId: 'cash-ledger',
        companyId: 'company',
        debit: D(kind === 'receivable' ? 20 : 0),
        credit: D(kind === 'payable' ? 20 : 0),
        description: 'Cash',
        partyType: 'NONE',
        customerId: null,
        supplierId: null,
      },
    ],
  };
  const movement = {
    id: 'movement',
    journalEntryId: journal.id,
    requestId: `${referenceType}:${document.id}:${journal.id}`,
    journalReferenceType: referenceType,
    kind: kind === 'receivable' ? 'CUSTOMER_RECEIPT' : 'SUPPLIER_PAYMENT',
    amount: D(20),
    currency: 'TZS',
    receivableId: kind === 'receivable' ? document.id : null,
    payableId: kind === 'payable' ? document.id : null,
    reversedAt: null,
    reversalOfId: null,
    partyType: 'NONE',
    entries: [
      {
        amount: D(kind === 'receivable' ? 20 : -20),
        erpBalanceApplied: true,
        account: {
          id: 'desk',
          companyId: 'company',
          divisionId: 'division',
          branchId: 'branch',
          currency: 'TZS',
          erpCashAccountId: cash.id,
          erpCashAccount: cash,
        },
      },
    ],
  };
  let state = {
    document,
    cash,
    journal,
    movements: [movement] as any[],
    journals: [] as any[],
    audits: [] as any[],
    deskBalance: D(1000),
  };
  const documentDb = {
    findFirst: jest.fn(async () => copy(state.document)),
    update: jest.fn(async ({ data }) => {
      Object.assign(state.document, copy(data));
      return copy(state.document);
    }),
  };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    receivable: documentDb,
    payable: documentDb,
    customerPayment: {
      findFirst: jest.fn(async () => null as any),
      findMany: jest.fn(async () => [] as any[]),
    },
    supplierPayment: {
      findFirst: jest.fn(async () => null as any),
      findMany: jest.fn(async () => [] as any[]),
    },
    journalEntry: {
      findFirst: jest.fn(async () => copy(state.journal)),
      findMany: jest.fn(async () => [copy(state.journal)]),
      count: jest.fn(
        async () => state.journals.filter((j) => j.reversalOfId === state.journal.id).length,
      ),
      updateMany: jest.fn(async ({ data }) => {
        if (state.journal.status !== 'POSTED') return { count: 0 };
        Object.assign(state.journal, copy(data));
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = state.journals.find((j) => j.id === where.id);
        Object.assign(row, copy(data));
        return copy(row);
      }),
    },
    cashDeskMovement: {
      findMany: jest.fn(async () => {
        const rows = copy(state.movements);
        for (const row of rows) row.entries[0].account.erpCashAccount = copy(state.cash);
        return rows;
      }),
    },
    cashAccount: {
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.currentBalance?.gte && state.cash.currentBalance.lt(where.currentBalance.gte))
          return { count: 0 };
        state.cash.currentBalance = state.cash.currentBalance.plus(
          data.currentBalance.increment ?? D(data.currentBalance.decrement).negated(),
        );
        return { count: 1 };
      }),
    },
    salesOrder: { findMany: jest.fn(async () => [] as any[]), update: jest.fn(async () => ({})) },
    purchaseOrder: { findMany: jest.fn(async () => [] as any[]) },
    supplierInvoice: { findMany: jest.fn(async () => [] as any[]) },
    goodsReceivedNote: { findFirst: jest.fn(async () => null as any) },
  };
  const prisma = {
    ...tx,
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
  const scope = { assertCanAccessCompany: jest.fn(async () => {}) };
  const org = {
    assertCanAccessScope: jest.fn(
      async (
        _user: AuthUser,
        _division: string | null,
        _branch: string | null,
        _access: string,
      ) => {},
    ),
  };
  const resolver = { resolve: jest.fn(async () => ({ id: 'control' })) };
  const engine = {
    postLines: jest.fn(async (input, db) => {
      expect(db).toBe(tx);
      state.journals.push({ ...copy(input), id: 'reversal' });
      return { id: 'reversal', journalNumber: input.journalNumber };
    }),
  };
  const cashBook = {
    reverseInTransaction: jest.fn(async (db, actor, movementId, reason, journalId) => {
      expect(db).toBe(tx);
      const original = state.movements.find((m) => m.id === movementId);
      if (original.reversedAt) return null;
      original.reversedAt = new Date();
      state.deskBalance = state.deskBalance.plus(kind === 'receivable' ? -20 : 20);
      return { id: 'cash-reversal', journalEntryId: journalId };
    }),
  };
  const supplier = {
    lockPayable: jest.fn(async () => copy(state.document)),
    syncSupplierInvoices: jest.fn(async () => {}),
    syncPurchaseOrders: jest.fn(async () => {}),
  };
  const audit = {
    logStrictInTransaction: jest.fn(async (db, input) => {
      expect(db).toBe(tx);
      state.audits.push(copy(input));
    }),
  };
  const service = new DocumentPaymentsService(
    prisma as any,
    scope as any,
    org as any,
    resolver as any,
    engine as any,
    cashBook as any,
    supplier as any,
    audit as any,
  );
  return {
    service,
    tx,
    prisma,
    scope,
    org,
    engine,
    resolver,
    supplier,
    audit,
    cashBook,
    get state() {
      return state;
    },
  };
}

describe('DocumentPaymentsService legacy reversal', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['receivable', 'payable'] as const)(
    'restores only the %s payment delta, mirrors the original GL, and updates proven cash once',
    async (kind) => {
      const f = fixture(kind);
      await f.service.reverseLegacy(
        kind,
        'document',
        'journal',
        { reason: 'Wrong payment amount' },
        user,
      );
      expect(f.state.document.paidAmount.toFixed(2)).toBe('30.00');
      expect(f.state.document.outstandingAmount.toFixed(2)).toBe('55.00');
      expect(f.state.document.amount.toFixed(2)).toBe('100.00'); // Existing noncash relief of 15 survives.
      expect(f.state.cash.currentBalance.toFixed(2)).toBe(
        kind === 'receivable' ? '980.00' : '1020.00',
      );
      expect(f.state.deskBalance.eq(f.state.cash.currentBalance)).toBe(true);
      expect(f.state.journal.status).toBe('REVERSED');
      expect(f.state.journals).toHaveLength(1);
      expect(f.state.journals[0].reversalOfId).toBe('journal');
      expect(
        f.state.journals[0].lines.map((line: any) => [
          line.accountId,
          line.debit.toFixed(2),
          line.credit.toFixed(2),
        ]),
      ).toEqual(
        f.state.journal.lines.map((line) => [
          line.accountId,
          line.credit.toFixed(2),
          line.debit.toFixed(2),
        ]),
      );
      expect(f.cashBook.reverseInTransaction).toHaveBeenCalledTimes(1);
      expect(f.audit.logStrictInTransaction).toHaveBeenCalledTimes(1);
      expect(refreshCachedPartyBalance).toHaveBeenCalledWith(
        f.tx,
        kind === 'receivable' ? 'customer' : 'supplier',
        'company',
        null,
      );
      if (kind === 'payable') expect(f.supplier.syncPurchaseOrders).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a second reversal without posting or changing any balance', async () => {
    const f = fixture();
    await f.service.reverseLegacy(
      'receivable',
      'document',
      'journal',
      { reason: 'Duplicate payment' },
      user,
    );
    const before = copy(f.state);
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Duplicate payment' },
        user,
      ),
    ).rejects.toThrow(ConflictException);
    expect(f.state).toEqual(before);
    expect(f.engine.postLines).toHaveBeenCalledTimes(1);
  });

  it.each(['WRITTEN_OFF', 'CANCELLED'])('does not resurrect a %s document', async (status) => {
    const f = fixture();
    f.state.document.status = status;
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong receipt' },
        user,
      ),
    ).rejects.toThrow(ConflictException);
    expect(f.engine.postLines).not.toHaveBeenCalled();
  });

  it.each([
    [
      'no cash-book link',
      (f: ReturnType<typeof fixture>) => {
        f.state.movements = [];
      },
    ],
    [
      'two cash-book links',
      (f: ReturnType<typeof fixture>) => {
        f.state.movements.push(copy(f.state.movements[0]));
      },
    ],
    [
      'unproven ERP cache',
      (f: ReturnType<typeof fixture>) => {
        f.state.movements[0].entries[0].erpBalanceApplied = false;
      },
    ],
    [
      'different mapped cash GL',
      (f: ReturnType<typeof fixture>) => {
        f.state.cash.ledgerAccountId = 'other-cash-gl';
      },
    ],
    [
      'wrong signed cash amount',
      (f: ReturnType<typeof fixture>) => {
        f.state.movements[0].entries[0].amount = D(-20);
      },
    ],
    [
      'source-owned movement',
      (f: ReturnType<typeof fixture>) => {
        f.state.movements[0].salesPaymentId = 'sale-payment';
      },
    ],
    [
      'three-line journal',
      (f: ReturnType<typeof fixture>) => {
        f.state.journal.lines.push(copy(f.state.journal.lines[0]));
      },
    ],
    [
      'wrong settlement reference',
      (f: ReturnType<typeof fixture>) => {
        f.state.journal.referenceId = 'different-document';
      },
    ],
    [
      'insufficient paid amount',
      (f: ReturnType<typeof fixture>) => {
        f.state.document.paidAmount = D(10);
      },
    ],
  ] as const)('keeps %s read-only and blocks reversal', async (_label, alter) => {
    const f = fixture();
    alter(f);
    const before = copy(f.state);
    const history = await f.service.list('receivable', 'document', user);
    expect(history.data[0].canReverse).toBe(false);
    expect(history.data[0].reversalUnavailableReason).toBeTruthy();
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Incorrect payment' },
        user,
      ),
    ).rejects.toThrow(ConflictException);
    expect(f.state).toEqual(before);
    expect(f.engine.postLines).not.toHaveBeenCalled();
  });

  it('excludes a journal already owned by a canonical payment from legacy history', async () => {
    const f = fixture();
    f.tx.customerPayment.findFirst.mockResolvedValue({ id: 'payment' });
    expect((await f.service.list('receivable', 'document', user)).data).toHaveLength(0);
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Incorrect payment' },
        user,
      ),
    ).rejects.toThrow('canonical payment');
  });

  it('rolls back journal, cash book, cache, and document when strict audit fails', async () => {
    const f = fixture();
    const before = copy(f.state);
    f.audit.logStrictInTransaction.mockRejectedValue(new Error('Audit unavailable'));
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong payment' },
        user,
      ),
    ).rejects.toThrow('Audit unavailable');
    expect(f.state).toEqual(before);
  });

  it('rolls back when cash funds cannot be removed', async () => {
    const f = fixture();
    f.state.cash.currentBalance = D(5);
    const before = copy(f.state);
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong payment' },
        user,
      ),
    ).rejects.toThrow('insufficient funds');
    expect(f.state).toEqual(before);
  });

  it('requires document permission and meaningful reason before any transaction', async () => {
    const f = fixture();
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong payment' },
        { ...user, permissions: [] },
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      f.service.reverseLegacy('receivable', 'document', 'journal', { reason: '...' }, user),
    ).rejects.toThrow('meaningful reason');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires manage access to the proven cash scope and leaves restricted history read-only', async () => {
    const f = fixture();
    f.org.assertCanAccessScope.mockImplementation(
      async (_user: any, _division: any, _branch: any, access: any) => {
        if (access === 'MANAGE') throw new ForbiddenException();
      },
    );
    const history = await f.service.list('receivable', 'document', user);
    expect(history.data[0].canReverse).toBe(false);
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong receipt' },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(f.engine.postLines).not.toHaveBeenCalled();
  });

  it('uses a reversal date no earlier than the original journal', async () => {
    const f = fixture();
    f.state.journal.transactionDate = new Date('2099-01-01T00:00:00.000Z');
    await f.service.reverseLegacy(
      'receivable',
      'document',
      'journal',
      { reason: 'Wrong receipt' },
      user,
    );
    expect(f.state.journals[0].transactionDate).toEqual(f.state.journal.transactionDate);
  });

  it('refuses a cancelled backlink sales order even when the receivable source fields are empty', async () => {
    const f = fixture();
    f.tx.salesOrder.findMany.mockResolvedValue([
      {
        ...copy(f.state.document),
        receivableId: 'document',
        totalAmount: D(100),
        status: 'CANCELLED',
      },
    ]);
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong receipt' },
        user,
      ),
    ).rejects.toThrow('active source sales order');
    expect(f.engine.postLines).not.toHaveBeenCalled();
  });

  it('synchronizes a valid backlink sales order using the preserved noncash relief', async () => {
    const f = fixture();
    f.tx.salesOrder.findMany.mockResolvedValue([
      {
        ...copy(f.state.document),
        id: 'order',
        receivableId: 'document',
        totalAmount: D(100),
        status: 'CONFIRMED',
      },
    ]);
    await f.service.reverseLegacy(
      'receivable',
      'document',
      'journal',
      { reason: 'Wrong receipt' },
      user,
    );
    expect(f.tx.salesOrder.update).toHaveBeenCalledWith({
      where: { id: 'order' },
      data: { paidAmount: D(30), outstandingAmount: D(55), paymentStatus: 'PARTIALLY_PAID' },
    });
  });

  it('refuses a cancelled backlink supplier invoice', async () => {
    const f = fixture('payable');
    f.tx.supplierInvoice.findMany.mockResolvedValue([
      {
        ...copy(f.state.document),
        payableId: 'document',
        totalAmount: D(100),
        status: 'CANCELLED',
      },
    ]);
    await expect(
      f.service.reverseLegacy('payable', 'document', 'journal', { reason: 'Wrong payment' }, user),
    ).rejects.toThrow('active source supplier invoice');
    expect(f.engine.postLines).not.toHaveBeenCalled();
  });

  it('rolls back all changes if the cash-book movement was concurrently reversed', async () => {
    const f = fixture();
    const before = copy(f.state);
    f.cashBook.reverseInTransaction.mockResolvedValue(null);
    await expect(
      f.service.reverseLegacy(
        'receivable',
        'document',
        'journal',
        { reason: 'Wrong receipt' },
        user,
      ),
    ).rejects.toThrow('cash-book payment was already reversed');
    expect(f.state).toEqual(before);
  });

  it('offers only reversal for a fully traced legacy journal', async () => {
    const f = fixture();
    const { data } = await f.service.list('receivable', 'document', user);
    expect(data[0]).toMatchObject({
      kind: 'LEGACY_JOURNAL',
      canReverse: true,
      canCorrect: false,
      reversalEndpoint: '/receivables/document/payments/journal/reverse',
      cashAccountId: 'cash',
    });
  });

  it.each(['receivable', 'payable'] as const)(
    'recognizes the exact new idempotent %s settlement claim and reverses it',
    async (kind) => {
      const f = fixture(kind);
      f.state.journal.description += ` [request:${'a'.repeat(64)}]`;
      f.state.journal.journalNumber = `${kind === 'receivable' ? 'AR' : 'AP'}-PAY-00000000-0000-4000-8000-000000000001`;
      expect((await f.service.list(kind, 'document', user)).data[0].canReverse).toBe(true);
      await f.service.reverseLegacy(
        kind,
        'document',
        'journal',
        { reason: 'Correct idempotent settlement' },
        user,
      );
      expect(f.state.journal.status).toBe('REVERSED');
    },
  );

  it.each(['wrong number', 'extra suffix', 'uppercase digest'])(
    'rejects an idempotent settlement with %s',
    async (variant) => {
      const f = fixture();
      f.state.journal.journalNumber = 'AR-PAY-00000000-0000-4000-8000-000000000001';
      f.state.journal.description += ` [request:${(variant === 'uppercase digest' ? 'A' : 'a').repeat(64)}]${variant === 'extra suffix' ? ' extra' : ''}`;
      if (variant === 'wrong number') f.state.journal.journalNumber = 'JE-UNPROVEN';
      await expect(
        f.service.reverseLegacy(
          'receivable',
          'document',
          'journal',
          { reason: 'Wrong settlement' },
          user,
        ),
      ).rejects.toThrow('exact direct settlement');
      expect(f.engine.postLines).not.toHaveBeenCalled();
    },
  );

  it('shows the full canonical payment allocation while identifying the amount on this document', async () => {
    const f = fixture();
    f.tx.journalEntry.findMany.mockResolvedValue([]);
    const payment = {
      id: 'payment',
      paymentNumber: 'PAY-1',
      paymentDate: new Date(),
      amount: D(70),
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      currency: 'TZS',
      status: 'COMPLETED',
      cashAccountId: 'cash',
      cashAccount: { accountName: 'Drawer' },
      method: 'CASH',
      reference: null,
      notes: null,
      reversedAt: null,
      unappliedAmount: D(0),
      appliedAmount: D(70),
      journalEntry: { status: 'POSTED', referenceType: 'CustomerPayment', referenceId: 'payment' },
      cashDeskMovement: null,
      allocations: [
        { receivableId: 'document', amount: D(20), receivable: copy(f.state.document) },
        {
          receivableId: 'other',
          amount: D(50),
          receivable: { ...copy(f.state.document), id: 'other', receivableNumber: 'AR-2' },
        },
      ],
    };
    f.tx.customerPayment.findMany.mockResolvedValue([payment]);
    const { data } = await f.service.list('receivable', 'document', user);
    expect(data[0].amount.toFixed(2)).toBe('70.00');
    expect(data[0].allocatedAmount.toFixed(2)).toBe('20.00');
    expect(data[0].allocations.map((a) => a.documentNumber)).toEqual(['AR-1', 'AR-2']);
    expect(data[0].canReverse).toBe(true);
    expect(data[0].canCorrect).toBe(false);
  });

  it.each(['receivable', 'payable'] as const)(
    'keeps canonical %s history read-only when the posted journal belongs to another workflow',
    async (kind) => {
      const f = fixture(kind);
      f.tx.journalEntry.findMany.mockResolvedValue([]);
      const payment = {
        id: 'payment',
        paymentNumber: 'PAY-1',
        paymentDate: new Date(),
        amount: D(20),
        companyId: 'company',
        divisionId: 'division',
        branchId: 'branch',
        currency: 'TZS',
        status: 'COMPLETED',
        cashAccountId: null,
        cashAccount: null,
        method: 'CASH',
        reference: null,
        notes: null,
        reversedAt: null,
        unappliedAmount: D(0),
        appliedAmount: D(20),
        journalEntry: { status: 'POSTED', referenceType: 'SalesOrder', referenceId: 'source' },
        cashDeskMovement: null,
        carriedMovement: null,
        deskPayment: null,
        purchaseAdvance: null,
        allocations: [
          kind === 'receivable'
            ? { receivableId: 'document', amount: D(20), receivable: copy(f.state.document) }
            : { payableId: 'document', amount: D(20), payable: copy(f.state.document) },
        ],
      };
      (kind === 'receivable'
        ? f.tx.customerPayment
        : f.tx.supplierPayment
      ).findMany.mockResolvedValue([payment]);
      const { data } = await f.service.list(kind, 'document', user);
      expect(data[0].canReverse).toBe(false);
      expect(data[0].canCorrect).toBe(false);
      expect(data[0].reversalEndpoint).toBeNull();
      expect(data[0].reversalUnavailableReason).toContain('another source');
    },
  );

  it('shows a purchase advance through its application without inventing a second cash payment', async () => {
    const f = fixture('payable');
    f.tx.journalEntry.findMany.mockResolvedValue([]);
    f.tx.supplierPayment.findMany.mockResolvedValue([
      {
        id: 'advance-payment',
        paymentNumber: 'PAY-ADV-1',
        paymentDate: new Date(),
        amount: D(45.4),
        companyId: 'company',
        divisionId: 'division',
        branchId: 'branch',
        currency: 'TZS',
        status: 'COMPLETED',
        cashAccountId: null,
        cashAccount: null,
        method: 'CASH',
        reference: null,
        notes: null,
        reversedAt: null,
        unappliedAmount: D(0),
        appliedAmount: D(45.4),
        journalEntry: { status: 'POSTED' },
        sourceType: 'CashDesk',
        cashDeskMovement: null,
        carriedMovement: null,
        deskPayment: null,
        allocations: [],
        purchaseAdvance: {
          applications: [
            { payableId: 'document', amount: D(45.4), payable: copy(f.state.document) },
          ],
        },
      },
    ]);
    const { data } = await f.service.list('payable', 'document', user);
    expect(data).toHaveLength(1);
    expect(data[0].allocatedAmount.eq('45.4')).toBe(true);
    expect(data[0].kind).toBe('SUPPLIER_PAYMENT');
    expect(data[0].canReverse).toBe(false);
    expect(data[0].canCorrect).toBe(false);
    expect(data[0].reversalUnavailableReason).toContain('Cash Desk');
    expect(data[0].allocations[0].documentId).toBe('document');
  });
});
