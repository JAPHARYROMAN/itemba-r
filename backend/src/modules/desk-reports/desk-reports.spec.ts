import { Prisma } from '@prisma/client';
import { reportPeriod, tradeReport, TradeDocument } from './desk-reports.domain';
import { cashReport } from './desk-reports.cash';
import { DeskReportsService } from './desk-reports.service';
import { DeskReportsController } from './desk-reports.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
const d = (v: string) => new Prisma.Decimal(v),
  date = (v: string) => new Date(v),
  q = { from: '2026-09-01', to: '2026-09-30' };
const doc = (patch: Partial<TradeDocument> = {}): TradeDocument => ({
  id: 'old',
  reference: 'INV-01',
  date: date('2026-08-01'),
  dueDate: date('2026-08-31'),
  amount: d('100.00'),
  currency: 'TZS',
  partyId: 'customer',
  party: 'Customer',
  company: 'Company',
  companyId: 'co',
  division: 'Division',
  divisionId: 'div',
  branch: 'Branch',
  branchId: 'br',
  payments: [
    { id: 'before', date: date('2026-08-20'), amount: d('20'), reference: 'before' },
    { id: 'during', date: date('2026-09-10'), amount: d('30'), reference: 'during' },
    { id: 'future', date: date('2026-10-10'), amount: d('15'), reference: 'future' },
  ],
  ...patch,
});
describe('Reports accounting', () => {
  it('reconciles opening + period invoices - period payments to closing and running statement', () => {
    const r = tradeReport(
      [
        doc(),
        doc({
          id: 'new',
          reference: 'INV-02',
          date: date('2026-09-05'),
          dueDate: date('2026-10-01'),
          amount: d('50'),
          payments: [
            { id: 'new-pay', date: date('2026-09-08'), amount: d('10'), reference: 'new' },
          ],
        }),
      ],
      q,
      'Sales Desk',
    );
    expect(r.currencies[0]).toMatchObject({
      opening: '80.00',
      issued: '50.00',
      paid: '40.00',
      closing: '90.00',
      overdue: '50.00',
      count: 1,
    });
    const statement = r.tables.find((t) => t.id === 'statement')!.rows;
    expect(statement.map((row) => row.balance)).toEqual(['130.00', '120.00', '90.00']);
    expect(r.tables.find((t) => t.id === 'payments')!.rows).toHaveLength(2);
    expect(r.tables.find((t) => t.id === 'ageing')!.rows[0]).toMatchObject({
      current: '40.00',
      days1to30: '50.00',
      closing: '90.00',
    });
  });
  it('uses due dates for every ageing bucket and preserves distinct currencies', () => {
    const dates = ['2026-10-01', '2026-09-01', '2026-08-01', '2026-07-10', '2026-01-01'];
    const r = tradeReport(
      [
        ...dates.map((dueDate, i) =>
          doc({ id: String(i), dueDate: date(dueDate), payments: [], amount: d('1.11') }),
        ),
        doc({ id: 'usd', currency: 'USD', amount: d('9007199254740993.11'), payments: [] }),
      ],
      q,
      'Invoice Desk',
    );
    expect(r.currencies).toHaveLength(2);
    expect(r.currencies.find((c) => c.currency === 'USD')!.closing).toBe('9007199254740993.11');
    const tzs = r.tables
      .find((t) => t.id === 'ageing')!
      .rows.find((row) => row.currency === 'TZS')!;
    for (const key of ['current', 'days1to30', 'days31to60', 'days61to90', 'days90plus'])
      expect(tzs[key]).toBe('1.11');
  });
  it('fills missing trend months with zeros and compares equal-length prior periods', () => {
    const period = reportPeriod(q);
    expect(period.previousFrom).toBe('2026-08-02');
    expect(period.previousTo).toBe('2026-08-31');
    const r = tradeReport(
      [doc({ date: date('2026-06-01'), payments: [] })],
      { from: '2026-06-01', to: '2026-09-30' },
      'Sales Desk',
    );
    expect(r.tables.find((t) => t.id === 'monthly')!.rows.map((row) => row.issued)).toEqual([
      '100.00',
      '0.00',
      '0.00',
      '0.00',
    ]);
  });
  it('validates calendar dates and avoids silently accepting impossible report periods', () => {
    for (const bad of [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10-01', to: '2026-09-01' },
    ])
      expect(() => reportPeriod(bad)).toThrow();
  });
  it('cash includes signed reversals and transfers without treating them as expenses', () => {
    const account = {
      id: 'a',
      name: 'Bank',
      currency: 'TZS',
      companyId: 'co',
      divisionId: 'div',
      branchId: 'br',
      company: { name: 'Company' },
      division: { name: 'Division' },
      branch: { name: 'Branch' },
    };
    const entry = (id: string, value: string, kind: string, day: string, reversed = false) => ({
      id,
      businessDate: date(day),
      amount: d(value),
      account,
      movement: {
        id,
        kind,
        description: id,
        reference: id,
        payee: 'Vendor',
        expenseCategory: 'RENT',
        reversedAt: reversed ? date('2026-09-20') : null,
        reversalOfId: kind === 'REVERSAL' ? 'reversed-expense' : null,
      },
    });
    const r = cashReport(
      [
        entry('opening', '500', 'OPENING', '2026-08-01'),
        entry('expense', '-20.10', 'EXPENSE', '2026-09-02'),
        entry('reversed-expense', '-30', 'EXPENSE', '2026-09-03', true),
        entry('transfer-out', '-50', 'TRANSFER', '2026-09-04'),
        {
          ...entry('transfer-in', '50', 'TRANSFER', '2026-09-04'),
          account: { ...account, id: 'b', name: 'Cash' },
        },
        entry('reversal', '30', 'REVERSAL', '2026-09-20'),
      ],
      q,
    );
    expect(r.currencies[0]).toMatchObject({
      opening: '500.00',
      closing: '479.90',
      expenses: '20.10',
      inflow: '80.00',
      outflow: '100.10',
    });
    expect(r.tables.find((t) => t.id === 'expenses')!.rows).toHaveLength(1);
    expect(r.tables.find((t) => t.id === 'statement')!.rows.at(-1)!.balance).toBe('479.90');
  });
});
describe('Reports read boundaries', () => {
  const user = { id: 'user', email: 'u@test.local', permissions: [], roles: [] } as AuthUser;
  it('scopes cash entries through their accessible accounts and retains signed history', async () => {
    const findMany = jest.fn().mockResolvedValue([]),
      tx = { cashDeskEntry: { count: jest.fn().mockResolvedValue(0), findMany } };
    const db = { $transaction: jest.fn(async (work) => work(tx)) },
      companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'allowed' }) },
      org = { recordWhereFor: jest.fn().mockResolvedValue({ branchId: { in: ['branch'] } }) };
    await new DeskReportsService(db as never, companies as never, org as never).cash(user, {
      ...q,
      currency: 'TZS',
      companyId: 'allowed',
      branchId: 'branch',
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      account: {
        AND: [
          {
            AND: [
              { companyId: 'allowed' },
              { branchId: { in: ['branch'] } },
              { divisionId: undefined, branchId: 'branch' },
            ],
          },
          { currency: 'TZS' },
        ],
      },
      businessDate: { lte: date(q.to) },
    });
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
  it.each([
    ['sales', 'salesDeskSale', 'salesDeskPayment', 'customerId'],
    ['purchases', 'invoiceDeskInvoice', 'invoiceDeskPayment', 'supplierId'],
  ])('%s is scoped and read from a repeatable snapshot', async (method, table, payments, party) => {
    const findMany = jest.fn().mockResolvedValue([]),
      tx = {
        [table]: { count: jest.fn().mockResolvedValue(0), findMany },
        [payments]: { count: jest.fn().mockResolvedValue(0) },
      };
    const db = { $transaction: jest.fn(async (work) => work(tx)) },
      companies = { companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'allowed' }) },
      org = {
        recordWhereFor: jest.fn().mockResolvedValue({ branchId: { in: ['allowed-branch'] } }),
      };
    const service = new DeskReportsService(db as never, companies as never, org as never);
    await service[method as 'sales' | 'purchases'](user, {
      ...q,
      companyId: 'allowed',
      divisionId: 'division',
      branchId: 'allowed-branch',
      partyId: 'party',
    });
    expect(companies.companyWhereFor).toHaveBeenCalledWith(user, 'allowed');
    expect(org.recordWhereFor).toHaveBeenCalledWith(user);
    expect(findMany.mock.calls[0][0].where.AND[1]).toMatchObject({
      [party]: 'party',
      voidedAt: null,
    });
    expect(findMany.mock.calls[0][0].where.AND[0].AND).toContainEqual({
      branchId: { in: ['allowed-branch'] },
    });
    expect(findMany.mock.calls[0][0].include.payments.where.reversedAt).toBeNull();
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });
  it('each report requires its source permission', () => {
    for (const [method, permission] of [
      ['sales', 'sales_desk.view'],
      ['purchases', 'invoice_desk.view'],
      ['cash', 'cash_desk.view'],
    ])
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, DeskReportsController.prototype[method as 'sales']),
      ).toEqual([permission]);
  });
  it('fails before fetching an oversized report rather than returning partial totals', async () => {
    const findMany = jest.fn(),
      tx = { salesDeskSale: { count: jest.fn().mockResolvedValue(20001), findMany } };
    const service = new DeskReportsService(
      { $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
      { companyWhereFor: async () => ({}) } as never,
      { recordWhereFor: async () => ({}) } as never,
    );
    await expect(service.sales(user, q)).rejects.toThrow('20,000');
    expect(findMany).not.toHaveBeenCalled();
  });
});
