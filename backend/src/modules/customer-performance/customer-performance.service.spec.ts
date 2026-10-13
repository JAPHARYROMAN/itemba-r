import { Prisma } from '@prisma/client';
import { CustomerAccountSnapshot } from '../customer-statements/customer-account-projection.types';
import {
  CustomerPerformanceService,
  customerPerformancePeriod,
  customerPerformanceRows,
} from './customer-performance.service';
import { CustomerPerformanceQueryDto } from './customer-performance.dto';

const D = (value: number | string) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T00:00:00Z`);
const query = {
  companyId: 'company',
  branchId: 'branch',
  currency: 'TZS',
  dateFrom: '2026-10-01',
  dateTo: '2026-10-12',
  page: 1,
  limit: 25,
} as CustomerPerformanceQueryDto;
const user = {
  id: 'user',
  permissions: [
    'customers.view',
    'sales.view',
    'receivables.view',
    'cash_desk.view',
    'customer-payments.view',
  ],
} as any;
const access = { sales: true, balances: true, receipts: true };
function account(id: string, sales = 1000, punctual = 100): CustomerAccountSnapshot {
  return {
    customer: {
      id,
      name: id,
      customerCode: id.toUpperCase(),
      companyId: 'company',
      createdAt: date('2026-01-01'),
      email: null,
      phone: null,
      address: null,
      company: { id: 'company', code: 'CO', name: 'Company' },
    },
    sales: [
      {
        id: `sale-${id}`,
        date: date('2026-10-01'),
        totalAmount: D(sales),
        taxAmount: D(0),
        status: 'CONFIRMED',
        paymentMethod: 'CREDIT',
        sourceUrl: '/sales-desk/sales',
      },
    ],
    movements: [],
    obligations: Array.from({ length: 5 }, (_, index) => ({
      id: `${id}-r${index}`,
      issueDate: date('2026-09-20'),
      dueDate: date('2026-10-02'),
      amount: D(100),
      outstanding: D(0),
      payments: [
        {
          date: date('2026-10-01'),
          amount: D(punctual),
          paymentId: `${id}-pay-${index}`,
          reversedAt: null,
        },
        {
          date: date('2026-10-05'),
          amount: D(100 - punctual),
          paymentId: `${id}-late-${index}`,
          reversedAt: null,
        },
      ],
    })),
    payments: [
      {
        id: `${id}-pay`,
        date: date('2026-10-01'),
        reference: `PAY-${id}`,
        amount: D(500),
        appliedAmount: D(475),
        unappliedAmount: D(25),
        method: 'BANK_TRANSFER',
        status: 'COMPLETED',
        reversedAt: null,
        sourceType: 'CustomerPayment',
        sourceUrl: '/finance/payments',
        allocations: [],
      },
    ],
    aging: {
      current: D(0),
      days1to30: D(0),
      days31to60: D(0),
      days61to90: D(0),
      over90: D(0),
      total: D(0),
    } as any,
    openInvoiceBalance: D(0),
    customerCredit: D(25),
    netBalance: D(-25),
    warnings: [],
  };
}
function fixture(accounts = [account('Acacia')]) {
  const projection = {
    read: jest.fn().mockResolvedValue({
      accounts,
      currency: 'TZS',
      asOf: date('2026-10-13'),
      warnings: ['Direct sales remain separate.'],
    }),
  };
  return { projection, service: new CustomerPerformanceService(projection as any) };
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-13T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('Customer Performance', () => {
  it('keeps sales contribution separate from punctuality with exact boundary rules', () => {
    const rows = customerPerformanceRows(
      [account('Best', 1000, 95), account('Good', 900, 90), account('Late', 2000, 89)],
      customerPerformancePeriod(query),
      access,
    );
    expect(rows.find((row) => row.id === 'Late')).toMatchObject({
      salesRank: 1,
      category: 'needs-attention',
      onTimePercent: 89,
    });
    expect(rows.find((row) => row.id === 'Best')).toMatchObject({
      salesRank: 2,
      category: 'good',
      onTimePercent: 95,
    });
    expect(rows.find((row) => row.id === 'Good')).toMatchObject({
      category: 'good',
      onTimePercent: 90,
    });
    const best = customerPerformanceRows(
      [account('Best', 1000, 95), account('Good', 900, 90)],
      customerPerformancePeriod(query),
      access,
    );
    expect(best[0].category).toBe('best');
  });
  it('flags overdue debt before strong sales or insufficient-history categories', () => {
    const one = account('Early', 999999);
    one.obligations = one.obligations.slice(0, 1);
    one.obligations[0].outstanding = D(100);
    one.openInvoiceBalance = D(100);
    const [row] = customerPerformanceRows([one], customerPerformancePeriod(query), access);
    expect(row).toMatchObject({
      category: 'needs-attention',
      overdue: '100.00',
      oldestDaysOverdue: 11,
      eligibleInvoiceCount: 1,
    });
  });
  it('does not rate payment reliability when settlement evidence is incomplete', () => {
    const value = account('Incomplete', 999999, 100);
    value.settlementHistory = {
      status: 'INCOMPLETE',
      recoveredLegacySettlements: 0,
      unresolvedAmount: '5.00',
      gaps: [
        {
          documentId: 'invoice',
          reference: 'INV',
          amount: '5.00',
          reason: 'Missing dated evidence',
        },
      ],
    };
    const [row] = customerPerformanceRows([value], customerPerformancePeriod(query), access);
    expect(row).toMatchObject({ category: 'insufficient-history', onTimePercent: null });
    expect(row.reasons).toContain(
      'Resolve incomplete account history before assessing payment reliability.',
    );
  });
  it('keeps values just below rating thresholds visibly below the cutoff', () => {
    const [belowGood] = customerPerformanceRows(
      [account('Boundary', 1000, 89.99)],
      customerPerformancePeriod(query),
      access,
    );
    const [belowBest] = customerPerformanceRows(
      [account('Boundary', 1000, 94.99)],
      customerPerformancePeriod(query),
      access,
    );
    expect(belowGood).toMatchObject({ onTimePercent: 89.9, category: 'needs-attention' });
    expect(belowBest).toMatchObject({ onTimePercent: 94.9, category: 'good' });
  });
  it('leaves short history, missing terms and cash-only customers unscored', () => {
    const short = account('Short');
    short.obligations.pop();
    const missing = account('Missing');
    missing.obligations.push({
      ...missing.obligations[0],
      id: 'no-terms',
      issueDate: date('2026-10-01'),
      dueDate: null,
    });
    const cash = account('Cash');
    cash.obligations = [];
    cash.sales[0].paymentMethod = 'CASH';
    const rows = customerPerformanceRows(
      [short, missing, cash],
      customerPerformancePeriod(query),
      access,
    );
    expect(rows.map((row) => row.category)).toEqual([
      'insufficient-history',
      'insufficient-history',
      'insufficient-history',
    ]);
    expect(rows[2].paymentLabel).toBe('paid-at-sale');
    expect(rows[2].onTimePercent).toBeNull();
  });
  it('does not grade due-today invoices before their payment deadline passes', () => {
    const value = account('Today');
    value.obligations.forEach((invoice) => (invoice.dueDate = date('2026-10-13')));
    const [row] = customerPerformanceRows(
      [value],
      customerPerformancePeriod({ ...query, dateTo: '2026-10-13' }),
      access,
    );
    expect(row).toMatchObject({
      category: 'insufficient-history',
      eligibleInvoiceCount: 0,
      overdue: '0.00',
    });
  });
  it('uses allocation dates and caps on-time value without treating deposits as invoice settlement', () => {
    const value = account('Allocation');
    value.obligations.forEach(
      (invoice) =>
        (invoice.payments = [
          {
            date: date('2026-10-04'),
            amount: D(100),
            paymentId: 'old-unapplied-receipt',
            reversedAt: null,
          },
        ]),
    );
    value.payments[0].unappliedAmount = D(10000);
    value.payments[0].amount = D(10500);
    const [row] = customerPerformanceRows([value], customerPerformancePeriod(query), access);
    expect(row).toMatchObject({
      collected: '10500.00',
      onTimePercent: 0,
      category: 'needs-attention',
    });
  });
  it('subtracts credited sales once and does not subtract the corresponding cash refund', () => {
    const value = account('Returns');
    value.movements.push({
      date: date('2026-10-07'),
      type: 'CREDIT_NOTE',
      sourceType: 'CreditNote',
      sourceId: 'cn',
      sourceUrl: '/finance/credit-notes',
      salesOrderId: value.sales[0].id,
      reference: 'CN1',
      description: 'Return',
      debit: D(0),
      credit: D(200),
    });
    value.movements.push({
      date: date('2026-10-08'),
      type: 'REFUND',
      sourceType: 'Refund',
      sourceId: 'refund',
      sourceUrl: '/finance/refunds',
      salesOrderId: value.sales[0].id,
      reference: 'RF1',
      description: 'Refund',
      debit: D(200),
      credit: D(0),
    });
    expect(
      customerPerformanceRows([value], customerPerformancePeriod(query), access)[0].netSales,
    ).toBe('800.00');
  });
  it('nets receipt reversals on their dates without erasing earlier period cash receipts', () => {
    const value = account('Reversed');
    value.payments[0].status = 'REVERSED';
    value.payments[0].reversedAt = date('2026-10-13');
    expect(
      customerPerformanceRows([value], customerPerformancePeriod(query), access)[0].collected,
    ).toBe('500.00');
    expect(
      customerPerformanceRows(
        [value],
        customerPerformancePeriod({ ...query, dateTo: '2026-10-13' }),
        access,
      )[0].collected,
    ).toBe('0.00');
  });
  it('keeps historical punctuality unchanged when a receipt reverses after the evaluation period', () => {
    const value = account('Historical', 1000, 100);
    value.obligations.forEach((invoice) => (invoice.payments[0].reversedAt = date('2026-10-13')));
    const [historical] = customerPerformanceRows([value], customerPerformancePeriod(query), access);
    const [current] = customerPerformanceRows(
      [value],
      customerPerformancePeriod({ ...query, dateTo: '2026-10-13' }),
      access,
    );
    expect(historical).toMatchObject({ onTimePercent: 100, category: 'best' });
    expect(current).toMatchObject({ onTimePercent: 0, category: 'needs-attention' });
  });
  it('does not let an old settled invoice without terms block a complete recent cohort', () => {
    const value = account('Old terms');
    value.obligations.push({
      ...value.obligations[0],
      id: 'old',
      issueDate: date('2020-01-01'),
      dueDate: null,
      outstanding: D(0),
    });
    expect(
      customerPerformanceRows([value], customerPerformancePeriod(query), access)[0],
    ).toMatchObject({ category: 'best', missingDueDateCount: 0 });
  });
  it('removes an invoice cancelled before its deadline from the credit-payment cohort', () => {
    const value = account('Cancelled before due');
    const invoice = value.obligations[0];
    invoice.payments = [];
    value.movements.push(
      {
        date: date('2026-09-20'),
        type: 'INVOICE',
        reference: 'AR-CANCEL',
        description: 'Invoice',
        sourceType: 'Receivable',
        sourceId: invoice.id,
        sourceUrl: '/finance/receivables',
        receivableId: invoice.id,
        debit: D(100),
        credit: D(0),
      },
      {
        date: date('2026-10-01'),
        type: 'ADJUSTMENT',
        reference: 'AR-CANCEL-REV',
        description: 'Cancellation',
        sourceType: 'Receivable',
        sourceId: invoice.id,
        sourceUrl: '/finance/receivables',
        receivableId: invoice.id,
        debit: D(0),
        credit: D(100),
        reversalOfId: `Receivable:${invoice.id}`,
      },
    );
    expect(
      customerPerformanceRows([value], customerPerformancePeriod(query), access)[0],
    ).toMatchObject({
      eligibleInvoiceCount: 4,
      onTimePercent: 100,
      category: 'insufficient-history',
    });
  });
  it('includes an older receipt reversed in the selected period so negative net receipts can be explained', async () => {
    const value = account('Acacia');
    value.payments[0].date = date('2026-09-01');
    value.payments[0].reversedAt = date('2026-10-05');
    value.payments[0].status = 'REVERSED';
    const { service } = fixture([value]);
    const result = await service.history(user, 'Acacia', query);
    expect(result).toMatchObject({ total: 1, performance: { collected: '-500.00' } });
    expect(result.rows[0]).toMatchObject({ date: '2026-09-01', reversedAt: '2026-10-05' });
  });
  it.each(['SalesOrder', 'Receivable'])(
    'reduces cancelled %s sales once, preserves prior revenue and excludes write-offs from sales',
    (sourceType) => {
      const value = account('Cancelled');
      const invoice = {
        date: date('2026-10-01'),
        type: 'INVOICE' as const,
        reference: 'SALE',
        description: 'Sale',
        sourceType,
        sourceId: 'invoice',
        sourceUrl: '/sales-desk/sales',
        salesOrderId: value.sales[0].id,
        debit: D(1000),
        credit: D(0),
      };
      value.movements.push(invoice, {
        ...invoice,
        date: date('2026-10-13'),
        type: 'ADJUSTMENT',
        reference: 'SALE-REV',
        debit: D(0),
        credit: D(1000),
        reversalOfId: `${sourceType}:invoice`,
      });
      if (sourceType === 'SalesOrder') {
        value.movements.push(
          { ...invoice, type: 'PAYMENT', debit: D(0), credit: D(1000) },
          {
            ...invoice,
            date: date('2026-10-13'),
            type: 'ADJUSTMENT',
            reference: 'PAY-REV',
            debit: D(1000),
            credit: D(0),
            reversalOfId: `${sourceType}:invoice`,
          },
        );
      }
      value.movements.push({
        ...invoice,
        date: date('2026-10-08'),
        type: 'ADJUSTMENT',
        sourceType: 'JournalEntry',
        sourceId: 'writeoff',
        reference: 'WO',
        description: 'Write-off',
        debit: D(0),
        credit: D(200),
      });
      expect(
        customerPerformanceRows([value], customerPerformancePeriod(query), access)[0].netSales,
      ).toBe('1000.00');
      expect(
        customerPerformanceRows(
          [value],
          customerPerformancePeriod({ ...query, dateTo: '2026-10-13' }),
          access,
        )[0].netSales,
      ).toBe('0.00');
    },
  );
  it('masks financial values and classification when financial permissions are absent', async () => {
    const { service } = fixture();
    const restricted = { ...user, permissions: ['customers.view', 'sales.view'] };
    const result = await service.read(restricted, query);
    expect(result.rows[0]).toMatchObject({
      category: 'insufficient-history',
      paymentLabel: 'restricted',
      outstanding: null,
      overdue: null,
      collected: null,
      customerCredit: null,
      netDue: null,
      onTimePercent: null,
    });
    expect(result.summary.collected).toBeNull();
    const history = await service.history(restricted, 'Acacia', query);
    expect(history.rows).toEqual([]);
    expect(history.access.receipts).toBe(false);
  });
  it('withholds a payment rating when reconstruction evidence is incomplete, without exposing private references', async () => {
    const value = account('Incomplete', 10000, 100);
    value.integrityIssues = ['missing-reversal'];
    value.warnings = ['Payment PRIVATE-REFERENCE has no dated reversal evidence.'];
    const [row] = customerPerformanceRows([value], customerPerformancePeriod(query), access);
    expect(row).toMatchObject({
      category: 'insufficient-history',
      paymentLabel: 'insufficient-history',
      onTimePercent: null,
    });
    expect(row.reasons).toEqual([
      'Resolve incomplete account history before assessing payment reliability.',
    ]);
    const { service } = fixture([value]);
    const restricted = await service.read(
      { ...user, permissions: ['customers.view', 'sales.view'] },
      query,
    );
    expect(JSON.stringify(restricted)).not.toContain('PRIVATE-REFERENCE');
  });
  it('keeps ratings available for informational partial scoped receipts with fully known allocations', () => {
    const value = account('Scoped', 10000, 100);
    value.warnings = [
      'Payment shows only allocations in this organizational scope; unassigned deposits are excluded.',
    ];
    value.integrityIssues = [];
    expect(
      customerPerformanceRows([value], customerPerformancePeriod(query), access)[0],
    ).toMatchObject({ category: 'best', onTimePercent: 100 });
  });
  it('labels scoped settlement collections and returns informational source coverage only with receipt access', async () => {
    const scoped = account('Scoped');
    scoped.warnings = [
      'Scoped receipt: Invoice payment allocation shows only allocations in this organizational scope; unassigned deposits are excluded.',
    ];
    const { service } = fixture([scoped, account('Actual')]);
    const result = await service.read(user, query);
    expect(result.receiptBasis).toBe('scoped-settlements');
    expect(result.rows.find((row) => row.id === 'Scoped')?.receiptBasis).toBe('scoped-settlements');
    expect(result.rows.find((row) => row.id === 'Actual')?.receiptBasis).toBe('actual-receipts');
    expect(result.warnings).toContain(scoped.warnings[0]);
    const history = await service.history(user, 'Scoped', query);
    expect(history.receiptBasis).toBe('scoped-settlements');
    expect(history.warnings).toContain(scoped.warnings[0]);
    const restricted = await service.read(
      { ...user, permissions: ['customers.view', 'sales.view'] },
      query,
    );
    expect(restricted.receiptBasis).toBeNull();
    expect(restricted.warnings).toEqual([]);
  });
  it('ranks and totals the complete scoped dataset before stable pagination and forwards every scope and currency', async () => {
    const { service, projection } = fixture([
      account('Alpha', 100),
      account('Beta', 300),
      account('Gamma', 200),
    ]);
    const result = await service.read(user, {
      ...query,
      divisionId: 'division',
      currency: 'USD',
      page: 2,
      limit: 1,
    });
    expect(result.rows[0]).toMatchObject({ name: 'Gamma', salesRank: 2 });
    expect(result).toMatchObject({ total: 3, page: 2, limit: 1, asOf: '2026-10-13' });
    expect(result.summary.netSales).toBe('600.00');
    expect(projection.read).toHaveBeenCalledWith(user, {
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      currency: 'USD',
      dateTo: '2026-10-13',
    });
  });
  it('returns every payment lane, allocation reference and reversal in the paginated history', async () => {
    const value = account('Acacia');
    value.movements.push({
      date: date('2026-09-20'),
      type: 'INVOICE',
      reference: 'AR-001',
      description: 'Invoice',
      sourceType: 'Receivable',
      sourceId: 'r1',
      sourceUrl: '/finance/receivables',
      receivableId: 'r1',
      debit: D(100),
      credit: D(0),
    });
    value.payments[0].allocations = [
      {
        receivableId: 'r1',
        amount: D(100),
        date: date('2026-10-01'),
        issueDate: date('2026-09-20'),
        dueDate: date('2026-10-02'),
      },
    ];
    value.payments.push({
      ...value.payments[0],
      id: 'legacy',
      sourceType: 'Receivable',
      reference: 'JE-SETTLE',
      date: date('2026-10-04'),
      status: 'REVERSED',
      reversedAt: date('2026-10-08'),
    });
    const { service } = fixture([value]);
    const result = await service.history(user, 'Acacia', { ...query, limit: 1 });
    expect(result).toMatchObject({ total: 2, performance: { id: 'Acacia' } });
    expect(result.rows[0]).toMatchObject({
      id: 'legacy',
      sourceType: 'Receivable',
      status: 'REVERSED',
      reversedAt: '2026-10-08',
      allocations: [
        { receivableId: 'r1', reference: 'AR-001', amount: '100.00', dueDate: '2026-10-02' },
      ],
    });
  });
  it('rejects denied basic access, out-of-scope customer IDs and invalid pagination', async () => {
    const { service } = fixture();
    await expect(service.read({ ...user, permissions: ['sales.view'] }, query)).rejects.toThrow(
      'Customer and sales access',
    );
    await expect(service.history(user, 'another-company-customer', query)).rejects.toThrow(
      'Customer not found in this scope',
    );
    await expect(service.read(user, { ...query, limit: 101 })).rejects.toThrow('valid page');
  });
  it('uses Nairobi calendar dates, equal prior periods, and validates future or reversed ranges', () => {
    const period = customerPerformancePeriod({} as any, new Date('2026-10-12T22:00:00Z'));
    expect(period).toMatchObject({
      today: '2026-10-13',
      dateFrom: '2026-07-16',
      dateTo: '2026-10-13',
    });
    expect(customerPerformancePeriod(query)).toMatchObject({
      previousFrom: '2026-09-19',
      previousTo: '2026-09-30',
    });
    expect(() =>
      customerPerformancePeriod({ ...query, dateFrom: '2026-10-12', dateTo: '2026-10-01' }),
    ).toThrow('valid date range');
    expect(() => customerPerformancePeriod({ ...query, dateTo: '2026-10-14' })).toThrow(
      'valid date range',
    );
    expect(() => customerPerformancePeriod({ ...query, dateFrom: '2026-02-30' })).toThrow(
      'valid date range',
    );
  });
});
