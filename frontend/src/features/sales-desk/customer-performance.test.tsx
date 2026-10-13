import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerPerformancePage } from './customer-performance';
import { CustomerStatementWorkspace } from './customer-statement-workspace';
import {
  WorkspaceInstanceProvider,
  WorkspaceSessionProvider,
} from '@/components/workspace/workspace-session';
import { performanceDates } from './customer-performance-dates';
import {
  performanceDefaultDates,
  type CustomerPerformance,
  type CustomerPerformanceRow,
  type CustomerPaymentHistory,
} from './customer-performance-types';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  post: vi.fn(),
  download: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user', companyId: 'company', permissions: [...state.permissions] },
    loading: false,
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPost: state.post }));
vi.mock('@/lib/export-download', () => ({ downloadBinaryExport: state.download }));
vi.mock('@/hooks/use-workspace-choices', () => ({
  useWorkspaceChoices: (path: string) => ({
    rows: [
      {
        id: path === '/companies' ? 'company' : path === '/divisions' ? 'division' : 'branch',
        name: path.slice(1),
      },
    ],
    error: '',
    loading: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  useWorkspaceSearchParams: () => state.params,
  WorkspaceLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/workspace/linked-desk-changes', () => ({ useLinkedDeskChanges: vi.fn() }));
vi.mock('@/components/ui', async (original) => ({
  ...(await original<typeof import('@/components/ui')>()),
  FormDateField: ({ label, value, onChange, ...props }: any) => (
    <label>
      {label}
      <input
        {...props}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));

const row = (id = 'customer'): CustomerPerformanceRow => ({
  id,
  companyId: 'company',
  code: 'CUS-01',
  name: id === 'customer' ? 'Acacia Trading' : 'Other customer',
  category: 'best',
  reasons: ['Top sales contribution', 'No overdue invoices'],
  salesRank: 1,
  netSales: '450',
  previousNetSales: '300',
  salesCount: 6,
  collected: '400',
  receiptBasis: 'actual-receipts',
  lastPaymentDate: '2026-10-09',
  outstanding: '50',
  overdue: '0',
  customerCredit: '20',
  netDue: '30',
  oldestDaysOverdue: 0,
  onTimePercent: 100,
  eligibleInvoiceCount: 6,
  missingDueDateCount: 0,
  paymentLabel: 'reliable',
});
const fixture = (): CustomerPerformance => ({
  period: { ...performanceDates('month'), previousFrom: '2026-09-01', previousTo: '2026-09-13' },
  asOf: '2026-10-13',
  reliabilityAsOf: '2026-10-13',
  currency: 'TZS',
  receiptBasis: 'actual-receipts',
  access: { sales: true, balances: true, receipts: true },
  rules: {
    minimumDueInvoices: 5,
    bestOnTimePercent: 95,
    goodOnTimePercent: 90,
    topSalesPercent: 20,
    salesBasis: 'Document value after credit adjustments, including tax',
  },
  summary: {
    customers: 26,
    best: 1,
    good: 10,
    needsAttention: 4,
    insufficientHistory: 9,
    inactive: 2,
    netSales: '450',
    collected: '400',
    outstanding: '50',
    overdue: '0',
    customerCredit: '20',
    netDue: '30',
  },
  rows: [row()],
  total: 26,
  page: 1,
  limit: 25,
  warnings: ['Direct entries remain separate.'],
});
const historyFixture = (id = 'customer'): CustomerPaymentHistory => ({
  customer: { id, name: row(id).name, code: 'CUS-01', companyId: 'company' },
  performance: row(id),
  asOf: '2026-10-13',
  reliabilityAsOf: '2026-10-13',
  access: { sales: true, balances: true, receipts: true },
  currency: 'TZS',
  period: performanceDates('month'),
  rows: [
    {
      id: 'payment',
      date: '2026-10-09',
      reference: 'PAY-01',
      source: 'Customer payment',
      sourceUrl: '/finance/payments?paymentId=payment',
      method: 'BANK_TRANSFER',
      amount: '400',
      appliedAmount: '380',
      unappliedAmount: '20',
      status: 'COMPLETED',
      allocations: [
        { reference: 'REC-01', amount: '380', dueDate: '2026-10-10', receivableId: 'receivable' },
      ],
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
});
const statementFixture = (currency = 'TZS') => ({
  customerName: 'Acacia Trading',
  contentHash: 'hash-' + currency,
  currency,
  dateFrom: '2026-10-01',
  dateTo: '2026-10-13',
  openingBalance: '0',
  totalDebits: '450',
  totalCredits: '400',
  closingBalance: '50',
  openInvoiceBalance: '50',
  customerCredit: '20',
  netBalance: '30',
  generatedAt: '2026-10-13T10:00:00Z',
  lines: [
    {
      date: '2026-10-09',
      type: 'PAYMENT',
      reference: 'PAY-01',
      description: 'Bank transfer receipt',
      sourceId: 'payment',
      debit: '0',
      credit: '400',
      balance: '50',
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set([
    'sales.view',
    'customers.view',
    'receivables.view',
    'cash_desk.view',
    'customer-payments.view',
    'customer_statements.view',
    'customer_statements.generate',
    'customer_statements.list',
  ]);
  state.params = new URLSearchParams();
  state.download.mockResolvedValue(undefined);
  state.get.mockImplementation(async (path: string, options: any) =>
    path === '/customer-performance'
      ? fixture()
      : path.endsWith('/history')
        ? historyFixture()
        : path === '/customer-statements'
          ? { data: [] }
          : statementFixture(options?.query?.currency),
  );
  state.post.mockResolvedValue({
    id: 'saved-run',
    statementRunNumber: 'ST-001',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-13',
    currency: 'USD',
    status: 'GENERATED',
  });
});

describe('Customer Performance', () => {
  it('identifies scoped settlement amounts without labelling them all as new cash receipts', async () => {
    const scoped = fixture();
    scoped.receiptBasis = 'scoped-settlements';
    scoped.rows[0].receiptBasis = 'scoped-settlements';
    state.get.mockResolvedValue(scoped);
    const mounted = render(<CustomerPerformancePage />);
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Scoped collections' })).toBeVisible();
    expect(screen.getByText(/some allocations represent cash received elsewhere/)).toBeVisible();
    const focused = historyFixture();
    focused.performance.receiptBasis = 'scoped-settlements';
    focused.rows[0].allocations[0].date = '2026-10-09';
    state.get.mockImplementation(async (path: string) =>
      path.endsWith('/history')
        ? focused
        : path === '/customer-statements'
          ? { data: [] }
          : statementFixture(),
    );
    state.params = new URLSearchParams('customerId=customer');
    mounted.rerender(<CustomerPerformancePage />);
    const history = await screen.findByRole('region', { name: 'Customer payment history' });
    expect(
      within(history).getByText(
        'Receipts and scoped settlements or reversals in the selected period',
      ),
    ).toBeVisible();
    await userEvent.click(within(history).getByText('Payment allocations'));
    expect(within(history).getByText(/Settled 9 Oct/)).toBeVisible();
  });
  it('shows explainable rankings and preserves scope/date/currency when opening an account', async () => {
    render(<CustomerPerformancePage />);
    const table = await screen.findByRole('table', { name: 'Customer performance in TZS' });
    expect(within(table).getByText('Best')).toBeVisible();
    expect(within(table).getByText('Top sales contribution · No overdue invoices')).toBeVisible();
    expect(screen.getByText(/Account exposure is current as of/)).toBeVisible();
    expect(screen.getByText('Direct entries remain separate.')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Division'), 'division');
    await userEvent.selectOptions(screen.getByLabelText('Branch'), 'branch');
    const account = await screen.findByRole('link', {
      name: 'View performance for Acacia Trading',
    });
    const url = new URL(account.getAttribute('href')!, 'http://example');
    expect(url.pathname).toBe('/sales-desk/customer-performance');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      currency: 'TZS',
      customerId: 'customer',
      ...performanceDefaultDates(),
    });
    expect(state.post).not.toHaveBeenCalled();
  });
  it('keeps the directory page when returning from a customer with unchanged filters', async () => {
    const mounted = render(<CustomerPerformancePage />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/customer-performance',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    const account = screen.getByRole('link', { name: 'View performance for Acacia Trading' });
    state.params = new URL(
      new URL(account.getAttribute('href')!, 'https://example').href,
    ).searchParams;
    mounted.rerender(<CustomerPerformancePage />);
    await screen.findByRole('region', { name: 'Customer payment history' });
    const back = screen.getByRole('link', { name: /Back to customer performance/ });
    state.params = new URL(back.getAttribute('href')!, 'https://example').searchParams;
    mounted.rerender(<CustomerPerformancePage />);
    await screen.findByRole('table');
    expect(state.get).toHaveBeenLastCalledWith(
      '/customer-performance',
      expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
    );
  });
  it('uses server search/category/sort/page and hides stale amounts on new reads', async () => {
    render(<CustomerPerformancePage />);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/customer-performance',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 25 }) }),
      ),
    );
    await userEvent.type(screen.getByPlaceholderText('Name or customer code'), 'Acacia');
    await userEvent.selectOptions(screen.getByLabelText('Performance group'), 'needs-attention');
    await userEvent.selectOptions(screen.getByLabelText('Sort customers'), 'overdue');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/customer-performance',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            search: 'Acacia',
            category: 'needs-attention',
            sort: 'overdue',
          }),
        }),
      ),
    );
    state.get.mockImplementation(() => new Promise(() => {}));
    await userEvent.selectOptions(screen.getByLabelText('Currency'), 'USD');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading customer performance');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('keeps each desktop window’s search and pages separate across remounts', async () => {
    const windows = (first: boolean) => (
      <WorkspaceSessionProvider>
        {first && (
          <section key="first" aria-label="First">
            <WorkspaceInstanceProvider id="first" appId="sales-desk">
              <CustomerPerformancePage />
            </WorkspaceInstanceProvider>
          </section>
        )}
        <section key="second" aria-label="Second">
          <WorkspaceInstanceProvider id="second" appId="sales-desk">
            <CustomerPerformancePage />
          </WorkspaceInstanceProvider>
        </section>
      </WorkspaceSessionProvider>
    );
    const mounted = render(windows(true));
    const first = within(screen.getByRole('region', { name: 'First' }));
    const second = within(screen.getByRole('region', { name: 'Second' }));
    await first.findByRole('table');
    await second.findByRole('table');
    await userEvent.type(first.getByPlaceholderText('Name or customer code'), 'Acacia');
    expect(second.getByPlaceholderText('Name or customer code')).toHaveValue('');
    mounted.rerender(windows(false));
    mounted.rerender(windows(true));
    expect(
      within(screen.getByRole('region', { name: 'First' })).getByPlaceholderText(
        'Name or customer code',
      ),
    ).toHaveValue('Acacia');
  });
  it('does not query without customer and sales access, and masks restricted payment metrics', async () => {
    state.permissions = new Set(['customers.view']);
    const mounted = render(<CustomerPerformancePage />);
    expect(screen.getByText(/Customer and sales viewing access/)).toBeVisible();
    expect(state.get).not.toHaveBeenCalled();
    state.permissions.add('sales.view');
    const restricted = fixture();
    restricted.access = { sales: true, balances: false, receipts: false };
    restricted.rows = [
      {
        ...row(),
        collected: null,
        outstanding: null,
        overdue: null,
        onTimePercent: null,
        lastPaymentDate: null,
        paymentLabel: 'restricted',
      },
    ];
    restricted.summary = {
      ...restricted.summary,
      collected: null,
      outstanding: null,
      overdue: null,
    };
    state.get.mockResolvedValue(restricted);
    mounted.rerender(<CustomerPerformancePage />);
    await screen.findByRole('table');
    expect(screen.getByText(/Restricted figures are unavailable/)).toBeVisible();
    expect(screen.getByText('Payment access required')).toBeVisible();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });
  it('opens scoped payment history with allocations and clears the prior customer before a pending read', async () => {
    state.params = new URLSearchParams(
      'customerId=customer&currency=USD&divisionId=division&branchId=branch',
    );
    const mounted = render(<CustomerPerformancePage />);
    const history = await screen.findByRole('region', { name: 'Customer payment history' });
    expect(within(history).getByRole('link', { name: 'PAY-01' })).toHaveAttribute(
      'href',
      '/finance/payments?paymentId=payment',
    );
    await userEvent.click(within(history).getByText('Payment allocations'));
    expect(within(history).getByRole('link', { name: 'REC-01' })).toBeVisible();
    expect(state.get).toHaveBeenCalledWith(
      '/customer-performance/customer/history',
      expect.objectContaining({
        query: expect.objectContaining({
          currency: 'USD',
          divisionId: 'division',
          branchId: 'branch',
        }),
      }),
    );
    state.get.mockImplementation(() => new Promise(() => {}));
    state.params = new URLSearchParams('customerId=other&currency=USD');
    mounted.rerender(<CustomerPerformancePage />);
    expect(screen.queryByText('Acacia Trading')).not.toBeInTheDocument();
    expect(await screen.findByText('Loading customer account…')).toBeVisible();
    expect(state.post).not.toHaveBeenCalled();
  });
  it('reports read failures with retry instead of showing empty rankings', async () => {
    state.get.mockRejectedValueOnce(new Error('Scope could not be loaded'));
    render(<CustomerPerformancePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Scope could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Retry performance' }));
    expect(await screen.findByRole('table')).toBeVisible();
  });
});

describe('Customer statement workspace', () => {
  const customer = { id: 'customer', companyId: 'company', name: 'Acacia Trading' };
  const selection = {
    companyId: 'company',
    customerId: 'customer',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-13',
    currency: 'TZS',
    divisionId: 'division',
    branchId: 'branch',
  };
  it('keeps settlement evidence warnings visible in the preview and saved run history', async () => {
    const settlementHistory = {
      status: 'INCOMPLETE' as const,
      recoveredLegacySettlements: 0,
      unresolvedAmount: '10.00',
      gaps: [],
    };
    state.get.mockImplementation(async (path: string) =>
      path === '/customer-statements'
        ? { data: [] }
        : { ...statementFixture(), settlementHistory, warnings: ['Invoice needs reconciliation.'] },
    );
    render(
      <CustomerStatementWorkspace
        customer={customer}
        initialSelection={selection}
        savedRuns={[
          {
            id: 'legacy-run',
            statementRunNumber: 'ST-LEGACY',
            periodStart: '2026-09-01',
            periodEnd: '2026-09-30',
            status: 'GENERATED',
            currency: 'USD',
            settlementHistory,
          },
        ]}
      />,
    );
    await screen.findByRole('table');
    expect(screen.getByText('Invoice needs reconciliation.')).toBeVisible();
    expect(screen.getAllByText(/Provisional balance/)).toHaveLength(2);
    expect(screen.getByText(/Unresolved evidence: USD 10.00/)).toBeVisible();
  });
  it('exports the displayed selection despite unapplied draft changes, then saves and reopens a frozen snapshot', async () => {
    render(
      <CustomerStatementWorkspace
        customer={customer}
        initialSelection={selection}
        savedRuns={[
          {
            id: 'old-run',
            statementRunNumber: 'ST-000',
            periodStart: '2026-09-01',
            periodEnd: '2026-09-30',
            status: 'GENERATED',
            currency: 'TZS',
          },
        ]}
      />,
    );
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Statement currency'), 'USD');
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(state.download).toHaveBeenLastCalledWith(
      '/customer-statements/export/pdf',
      { ...selection, expectedHash: 'hash-TZS' },
      'customer-statement.pdf',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview statement' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/customer-statements/detail',
        expect.objectContaining({ query: { ...selection, currency: 'USD' } }),
      ),
    );
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Save statement' }));
    expect(state.post).toHaveBeenCalledWith('/customer-statements/generate', {
      companyId: 'company',
      customerId: 'customer',
      currency: 'USD',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-13',
      divisionId: 'division',
      branchId: 'branch',
      expectedHash: 'hash-USD',
    });
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/customer-statements/saved-run/detail',
        expect.anything(),
      ),
    );
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(state.download).toHaveBeenLastCalledWith(
      '/customer-statements/export/excel',
      { runId: 'saved-run' },
      'customer-statement.xlsx',
    );
    await userEvent.click(screen.getByRole('button', { name: /ST-000/ }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/customer-statements/old-run/detail',
        expect.anything(),
      ),
    );
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(state.download).toHaveBeenLastCalledWith(
      '/customer-statements/export/pdf',
      { runId: 'old-run' },
      'customer-statement.pdf',
    );
  });
  it('separates viewing/export from generation permission and reports export errors', async () => {
    state.permissions = new Set(['customer_statements.view']);
    state.download.mockRejectedValueOnce(
      new Error('Historical correction requires reconciliation'),
    );
    render(<CustomerStatementWorkspace customer={customer} initialSelection={selection} />);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Save statement' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Historical correction requires reconciliation',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
});
