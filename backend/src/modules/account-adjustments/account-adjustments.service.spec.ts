import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { refreshCachedPartyBalance } from '../party-balance/party-balance.helper';
import { AccountAdjustmentKind, AccountAdjustmentsService } from './account-adjustments.service';

jest.mock('../party-balance/party-balance.helper', () => ({
  refreshCachedPartyBalance: jest.fn(async () => {}),
}));
jest.mock('../../common/services/pos-draft-policy', () => ({
  assertLegacyPosWriteAllowed: jest.fn(async () => {}),
}));

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const user = { id: 'actor', email: 'actor@example.test', roles: [], permissions: [] } as AuthUser;
const date = '2026-10-22T00:00:00.000Z';
function copy<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as T;
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T;
  return value;
}

function fixture(kind: AccountAdjustmentKind = 'receivable') {
  const document = {
    id: 'document',
    companyId: 'company',
    divisionId: null,
    branchId: null,
    customerId: 'party',
    supplierId: 'party',
    customerName: 'Party',
    supplierName: 'Party',
    receivableNumber: 'AR-1',
    payableNumber: 'AP-1',
    amount: D(100),
    paidAmount: D(20),
    outstandingAmount: D(80),
    currency: 'TZS',
    status: 'PARTIALLY_PAID',
    sourceType: null,
    sourceId: null,
    deletedAt: null,
    journalEntryId: 'source-journal',
  };
  let state = {
    documents: [document] as any[],
    adjustments: [] as any[],
    journals: [] as any[],
    audits: [] as any[],
    cashBalance: D(1000),
  };
  const account = {
    id: 'offset',
    companyId: 'company',
    divisionId: null,
    branchId: null,
    accountCode: '6991',
    accountName: 'Account corrections',
    accountSubType: null,
    accountType: 'EXPENSE',
    isActive: true,
    deletedAt: null,
    _count: { childAccounts: 0 },
    mappedCashAccount: null,
  };
  const documents = {
    findFirst: jest.fn(async ({ where }) =>
      copy(state.documents.find((item) => item.id === where.id && !item.deletedAt) ?? null),
    ),
    update: jest.fn(async ({ where, data }) => {
      const row = state.documents.find((item) => item.id === where.id);
      Object.assign(row, copy(data));
      return copy(row);
    }),
    create: jest.fn(async ({ data }) => {
      const row = {
        ...copy(document),
        ...copy(data),
        id: randomUUID(),
        journalEntryId: data.journalEntryId ?? null,
      };
      state.documents.push(row);
      return copy(row);
    }),
  };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    receivable: documents,
    payable: documents,
    company: { findFirst: jest.fn(async () => ({ id: 'company' })) },
    division: { findFirst: jest.fn(async () => ({ id: 'division' })) },
    branch: { findFirst: jest.fn(async () => ({ id: 'branch' })) },
    customer: { findFirst: jest.fn(async () => ({ divisionId: null, branchId: null })) },
    supplier: { findFirst: jest.fn(async () => ({ divisionId: null, branchId: null })) },
    salesOrder: {
      findMany: jest.fn(async () => [] as any[]),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    purchaseOrder: { findMany: jest.fn(async () => [] as any[]) },
    supplierInvoice: { findMany: jest.fn(async () => [] as any[]) },
    goodsReceivedNote: { findFirst: jest.fn() },
    chartOfAccount: {
      findFirst: jest.fn(async () => copy(account)),
      findMany: jest.fn(async () => [copy(account)]),
    },
    cashAccount: { update: jest.fn(), updateMany: jest.fn() },
    cashDeskMovement: { create: jest.fn(), update: jest.fn() },
    paymentAllocation: { count: jest.fn(async () => 0) },
    supplierPaymentAllocation: { count: jest.fn(async () => 0) },
    accountAdjustment: {
      findMany: jest.fn(async () => copy(state.adjustments)),
      findUnique: jest.fn(async ({ where }) =>
        copy(
          state.adjustments.find(
            (row) =>
              row.companyId === where.companyId_requestId.companyId &&
              row.requestId === where.companyId_requestId.requestId,
          ) ?? null,
        ),
      ),
      findFirst: jest.fn(async ({ where }) =>
        copy(
          state.adjustments.find((row) =>
            Object.entries(where).every(([key, value]) => row[key] === value),
          ) ?? null,
        ),
      ),
      create: jest.fn(async ({ data }) => {
        const row = {
          targetReceivableId: null,
          targetPayableId: null,
          generatedReceivableId: null,
          generatedPayableId: null,
          journalEntryId: null,
          reversalJournalEntryId: null,
          createdAt: new Date(),
          ...copy(data),
        };
        state.adjustments.push(row);
        return copy(row);
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = state.adjustments.find((item) => item.id === where.id);
        Object.assign(
          row,
          Object.fromEntries(Object.entries(copy(data)).filter(([, value]) => value !== undefined)),
        );
        return copy(row);
      }),
    },
    journalEntry: {
      findFirst: jest.fn(async ({ where }) =>
        copy(
          state.journals.find((row) =>
            Object.entries(where).every(([key, value]) => row[key] === value),
          ) ?? null,
        ),
      ),
      updateMany: jest.fn(async ({ where, data }) => {
        const row = state.journals.find(
          (item) => item.id === where.id && item.status === where.status && !item.deletedAt,
        );
        if (!row) return { count: 0 };
        Object.assign(row, copy(data));
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = state.journals.find((item) => item.id === where.id);
        Object.assign(row, copy(data));
        return copy(row);
      }),
    },
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
  const companyScope = { assertCanAccessCompany: jest.fn(async () => {}) };
  const org = { assertCanAccessScope: jest.fn(async () => {}) };
  const resolver = {
    resolve: jest.fn(async () => ({
      id: kind === 'receivable' ? 'ar' : 'ap',
      divisionId: null,
      branchId: null,
    })),
  };
  const posting = {
    postLines: jest.fn(async (input, transaction) => {
      expect(transaction).toBe(tx);
      const total = (side: 'debit' | 'credit') =>
        input.lines.reduce((sum: Prisma.Decimal, line: any) => sum.plus(line[side]), D(0));
      expect(total('debit').eq(total('credit'))).toBe(true);
      const row = {
        ...copy(input),
        id: `journal-${state.journals.length + 1}`,
        deletedAt: null,
        status: 'POSTED',
        totalDebit: total('debit'),
        totalCredit: total('credit'),
        lines: input.lines.map((line: any) => ({
          divisionId: input.divisionId,
          branchId: input.branchId,
          ...copy(line),
          debit: D(line.debit),
          credit: D(line.credit),
        })),
      };
      state.journals.push(row);
      return { id: row.id, journalNumber: `JE-${state.journals.length}` };
    }),
  };
  const audit = {
    logStrictInTransaction: jest.fn(async (transaction, input) => {
      expect(transaction).toBe(tx);
      state.audits.push(copy(input));
    }),
  };
  const codes = {
    next: jest.fn(async ({ entityType, tx: transaction }) => {
      expect(transaction).toBe(tx);
      return `${entityType}-${randomUUID()}`;
    }),
  };
  const supplierPayments = {
    lockPayable: jest.fn(async (_tx, id) =>
      copy(state.documents.find((item) => item.id === id && !item.deletedAt)),
    ),
    syncSupplierInvoices: jest.fn(async () => {}),
    syncPurchaseOrders: jest.fn(async () => {}),
  };
  const service = new AccountAdjustmentsService(
    prisma as any,
    companyScope as any,
    org as any,
    resolver as any,
    posting as any,
    audit as any,
    codes as any,
    supplierPayments as any,
  );
  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      requestId: randomUUID(),
      direction: 'DECREASE',
      amount: 25,
      transactionDate: date,
      offsetAccountId: 'offset',
      reason: 'Agreed balance correction',
      ...overrides,
    }) as any;
  const create = (overrides: Record<string, unknown> = {}) =>
    service.create(kind, 'document', dto(overrides), user);
  const reverse = (id: string, overrides: Record<string, unknown> = {}) =>
    service.reverse(
      kind,
      'document',
      id,
      { transactionDate: date, reason: 'Correction withdrawn', ...overrides } as any,
      user,
    );
  return {
    service,
    tx,
    prisma,
    posting,
    audit,
    companyScope,
    org,
    resolver,
    supplierPayments,
    account,
    dto,
    create,
    reverse,
    state: () => state,
  };
}

beforeEach(() => jest.clearAllMocks());

describe.each(['receivable', 'payable'] as const)('%s account adjustments', (kind) => {
  it.each(['INCREASE', 'DECREASE'] as const)(
    'posts a balanced %s without changing any cash payment or approved source gross',
    async (direction) => {
      const f = fixture(kind);
      const record = await f.create({ direction });
      const target = f.state().documents[0];
      expect(target.amount.toFixed(2)).toBe('100.00');
      expect(target.paidAmount.toFixed(2)).toBe('20.00');
      expect(target.outstandingAmount.toFixed(2)).toBe(
        direction === 'DECREASE' ? '55.00' : '80.00',
      );
      expect(f.state().cashBalance.toFixed(2)).toBe('1000.00');
      expect(f.tx.cashAccount.updateMany).not.toHaveBeenCalled();
      expect(f.tx.cashAccount.update).not.toHaveBeenCalled();
      expect(f.tx.cashDeskMovement.create).not.toHaveBeenCalled();
      const control = f.state().journals[0].lines[0];
      const debit = (kind === 'receivable') === (direction === 'INCREASE');
      expect(control.debit.toNumber()).toBe(debit ? 25 : 0);
      expect(control.credit.toNumber()).toBe(debit ? 0 : 25);
      expect(control.partyType).toBe(kind === 'receivable' ? 'CUSTOMER' : 'SUPPLIER');
      expect(record.journalEntryId).toBe('journal-1');
      expect(f.state().audits).toHaveLength(1);
      expect(refreshCachedPartyBalance).toHaveBeenCalledWith(
        f.tx,
        kind === 'receivable' ? 'customer' : 'supplier',
        'company',
        'party',
      );
      expect(f.prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
      if (direction === 'INCREASE') {
        const generated = f.state().documents[1];
        expect(generated.sourceType).toBe('AccountAdjustment');
        expect(generated.sourceId).toBe(record.id);
        expect(generated.amount.toFixed(2)).toBe('25.00');
        expect(generated.paidAmount.toFixed(2)).toBe('0.00');
        expect(generated.journalEntryId).toBe('journal-1');
        expect(
          kind === 'receivable' ? record.generatedReceivableId : record.generatedPayableId,
        ).toBe(generated.id);
      } else {
        expect(f.state().documents).toHaveLength(1);
        if (kind === 'payable') {
          expect(f.supplierPayments.syncPurchaseOrders).toHaveBeenCalledWith(
            f.tx,
            expect.objectContaining({ outstandingAmount: D(55), paidAmount: D(20) }),
          );
          expect(f.supplierPayments.syncSupplierInvoices).toHaveBeenCalled();
        }
      }
    },
  );

  it('replays the same UUID request without a second liability, journal, audit, or balance movement', async () => {
    const f = fixture(kind);
    const input = f.dto({ direction: 'INCREASE' });
    const first = await f.service.create(kind, 'document', input, user);
    const second = await f.service.create(
      kind,
      'document',
      { ...input, requestId: input.requestId.toUpperCase() },
      user,
    );
    expect(second.id).toBe(first.id);
    expect(f.state().documents).toHaveLength(2);
    expect(f.state().journals).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
    expect(f.posting.postLines).toHaveBeenCalledTimes(1);
    await expect(
      f.service.create(kind, 'document', { ...input, amount: 26 }, user),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().journals).toHaveLength(1);
  });

  it.each(['INCREASE', 'DECREASE'] as const)(
    'reverses %s once using the stored journal and exact balance effect',
    async (direction) => {
      const f = fixture(kind);
      const record = await f.create({ direction });
      const reversed = await f.reverse(record.id);
      expect(reversed.status).toBe('REVERSED');
      expect(reversed.reversalJournalEntryId).toBe('journal-2');
      expect(f.state().journals[0].status).toBe('REVERSED');
      expect(f.state().journals[1].reversalOfId).toBe('journal-1');
      for (let i = 0; i < 2; i++) {
        expect(f.state().journals[1].lines[i].debit.eq(f.state().journals[0].lines[i].credit)).toBe(
          true,
        );
        expect(f.state().journals[1].lines[i].credit.eq(f.state().journals[0].lines[i].debit)).toBe(
          true,
        );
      }
      expect(f.state().documents[0].outstandingAmount.toFixed(2)).toBe('80.00');
      expect(f.state().documents[0].paidAmount.toFixed(2)).toBe('20.00');
      expect(f.state().cashBalance.toFixed(2)).toBe('1000.00');
      if (direction === 'INCREASE') expect(f.state().documents[1].status).toBe('CANCELLED');
      await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
      expect(f.state().journals).toHaveLength(2);
      expect(f.state().audits).toHaveLength(2);
    },
  );

  it('can undo its full noncash reduction without presenting it as a cash payment', async () => {
    const f = fixture(kind);
    const record = await f.create({ amount: 80 });
    expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(0);
    expect(f.state().documents[0].status).toBe('PAID');
    expect(f.state().documents[0].paidAmount.toNumber()).toBe(20);
    await f.reverse(record.id);
    expect(f.state().documents[0].status).toBe('PARTIALLY_PAID');
    expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(80);
  });

  it.each(['cash', 'writeoff', 'noncash relief', 'active allocation'])(
    'blocks increase reversal while its item has %s',
    async (settlement) => {
      const f = fixture(kind);
      const record = await f.create({ direction: 'INCREASE' });
      const generated = f.state().documents[1];
      if (settlement === 'cash') {
        generated.paidAmount = D(10);
        generated.outstandingAmount = D(15);
        generated.status = 'PARTIALLY_PAID';
      }
      if (settlement === 'writeoff') {
        generated.status = 'WRITTEN_OFF';
        generated.outstandingAmount = D(0);
      }
      if (settlement === 'noncash relief') generated.outstandingAmount = D(20);
      if (settlement === 'active allocation')
        (kind === 'receivable'
          ? f.tx.paymentAllocation.count
          : f.tx.supplierPaymentAllocation.count
        ).mockResolvedValue(1);
      await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
      expect(f.state().adjustments[0].status).toBe('POSTED');
      expect(f.state().journals).toHaveLength(1);
    },
  );

  it.each(['WRITTEN_OFF', 'CANCELLED'])(
    'does not create adjustments on a %s target',
    async (status) => {
      const f = fixture(kind);
      f.state().documents[0].status = status;
      await expect(f.create()).rejects.toBeInstanceOf(ConflictException);
      expect(f.posting.postLines).not.toHaveBeenCalled();
    },
  );

  it('allows a separate increase against a PAID original while leaving that original settled', async () => {
    const f = fixture(kind);
    Object.assign(f.state().documents[0], {
      status: 'PAID',
      paidAmount: D(100),
      outstandingAmount: D(0),
    });
    const record = await f.create({ direction: 'INCREASE' });
    expect(record.direction).toBe('INCREASE');
    expect(f.state().documents[0].paidAmount.toNumber()).toBe(100);
    expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(0);
    expect(f.state().documents[0].status).toBe('PAID');
    await expect(f.create({ direction: 'DECREASE' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not resurrect cancelled documents or inactive parties on reversal', async () => {
    const f = fixture(kind);
    const record = await f.create();
    f.state().documents[0].status = 'CANCELLED';
    await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
    f.state().documents[0].status = 'PARTIALLY_PAID';
    (kind === 'receivable' ? f.tx.customer.findFirst : f.tx.supplier.findFirst).mockResolvedValue(
      null as any,
    );
    await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().journals).toHaveLength(1);
  });

  it('rejects a decrease beyond outstanding and unsupported generated-item/Expense targets', async () => {
    const f = fixture(kind);
    await expect(f.create({ amount: 80.01 })).rejects.toBeInstanceOf(BadRequestException);
    for (const sourceType of ['Expense', 'AccountAdjustment']) {
      f.state().documents[0].sourceType = sourceType;
      await expect(f.create()).rejects.toBeInstanceOf(ConflictException);
    }
    expect(f.state().adjustments).toHaveLength(0);
  });

  it.each([
    ['posting', 'INCREASE'],
    ['strict audit', 'INCREASE'],
    ['posting', 'DECREASE'],
    ['strict audit', 'DECREASE'],
  ])(
    'rolls back the journal, document, and event if %s fails during %s',
    async (failure, direction) => {
      const f = fixture(kind);
      if (failure === 'posting')
        f.posting.postLines.mockRejectedValueOnce(new Error('period closed'));
      else f.audit.logStrictInTransaction.mockRejectedValueOnce(new Error('audit unavailable'));
      await expect(f.create({ direction })).rejects.toThrow();
      expect(f.state().documents).toHaveLength(1);
      expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(80);
      expect(f.state().adjustments).toHaveLength(0);
      expect(f.state().journals).toHaveLength(0);
      expect(f.state().audits).toHaveLength(0);
    },
  );

  it('rolls back a reversal if its journal mirror or audit cannot commit', async () => {
    const f = fixture(kind);
    const record = await f.create();
    f.posting.postLines.mockRejectedValueOnce(new Error('closed reversal period'));
    await expect(f.reverse(record.id)).rejects.toThrow();
    expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(55);
    expect(f.state().adjustments[0].status).toBe('POSTED');
    expect(f.state().journals[0].status).toBe('POSTED');
    f.audit.logStrictInTransaction.mockRejectedValueOnce(new Error('no audit'));
    await expect(f.reverse(record.id)).rejects.toThrow();
    expect(f.state().journals).toHaveLength(1);
    expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(55);
  });

  it.each([
    ['Prisma serialization/deadlock', { code: 'P2034' }],
    ['PostgreSQL deadlock', { code: 'P2010', meta: { code: '40P01' } }],
  ])(
    'retries an increase reversal after a %s against a multi-allocation payment without duplicate relief',
    async (_label, failure) => {
      const f = fixture(kind);
      const record = await f.create({ direction: 'INCREASE' });
      // Origin and generated documents may be locked in opposite lexical order
      // to a multi-allocation payment. Fail after generated cancellation and the
      // original journal claim, where PostgreSQL can abort a lock-cycle victim.
      f.posting.postLines.mockRejectedValueOnce(failure);
      const reversed = await f.reverse(record.id);
      expect(reversed.status).toBe('REVERSED');
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(f.state().journals).toHaveLength(2);
      expect(f.state().journals[1].reversalOfId).toBe('journal-1');
      expect(f.state().documents[1].status).toBe('CANCELLED');
      expect(f.state().documents[0].outstandingAmount.toNumber()).toBe(80);
      expect(f.state().cashBalance.toNumber()).toBe(1000);
      expect(f.state().audits).toHaveLength(2);
    },
  );

  it('bounds repeated increase-reversal conflicts and rolls back every attempted cancellation', async () => {
    const f = fixture(kind);
    const record = await f.create({ direction: 'INCREASE' });
    f.posting.postLines.mockRejectedValue({ code: 'P2034' });
    await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(f.state().adjustments[0].status).toBe('POSTED');
    expect(f.state().documents[1].status).toBe('OPEN');
    expect(f.state().journals).toHaveLength(1);
    expect(f.state().journals[0].status).toBe('POSTED');
  });

  it('fails closed on altered accounting evidence, missing original, or changed document scope', async () => {
    const f = fixture(kind);
    const record = await f.create();
    f.state().journals[0].lines[0].credit = D(99);
    await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
    f.state().journals = [];
    await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
    f.state().documents[0].currency = 'USD';
    await expect(f.reverse(record.id)).rejects.toBeInstanceOf(ConflictException);
    expect(f.state().adjustments[0].status).toBe('POSTED');
  });
});

describe('shared adjustment validation and source projections', () => {
  it.each([0, -1, 1.005, Number.NaN, Number.POSITIVE_INFINITY, 90071992547410])(
    'rejects invalid money %s without opening a transaction',
    async (amount) => {
      const f = fixture();
      await expect(f.create({ amount })).rejects.toBeInstanceOf(BadRequestException);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['', '  ', '..', '...'])('requires a meaningful reason: %s', async (reason) => {
    const f = fixture();
    await expect(f.create({ reason })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires accounting permission and location access even for offset-account options', async () => {
    const f = fixture();
    f.org.assertCanAccessScope.mockRejectedValue(new Error('wrong branch'));
    await expect(f.service.offsetAccounts('receivable', 'document', user)).rejects.toThrow(
      'wrong branch',
    );
    expect(f.tx.chartOfAccount.findMany).not.toHaveBeenCalled();
    await expect(f.create()).rejects.toThrow('wrong branch');
    expect(f.posting.postLines).not.toHaveBeenCalled();
  });

  it.each([
    ['cash mapping', { mappedCashAccount: { id: 'cash' } }],
    ['cash role', { accountSubType: 'cash_on_hand' }],
    ['bank code', { accountCode: '1020' }],
    ['AR role', { accountSubType: 'ar_control' }],
    ['AP code', { accountCode: '2000' }],
    ['parent account', { _count: { childAccounts: 1 } }],
    ['inactive account', { isActive: false }],
    ['foreign company', { companyId: 'other' }],
    ['foreign branch', { branchId: 'other' }],
  ])(
    'offers and accepts only eligible noncash leaf offset accounts: %s',
    async (_label, fields) => {
      const f = fixture();
      Object.assign(f.account, fields);
      expect((await f.service.offsetAccounts('receivable', 'document', user)).data).toEqual([]);
      await expect(f.create()).rejects.toBeInstanceOf(BadRequestException);
      expect(f.state().journals).toHaveLength(0);
    },
  );

  it('returns the same safe offset fields used by the posting validator and rechecks before posting', async () => {
    const f = fixture();
    expect((await f.service.offsetAccounts('receivable', 'document', user)).data).toEqual([
      {
        id: 'offset',
        accountCode: '6991',
        accountName: 'Account corrections',
        accountType: 'EXPENSE',
      },
    ]);
    f.account.isActive = false;
    await expect(f.create()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('synchronizes the active source SalesOrder without changing cash paid or gross value', async () => {
    const f = fixture();
    Object.assign(f.state().documents[0], { sourceType: 'SalesOrder', sourceId: 'order' });
    const order = {
      id: 'order',
      companyId: 'company',
      customerId: 'party',
      currency: 'TZS',
      divisionId: null,
      branchId: null,
      deletedAt: null,
      status: 'PARTIALLY_PAID',
      totalAmount: D(100),
      receivableId: 'document',
    };
    f.tx.salesOrder.findMany.mockResolvedValue([order]);
    f.tx.salesOrder.findFirst.mockResolvedValue(order);
    const record = await f.create();
    expect(f.tx.salesOrder.update).toHaveBeenCalledWith({
      where: { id: 'order' },
      data: { paidAmount: D(20), outstandingAmount: D(55), paymentStatus: 'PARTIALLY_PAID' },
    });
    await f.reverse(record.id);
    expect(f.tx.salesOrder.update).toHaveBeenLastCalledWith({
      where: { id: 'order' },
      data: { paidAmount: D(20), outstandingAmount: D(80), paymentStatus: 'PARTIALLY_PAID' },
    });
  });

  it.each(['INCREASE', 'DECREASE'])(
    'rejects %s when an apparent source payable is backed by an inactive invoice',
    async (direction) => {
      const f = fixture('payable');
      Object.assign(f.state().documents[0], { sourceType: 'SupplierInvoice', sourceId: 'invoice' });
      f.tx.supplierInvoice.findMany.mockResolvedValue([
        {
          id: 'invoice',
          companyId: 'company',
          supplierId: 'party',
          currency: 'TZS',
          divisionId: null,
          branchId: null,
          status: 'VOID',
          deletedAt: null,
          totalAmount: D(100),
          payableId: 'document',
        },
      ]);
      await expect(f.create({ direction })).rejects.toBeInstanceOf(ConflictException);
      expect(f.posting.postLines).not.toHaveBeenCalled();
    },
  );

  it('retries a serialization conflict and then commits exactly one adjustment', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await f.create();
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.state().adjustments).toHaveLength(1);
    expect(f.state().journals).toHaveLength(1);
  });

  it('refreshes an increase replay after a concurrent request-key unique race', async () => {
    const f = fixture();
    const input = f.dto({ direction: 'INCREASE' });
    const first = await f.service.create('receivable', 'document', input, user);
    f.prisma.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['companyId', 'requestId'] },
    });
    const replay = await f.service.create('receivable', 'document', input, user);
    expect(replay.id).toBe(first.id);
    expect(f.state().journals).toHaveLength(1);
    expect(f.state().documents).toHaveLength(2);
  });
});
