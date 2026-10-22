import { Prisma } from '@prisma/client';
import { SupplierStatementsService } from './supplier-statements.service';

const D = (amount: number | string) => new Prisma.Decimal(amount);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const party = { ...scope, supplierId: 'supplier', currency: 'TZS' };
const user: any = { id: 'user', permissions: [], roleScopes: ['COMPANY'] };
const ap = (debit: number, credit = 0) => ({
  debit: D(debit),
  credit: D(credit),
  account: { accountCode: '2000', accountSubType: 'AP_CONTROL' },
});
const cash = (debit: number, credit = 0) => ({
  debit: D(debit),
  credit: D(credit),
  account: { accountCode: '1000', accountSubType: 'CASH_ON_HAND' },
});

function fixture() {
  const original = {
    ...scope,
    id: 'source-je',
    journalNumber: 'JE-SOURCE',
    status: 'POSTED',
    transactionDate: day('2026-02-01'),
    description: 'Manual payable AP-1',
    referenceType: 'Payable',
    referenceId: 'payable',
    reversalOfId: null,
    lines: [ap(0, 1000)],
    reversedBy_: [],
  };
  const payable = {
    ...party,
    id: 'payable',
    payableNumber: 'AP-1',
    supplierName: 'Supplier',
    amount: D(1000),
    paidAmount: D(0),
    outstandingAmount: D(1000),
    status: 'OPEN',
    issueDate: original.transactionDate,
    sourceType: null,
    sourceId: null,
    journalEntryId: original.id,
  };
  const state: any = { payables: [payable], payments: [], adjustments: [], journals: [original] };
  const prisma: any = {
    payable: { findMany: jest.fn(async () => state.payables) },
    supplierPayment: { findMany: jest.fn(async () => state.payments) },
    accountAdjustment: { findMany: jest.fn(async () => state.adjustments) },
    journalEntry: { findMany: jest.fn(async () => state.journals) },
    supplier: {
      findFirst: jest.fn(async () => ({ id: 'supplier', name: 'Supplier', supplierCode: 'S-1' })),
    },
    supplierStatementRun: {
      create: jest.fn(async ({ data }) => ({ ...data, id: 'run', generatedAt: day('2026-04-01') })),
      findFirst: jest.fn(),
    },
  };
  const companies: any = { assertCanAccessCompany: jest.fn(async () => {}) };
  const service = new SupplierStatementsService(
    prisma,
    { log: jest.fn(async () => {}) } as any,
    companies,
  );
  const generate = (periodStart = '2026-02-01', periodEnd = '2026-02-28') =>
    service.generate(
      { companyId: 'company', supplierId: 'supplier', currency: 'TZS', periodStart, periodEnd },
      user,
    );
  const exported = async (periodStart = '2026-02-01', periodEnd = '2026-03-31') => {
    const run = await generate(periodStart, periodEnd);
    prisma.supplierStatementRun.findFirst.mockResolvedValue(run);
    return (await service.export('run', 'csv', user)).buffer.toString('utf8');
  };
  const projected = async () => {
    const [run] = await service.projectSavedRuns(
      [
        {
          id: 'saved',
          companyId: 'company',
          supplierId: 'supplier',
          currency: 'TZS',
          periodStart: day('2026-02-01'),
          periodEnd: day('2026-03-31'),
          openingBalance: D(0),
          totalDebits: D(0),
          totalCredits: D(0),
          closingBalance: D(0),
        },
      ] as any,
      user,
    );
    return run;
  };
  return { state, prisma, service, generate, exported, projected };
}

function adjust(state: any, direction: 'INCREASE' | 'DECREASE', reversed = false) {
  const amount = D(direction === 'INCREASE' ? 200 : 100);
  const id = direction.toLowerCase();
  const transactionDate = day(direction === 'INCREASE' ? '2026-02-20' : '2026-02-15');
  const journal: any = {
    ...scope,
    id: `${id}-je`,
    journalNumber: `JE-${id}`,
    status: reversed ? 'REVERSED' : 'POSTED',
    transactionDate,
    description: `Payable ${id} adjustment AP-1`,
    referenceType: 'AccountAdjustment',
    referenceId: id,
    reversalOfId: null,
    lines: [direction === 'INCREASE' ? ap(0, amount.toNumber()) : ap(amount.toNumber())],
    reversedBy_: [],
  };
  const mirror: any = {
    ...scope,
    id: `${id}-mirror`,
    journalNumber: `JE-${id}-REV`,
    status: 'POSTED',
    transactionDate: day(direction === 'INCREASE' ? '2026-03-10' : '2026-03-05'),
    description: 'Reversal of account adjustment',
    referenceType: 'AccountAdjustment',
    referenceId: id,
    reversalOfId: journal.id,
    lines: [direction === 'INCREASE' ? ap(amount.toNumber()) : ap(0, amount.toNumber())],
  };
  if (reversed) journal.reversedBy_ = [mirror];
  const event = {
    ...party,
    id,
    targetPayableId: 'payable',
    generatedPayableId: direction === 'INCREASE' ? 'generated' : null,
    direction,
    amount,
    transactionDate,
    reason: 'Agreed supplier balance correction',
    status: reversed ? 'REVERSED' : 'POSTED',
    journalEntryId: journal.id,
    journalEntry: journal,
    reversalJournalEntryId: reversed ? mirror.id : null,
    reversalJournalEntry: reversed ? mirror : null,
    reversalReason: reversed ? 'Correction was incorrect' : null,
  };
  state.adjustments.push(event);
  if (direction === 'INCREASE')
    state.payables.push({
      ...state.payables[0],
      id: 'generated',
      payableNumber: 'AP-ADJ',
      issueDate: transactionDate,
      sourceType: 'AccountAdjustment',
      sourceId: id,
      amount,
      outstandingAmount: reversed ? D(0) : amount,
      status: reversed ? 'CANCELLED' : 'OPEN',
      journalEntryId: journal.id,
    });
  else state.payables[0].outstandingAmount = reversed ? D(1000) : D(900);
  // Even if both the source and mirror are loaded, neither may be recovered twice.
  state.journals.push(journal);
  if (reversed) state.journals.push(mirror);
  return { event, journal, mirror };
}

describe('Supplier statement non-cash adjustments', () => {
  it('applies a decrease on its dated credit while preserving the original payable and paid amount', async () => {
    const f = fixture();
    adjust(f.state, 'DECREASE');
    const before = await f.generate('2026-02-01', '2026-02-14');
    expect(before.closingBalance.toFixed(2)).toBe('1000.00');
    const after = await f.generate();
    expect(after.totalDebits.toFixed(2)).toBe('1000.00');
    expect(after.totalCredits.toFixed(2)).toBe('100.00');
    expect(after.closingBalance.toFixed(2)).toBe('900.00');
    expect(f.state.payables[0].amount.toFixed(2)).toBe('1000.00');
    expect(f.state.payables[0].paidAmount.toFixed(2)).toBe('0.00');
    const csv = await f.exported();
    expect(csv).toContain(
      '2026-02-15,ADJUSTMENT,JE-decrease,Non-cash balance decrease AP-1 / Agreed supplier balance correction,0.00,100.00,900.00',
    );
    expect(csv).not.toContain(',PAYMENT,');
  });

  it('uses the posted reversal date for a decrease rather than its current restored balance', async () => {
    const f = fixture();
    adjust(f.state, 'DECREASE', true);
    expect((await f.generate()).closingBalance.toFixed(2)).toBe('900.00');
    const march = await f.generate('2026-03-01', '2026-03-31');
    expect(march.openingBalance.toFixed(2)).toBe('900.00');
    expect(march.totalDebits.toFixed(2)).toBe('100.00');
    expect(march.totalCredits.toFixed(2)).toBe('0.00');
    expect(march.closingBalance.toFixed(2)).toBe('1000.00');
  });

  it('classifies a generated increase once as an adjustment rather than a second payable plus event', async () => {
    const f = fixture();
    adjust(f.state, 'INCREASE');
    expect((await f.generate('2026-02-01', '2026-02-19')).closingBalance.toFixed(2)).toBe(
      '1000.00',
    );
    const after = await f.generate();
    expect(after.totalDebits.toFixed(2)).toBe('1200.00');
    expect(after.totalCredits.toFixed(2)).toBe('0.00');
    expect(after.closingBalance.toFixed(2)).toBe('1200.00');
    const csv = await f.exported();
    expect(csv.match(/Non-cash balance increase AP-ADJ/g)).toHaveLength(1);
    expect(csv).not.toContain(',PAYABLE,AP-ADJ,');
  });

  it('reverses an increase once, excludes its accrual/mirror from legacy recovery and retains earlier debt', async () => {
    const f = fixture();
    adjust(f.state, 'INCREASE', true);
    expect((await f.generate()).closingBalance.toFixed(2)).toBe('1200.00');
    const march = await f.generate('2026-03-01', '2026-03-31');
    expect(march.openingBalance.toFixed(2)).toBe('1200.00');
    expect(march.totalCredits.toFixed(2)).toBe('200.00');
    expect(march.closingBalance.toFixed(2)).toBe('1000.00');
    const csv = await f.exported();
    expect(csv.match(/Reversal of non-cash balance increase AP-ADJ/g)).toHaveLength(1);
    expect(csv).not.toContain('HISTORY_INCOMPLETE');
  });

  it.each(['INCREASE', 'DECREASE'] as const)(
    'refuses a %s reversal backed only by a draft or unrelated journal',
    async (direction) => {
      const f = fixture();
      const { mirror } = adjust(f.state, direction, true);
      mirror.status = 'DRAFT';
      await expect(f.generate()).rejects.toThrow('settlement history is reconciled');
      mirror.status = 'POSTED';
      mirror.reversalOfId = 'unrelated-original';
      await expect(f.generate()).rejects.toThrow('settlement history is reconciled');
    },
  );

  it.each(['INCREASE', 'DECREASE'] as const)(
    'does not negate a %s when its mirror has itself been reversed',
    async (direction) => {
      const f = fixture();
      const { mirror } = adjust(f.state, direction, true);
      mirror.status = 'REVERSED';
      const provisional = await f.projected();
      expect(provisional.closingBalance.toFixed(2)).toBe(
        direction === 'INCREASE' ? '1200.00' : '900.00',
      );
      expect(provisional.settlementHistory.status).toBe('INCOMPLETE');
      await expect(f.generate()).rejects.toThrow('settlement history is reconciled');
    },
  );

  it.each(['orphan', 'mismatch', 'missing-generated'] as const)(
    'retains late %s generated-increase gaps in returned history',
    async (fault) => {
      const f = fixture();
      adjust(f.state, 'INCREASE');
      if (fault === 'orphan') f.state.adjustments = [];
      else if (fault === 'mismatch') f.state.payables[1].amount = D(201);
      else f.state.payables.pop();
      const provisional = await f.projected();
      expect(provisional.settlementHistory.status).toBe('INCOMPLETE');
      expect(provisional.settlementHistory.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: expect.stringMatching(
              /Generated account increase has no matching adjustment event|Account increase has no generated payable/,
            ),
          }),
        ]),
      );
      expect(Number(provisional.settlementHistory.unresolvedAmount)).toBeGreaterThan(0);
      await expect(f.generate()).rejects.toThrow('settlement history is reconciled');
      expect(f.prisma.supplierStatementRun.create).not.toHaveBeenCalled();
    },
  );

  it('keeps a real cash allocation against an increased payable in PAYMENT history', async () => {
    const f = fixture();
    adjust(f.state, 'INCREASE');
    f.state.payables[1].paidAmount = D(50);
    f.state.payables[1].outstandingAmount = D(150);
    f.state.payments.push({
      id: 'payment',
      paymentNumber: 'SP-1',
      paymentDate: day('2026-02-22'),
      amount: D(50),
      method: 'CASH',
      status: 'COMPLETED',
      journalEntryId: 'payment-je',
      allocations: [{ payableId: 'generated', amount: D(50) }],
    });
    const run = await f.generate();
    expect(run.closingBalance.toFixed(2)).toBe('1150.00');
    const csv = await f.exported();
    expect(csv).toContain('2026-02-22,PAYMENT,SP-1,Payment · CASH,0.00,50.00,1150.00');
  });

  it.each(['companyId', 'supplierId', 'currency', 'branchId'] as const)(
    'rejects mismatched adjustment %s without inventing relief',
    async (field) => {
      const f = fixture();
      const { event } = adjust(f.state, 'DECREASE');
      event[field] = 'other';
      await expect(f.generate()).rejects.toThrow('settlement history is reconciled');
      expect(f.prisma.supplierStatementRun.create).not.toHaveBeenCalled();
    },
  );

  it('uses supplier/company/currency boundaries when loading all historical adjustment events', async () => {
    const f = fixture();
    await f.generate();
    expect(f.prisma.accountAdjustment.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'company',
      supplierId: 'supplier',
      currency: 'TZS',
      targetPayableId: { not: null },
      status: { in: ['POSTED', 'REVERSED'] },
    });
    expect(
      f.prisma.accountAdjustment.findMany.mock.calls[0][0].include.journalEntry.select.reversedBy_,
    ).toBeDefined();
  });

  it('reconstructs a new legacy payment mirror linked only through reversalOfId, exactly once', async () => {
    const f = fixture();
    const mirror = {
      ...scope,
      id: 'legacy-mirror',
      journalNumber: 'JE-LEGACY-REV',
      transactionDate: day('2026-03-02'),
      status: 'POSTED',
      referenceType: 'PayablePaymentReversal',
      referenceId: 'legacy-je',
      reversalOfId: 'legacy-je',
      description: 'Reversal of historical payment',
      lines: [ap(0, 200), cash(200)],
    };
    f.state.journals.push({
      ...scope,
      id: 'legacy-je',
      journalNumber: 'JE-LEGACY',
      transactionDate: day('2026-02-12'),
      status: 'REVERSED',
      referenceType: 'Payable',
      referenceId: 'payable',
      reversalOfId: null,
      description: 'Payable settlement AP-1',
      lines: [ap(200), cash(0, 200)],
      reversedBy_: [mirror],
    });
    expect((await f.generate()).closingBalance.toFixed(2)).toBe('800.00');
    const march = await f.generate('2026-03-01', '2026-03-31');
    expect(march.openingBalance.toFixed(2)).toBe('800.00');
    expect(march.totalDebits.toFixed(2)).toBe('200.00');
    expect(march.closingBalance.toFixed(2)).toBe('1000.00');
    const query = f.prisma.journalEntry.findMany.mock.calls[0][0];
    expect(query.select.reversedBy_.select).toMatchObject({
      reversalOfId: true,
      referenceType: true,
      lines: expect.anything(),
    });
  });
});
