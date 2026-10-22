import { Prisma } from '@prisma/client';
import {
  assembleCustomerAccounts,
  CustomerAccountProjectionService,
} from './customer-account-projection.service';
import { CustomerStatementsService } from './customer-statements.service';

const D = (amount: number | string) => new Prisma.Decimal(amount);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const end = (value: string) => new Date(`${value}T23:59:59.999Z`);
const user: any = { id: 'user', permissions: [], roleScopes: ['COMPANY'] };
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const party = { ...scope, customerId: 'customer', currency: 'TZS' };
const ar = (debit: number, credit = 0) => ({
  accountId: 'ar',
  debit: D(debit),
  credit: D(credit),
  account: { accountCode: '1200', accountSubType: 'AR_CONTROL', accountType: 'ASSET' },
});
const cash = (debit: number, credit = 0) => ({
  accountId: 'cash',
  debit: D(debit),
  credit: D(credit),
  account: { accountCode: '1000', accountSubType: 'CASH_ON_HAND', accountType: 'ASSET' },
});
const customer = {
  ...scope,
  id: 'customer',
  name: 'Customer',
  customerCode: 'C-1',
  email: null,
  phone: null,
  address: null,
  createdAt: day('2026-01-01'),
  company: { id: 'company', name: 'Company', code: 'CO' },
};

function fixture() {
  const creation = {
    ...scope,
    id: 'invoice-je',
    journalNumber: 'JE-INVOICE',
    transactionDate: day('2026-02-01'),
    status: 'POSTED',
    description: 'Receivable creation',
    referenceType: 'Receivable',
    referenceId: 'invoice',
    reversalOfId: null,
    lines: [ar(1000)],
    reversedBy_: [],
  };
  const invoice = {
    ...party,
    id: 'invoice',
    receivableNumber: 'AR-1',
    issueDate: creation.transactionDate,
    dueDate: day('2026-02-10'),
    amount: D(1000),
    paidAmount: D(0),
    outstandingAmount: D(1000),
    status: 'OPEN',
    sourceType: 'Manual',
    sourceId: null,
    journalEntryId: creation.id,
    journalEntry: creation,
  };
  return {
    customers: [customer],
    sales: [],
    receivables: [invoice],
    payments: [],
    creditNotes: [],
    refunds: [],
    journals: [creation],
    adjustments: [],
  } as any;
}

function decrease(rows: any, amount = 100, reversed = false) {
  const mirror: any = {
    ...scope,
    id: 'decrease-reversal',
    journalNumber: 'JE-DEC-REV',
    transactionDate: day('2026-03-05'),
    status: 'POSTED',
    description: 'Reversal of account adjustment',
    referenceType: 'AccountAdjustment',
    referenceId: 'decrease',
    reversalOfId: 'decrease-je',
    lines: [ar(amount)],
  };
  const journal: any = {
    ...scope,
    id: 'decrease-je',
    journalNumber: 'JE-DEC',
    transactionDate: day('2026-02-15'),
    status: reversed ? 'REVERSED' : 'POSTED',
    description: 'Receivable decrease adjustment AR-1',
    referenceType: 'AccountAdjustment',
    referenceId: 'decrease',
    reversalOfId: null,
    lines: [ar(0, amount)],
    reversedBy_: reversed ? [mirror] : [],
  };
  const event: any = {
    ...party,
    id: 'decrease',
    targetReceivableId: 'invoice',
    generatedReceivableId: null,
    direction: 'DECREASE',
    amount: D(amount),
    reason: 'Agreed commercial balance correction',
    transactionDate: journal.transactionDate,
    status: reversed ? 'REVERSED' : 'POSTED',
    journalEntryId: journal.id,
    journalEntry: journal,
    reversalJournalEntryId: reversed ? mirror.id : null,
    reversalJournalEntry: reversed ? mirror : null,
    reversalReason: reversed ? 'Original correction was incorrect' : null,
  };
  rows.adjustments.push(event);
  rows.receivables[0].outstandingAmount = D(reversed ? 1000 : 1000 - amount);
  return event;
}

function increase(rows: any, amount = 200, reversed = false) {
  const mirror: any = {
    ...scope,
    id: 'increase-reversal',
    journalNumber: 'JE-INC-REV',
    transactionDate: day('2026-03-10'),
    status: 'POSTED',
    description: 'Reversal of account adjustment',
    referenceType: 'AccountAdjustment',
    referenceId: 'increase',
    reversalOfId: 'increase-je',
    lines: [ar(0, amount)],
  };
  const journal: any = {
    ...scope,
    id: 'increase-je',
    journalNumber: 'JE-INC',
    transactionDate: day('2026-02-20'),
    status: reversed ? 'REVERSED' : 'POSTED',
    description: 'Receivable increase adjustment AR-1',
    referenceType: 'AccountAdjustment',
    referenceId: 'increase',
    reversalOfId: null,
    lines: [ar(amount)],
    reversedBy_: reversed ? [mirror] : [],
  };
  const generated = {
    ...party,
    id: 'increase-item',
    receivableNumber: 'AR-ADJ-1',
    amount: D(amount),
    paidAmount: D(0),
    outstandingAmount: D(reversed ? 0 : amount),
    issueDate: journal.transactionDate,
    dueDate: journal.transactionDate,
    status: reversed ? 'CANCELLED' : 'OPEN',
    sourceType: 'AccountAdjustment',
    sourceId: 'increase',
    journalEntryId: journal.id,
    journalEntry: journal,
  };
  const event: any = {
    ...party,
    id: 'increase',
    targetReceivableId: 'invoice',
    generatedReceivableId: generated.id,
    direction: 'INCREASE',
    amount: D(amount),
    reason: 'Additional agreed charge',
    transactionDate: journal.transactionDate,
    status: reversed ? 'REVERSED' : 'POSTED',
    journalEntryId: journal.id,
    journalEntry: journal,
    reversalJournalEntryId: reversed ? mirror.id : null,
    reversalJournalEntry: reversed ? mirror : null,
  };
  rows.receivables.push(generated);
  rows.journals.push(journal);
  rows.adjustments.push(event);
  return { event, generated, journal, mirror };
}

const project = (rows: any, asOf = '2026-02-28') => assembleCustomerAccounts(rows, end(asOf))[0];

describe('Customer statement account adjustments', () => {
  it('dates a decrease as non-cash credit without changing the invoice amount or cash history', () => {
    const rows = fixture();
    decrease(rows);
    expect(project(rows, '2026-02-14').netBalance.toFixed(2)).toBe('1000.00');
    const result = project(rows);
    expect(result.movements).toHaveLength(2);
    expect(result.movements[0]).toMatchObject({ type: 'INVOICE', debit: D(1000) });
    expect(result.movements[1]).toMatchObject({
      type: 'ADJUSTMENT',
      sourceType: 'AccountAdjustment',
      sourceId: 'decrease',
      date: day('2026-02-15'),
      debit: D(0),
      credit: D(100),
    });
    expect(result.netBalance.toFixed(2)).toBe('900.00');
    expect(result.openInvoiceBalance.toFixed(2)).toBe('900.00');
    expect(result.aging.days1_30).toBe('900.00');
    expect(result.payments).toEqual([]);
    expect(result.settlementHistory?.status).toBe('COMPLETE');
    expect(rows.receivables[0].amount.toFixed(2)).toBe('1000.00');
    expect(rows.receivables[0].paidAmount.toFixed(2)).toBe('0.00');
  });

  it('restores a decrease on its posted reversal date even though the current balance is already restored', () => {
    const rows = fixture();
    decrease(rows, 100, true);
    expect(project(rows).netBalance.toFixed(2)).toBe('900.00');
    expect(project(rows, '2026-03-04').openInvoiceBalance.toFixed(2)).toBe('900.00');
    const restored = project(rows, '2026-03-05');
    expect(restored.netBalance.toFixed(2)).toBe('1000.00');
    expect(restored.openInvoiceBalance.toFixed(2)).toBe('1000.00');
    expect(restored.movements.filter((m) => m.sourceType === 'AccountAdjustment')).toHaveLength(2);
    expect(restored.movements.at(-1)).toMatchObject({
      type: 'ADJUSTMENT',
      date: day('2026-03-05'),
      debit: D(100),
      reversalOfId: 'AccountAdjustment:decrease',
    });
    expect(restored.payments).toEqual([]);
  });

  it('classifies a generated increase once as an adjustment and ages the additional amount once', () => {
    const rows = fixture();
    increase(rows);
    expect(project(rows, '2026-02-19').netBalance.toFixed(2)).toBe('1000.00');
    const result = project(rows);
    expect(result.movements.filter((m) => m.type === 'INVOICE')).toHaveLength(1);
    expect(result.movements.filter((m) => m.sourceType === 'AccountAdjustment')).toHaveLength(1);
    expect(result.movements.at(-1)).toMatchObject({
      type: 'ADJUSTMENT',
      sourceId: 'increase',
      receivableId: 'increase-item',
      debit: D(200),
      credit: D(0),
    });
    expect(result.netBalance.toFixed(2)).toBe('1200.00');
    expect(result.openInvoiceBalance.toFixed(2)).toBe('1200.00');
    expect(result.aging.total).toBe('1200.00');
    expect(result.payments).toEqual([]);
    expect(result.integrityIssues).toEqual([]);
  });

  it('retains an increase before its cancellation and reverses it once without a phantom settlement gap', () => {
    const rows = fixture();
    increase(rows, 200, true);
    expect(project(rows).netBalance.toFixed(2)).toBe('1200.00');
    expect(project(rows).openInvoiceBalance.toFixed(2)).toBe('1200.00');
    const result = project(rows, '2026-03-10');
    const events = result.movements.filter((m) => m.sourceType === 'AccountAdjustment');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      debit: D(0),
      credit: D(200),
      reversalOfId: 'AccountAdjustment:increase',
    });
    expect(result.netBalance.toFixed(2)).toBe('1000.00');
    expect(result.openInvoiceBalance.toFixed(2)).toBe('1000.00');
    expect(result.obligations.find((o) => o.id === 'increase-item')!.outstanding.toFixed(2)).toBe(
      '0.00',
    );
    expect(result.settlementHistory?.status).toBe('COMPLETE');
    expect(result.integrityIssues).toEqual([]);
  });

  it.each(['DRAFT', 'REVERSED'])(
    'does not treat a %s decrease mirror as a completed reversal',
    (status) => {
      const rows = fixture();
      const event = decrease(rows, 100, true);
      event.reversalJournalEntry.status = status;
      event.journalEntry.reversedBy_ = [];
      const result = project(rows, '2026-03-31');
      expect(result.netBalance.toFixed(2)).toBe('900.00');
      expect(result.integrityIssues).toContain('missing-reversal');
    },
  );

  it.each(['DRAFT', 'REVERSED'])(
    'keeps a cancelled increase outstanding when its only mirror is %s',
    (status) => {
      const rows = fixture();
      const { mirror } = increase(rows, 200, true);
      mirror.status = status;
      const result = project(rows, '2026-03-31');
      expect(result.netBalance.toFixed(2)).toBe('1200.00');
      expect(result.openInvoiceBalance.toFixed(2)).toBe('1200.00');
      expect(result.movements.filter((m) => m.sourceType === 'AccountAdjustment')).toHaveLength(1);
      expect(result.integrityIssues).toContain('missing-cancellation');
      expect(result.settlementHistory?.status).toBe('INCOMPLETE');
    },
  );

  it('continues to allocate real cash payments to the separate increase item', () => {
    const rows = fixture();
    const { generated } = increase(rows);
    generated.paidAmount = D(50);
    generated.outstandingAmount = D(150);
    const paymentJournal = {
      id: 'payment-je',
      ...scope,
      status: 'POSTED',
      transactionDate: day('2026-02-22'),
    };
    rows.payments.push({
      ...party,
      id: 'payment',
      paymentNumber: 'PAY-1',
      amount: D(50),
      paymentDate: day('2026-02-22'),
      status: 'COMPLETED',
      method: 'CASH',
      journalEntryId: paymentJournal.id,
      journalEntry: paymentJournal,
      allocations: [{ receivableId: generated.id, amount: D(50) }],
    });
    const result = project(rows);
    expect(result.netBalance.toFixed(2)).toBe('1150.00');
    expect(result.openInvoiceBalance.toFixed(2)).toBe('1150.00');
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amount.toFixed(2)).toBe('50.00');
    expect(result.settlementHistory?.status).toBe('COMPLETE');
  });

  it.each(['customerId', 'companyId', 'currency', 'branchId'])(
    'does not apply an event with a different %s',
    (field) => {
      const rows = fixture();
      const event = decrease(rows);
      event[field] = 'other';
      expect(project(rows).netBalance.toFixed(2)).toBe('1000.00');
    },
  );

  it.each(['POSTED', 'REVERSED'])(
    'recognizes only a POSTED legacy mirror through reversalOfId (mirror status %s)',
    (mirrorStatus) => {
      const rows = fixture();
      const mirror = {
        ...scope,
        id: 'legacy-reversal',
        journalNumber: 'JE-LEGACY-REV',
        transactionDate: day('2026-03-02'),
        referenceType: 'ReceivablePaymentReversal',
        referenceId: 'legacy-je',
        reversalOfId: 'legacy-je',
        status: mirrorStatus,
        description: 'Reversal of historical payment',
        lines: [ar(200), cash(0, 200)],
      };
      rows.journals.push({
        ...scope,
        id: 'legacy-je',
        journalNumber: 'JE-LEGACY',
        transactionDate: day('2026-02-12'),
        referenceType: 'Receivable',
        referenceId: 'invoice',
        reversalOfId: null,
        status: 'REVERSED',
        description: 'Receivable settlement AR-1',
        lines: [ar(0, 200), cash(200)],
        reversedBy_: [mirror],
      });
      const before = project(rows);
      expect(before.netBalance.toFixed(2)).toBe('800.00');
      expect(before.payments[0].status).toBe('COMPLETED');
      const after = project(rows, '2026-03-02');
      expect(after.netBalance.toFixed(2)).toBe(mirrorStatus === 'POSTED' ? '1000.00' : '800.00');
      expect(after.openInvoiceBalance.toFixed(2)).toBe(
        mirrorStatus === 'POSTED' ? '1000.00' : '800.00',
      );
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0].status).toBe(mirrorStatus === 'POSTED' ? 'REVERSED' : 'COMPLETED');
      expect(after.movements).toHaveLength(mirrorStatus === 'POSTED' ? 3 : 2);
      expect(after.settlementHistory?.status).toBe(
        mirrorStatus === 'POSTED' ? 'COMPLETE' : 'INCOMPLETE',
      );
    },
  );

  it('keeps adjustment lines in opening, period totals and running statement balances', async () => {
    const rows = fixture();
    decrease(rows, 100, true);
    increase(rows, 200, true);
    const projection: any = {
      read: jest.fn().mockImplementation(async (_user, query) => ({
        asOf: end(query.dateTo),
        currency: 'TZS',
        scope: { ...scope, unrestricted: true, divisionIds: [], branchIds: [] },
        accounts: [project(rows, query.dateTo)],
        warnings: [],
      })),
    };
    const company: any = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) };
    const statements = new CustomerStatementsService(
      {} as any,
      {} as any,
      company,
      undefined,
      undefined,
      projection,
      {} as any,
    );
    const result = await statements.buildStatement(
      {
        companyId: 'company',
        customerId: 'customer',
        currency: 'TZS',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        divisionId: 'division',
        branchId: 'branch',
      },
      user,
    );
    expect(result.openingBalance.toFixed(2)).toBe('1100.00');
    expect(result.totalDebits.toFixed(2)).toBe('100.00');
    expect(result.totalCredits.toFixed(2)).toBe('200.00');
    expect(result.closingBalance.toFixed(2)).toBe('1000.00');
    expect(result.lines.map((line) => line.balance.toFixed(2))).toEqual(['1200.00', '1000.00']);
    expect(result.lines.every((line) => line.type === 'ADJUSTMENT')).toBe(true);
    expect(result.aging.total).toBe('1000.00');
    expect(projection.read).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ ...scope, customerIds: ['customer'], currency: 'TZS' }),
    );
  });

  it('loads adjustment events under the same customer/company/location/currency snapshot and date cut', async () => {
    const rows = fixture();
    decrease(rows);
    const tx: any = {};
    for (const [model, data] of [
      ['customer', rows.customers],
      ['salesOrder', []],
      ['receivable', rows.receivables],
      ['customerPayment', []],
      ['creditNote', []],
      ['refund', []],
      ['journalEntry', rows.journals],
      ['accountAdjustment', rows.adjustments],
      ['auditLog', []],
      ['chartOfAccount', []],
    ])
      tx[model] = { findMany: jest.fn().mockResolvedValue(data) };
    const db: any = { $transaction: jest.fn().mockImplementation((callback) => callback(tx)) };
    const companies: any = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company' }),
    };
    const org: any = {
      accessibleIds: jest.fn().mockResolvedValue({
        unrestricted: false,
        divisionIds: ['division'],
        branchIds: ['branch'],
      }),
      recordWhereFor: jest.fn().mockResolvedValue({ branchId: { in: ['branch'] } }),
    };
    const result = await new CustomerAccountProjectionService(db, companies, org).read(user, {
      ...scope,
      currency: 'TZS',
      customerIds: ['customer'],
      dateTo: '2026-02-28',
    });
    expect(tx.accountAdjustment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { companyId: 'company' },
            { branchId: { in: ['branch'] } },
            { divisionId: 'division', branchId: 'branch' },
          ],
          customerId: { in: ['customer'] },
          currency: 'TZS',
          targetReceivableId: { not: null },
          transactionDate: { lte: end('2026-02-28') },
          status: { in: ['POSTED', 'REVERSED'] },
        },
        include: { journalEntry: { include: { reversedBy_: true } }, reversalJournalEntry: true },
      }),
    );
    expect(tx.journalEntry.findMany.mock.calls[0][0].include.reversedBy_).toEqual(
      expect.objectContaining({ include: expect.objectContaining({ lines: expect.anything() }) }),
    );
    expect(result.accounts[0].netBalance.toFixed(2)).toBe('900.00');
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
});
