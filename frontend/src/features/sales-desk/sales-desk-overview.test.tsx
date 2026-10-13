import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesDeskOverview } from './sales-desk-overview';
import { overviewDates, type SalesOverview } from './sales-overview-types';

const state = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get }));
vi.mock('@/hooks/use-workspace-choices', () => ({
  useWorkspaceChoices: (path: string) => ({
    rows: [
      {
        id: path === '/companies' ? 'company' : path === '/divisions' ? 'division' : 'branch',
        name: path.slice(1),
        code: '',
      },
    ],
    loading: false,
    error: '',
    retry: vi.fn(),
  }),
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  WorkspaceLink: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/workspace/linked-desk-changes', () => ({
  useLinkedDeskChanges: vi.fn(),
  notifyDeskSaved: vi.fn(),
}));
vi.mock('./business-sales', () => ({
  SalesOrderModal: () => (
    <div role="dialog" aria-label="New sale">
      Sale editor
    </div>
  ),
}));
vi.mock('@/components/workspace/trading-partner-editor', () => ({
  TradingPartnerEditor: () => (
    <div role="dialog" aria-label="Add customer">
      Customer editor
    </div>
  ),
}));

const fixture = (): SalesOverview => ({
  currency: 'TZS',
  period: { ...overviewDates('month'), previousFrom: '2026-09-01', previousTo: '2026-09-09' },
  asOf: '2026-10-09',
  access: { balances: true, receipts: true, customers: true },
  metrics: {
    salesValue: '400',
    salesCount: 2,
    averageSale: '200',
    collected: '130',
    outstanding: '430',
    overdue: '300',
    previousSalesValue: '200',
    previousSalesCount: 1,
    previousAverageSale: '200',
    previousCollected: '100',
    purchasingCustomers: 1,
    newCustomers: 1,
  },
  trend: [{ date: '2026-10-07', dateTo: '2026-10-07', sales: '400', collected: '130' }],
  aging: [{ label: '1–30 days', amount: '300' }],
  salesMix: [{ label: 'Credit sales', amount: '300', count: 1 }],
  paymentMethods: [{ label: 'CASH', amount: '130' }],
  topCustomers: [{ id: 'customer', name: 'Acacia', amount: '300', count: 1 }],
  branches: [{ id: 'branch', name: 'Main', amount: '400', count: 2 }],
  salespeople: [],
  topProducts: [{ id: 'p:kg', name: 'Rice', unit: 'kg', quantity: '1.5', amount: '400' }],
  attention: {
    drafts: 1,
    overdue: 1,
    dueSoon: 0,
    unappliedPayments: 0,
    draftSales: [],
    overdueSales: [],
    dueSoonSales: [],
  },
  recentSales: [],
  recentReceipts: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set([
    'sales.view',
    'customers.view',
    'receivables.view',
    'cash_desk.view',
    'customer-payments.view',
    'companies.read',
    'divisions.read',
    'branches.read',
    'sales.create',
    'customers.create',
  ]);
  state.get.mockImplementation(async (path: string) =>
    path === '/customers/workbench-summary' ? { total: 91, active: 91, blocked: 0 } : fixture(),
  );
});
describe('Sales Overview', () => {
  it('explains scoped collections and exposes reconciliation warnings', async () => {
    const data = fixture();
    data.receiptBasis = 'scoped-settlements';
    data.warnings = ['Refresh a source receipt that needs reconciliation.'];
    state.get.mockResolvedValue(data);
    render(<SalesDeskOverview />);
    expect(
      await screen.findByRole('link', { name: /Scoped collections TZS 130/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Scoped collections show settlements allocated/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(data.warnings[0]);
  });
  it('renders the dashboard and preserves organization, currency and confirmed-only filters in drill-through links', async () => {
    render(<SalesDeskOverview />);
    expect(await screen.findByRole('region', { name: 'Sales performance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sales Overview' })).toBeInTheDocument();
    for (const heading of [
      'Needs attention',
      'Receivables aging',
      'Customer activity',
      'Best-selling products',
      'Branch performance',
      'Recent sales',
    ])
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    const valueLink = screen.getByRole('link', { name: /Sales value TZS 400/ });
    const url = new URL(valueLink.getAttribute('href')!, 'http://local');
    expect(url.searchParams.get('companyId')).toBe('company');
    expect(url.searchParams.get('currency')).toBe('TZS');
    expect(url.searchParams.get('confirmedOnly')).toBe('true');
    const drafts = new URL(
      screen.getByRole('link', { name: /Draft sales/ }).getAttribute('href')!,
      'http://local',
    );
    expect(drafts.searchParams.get('status')).toBe('DRAFT');
    expect(drafts.searchParams.get('dateFrom')).toBe('');
    expect(drafts.searchParams.get('confirmedOnly')).toBe('');
    expect(screen.getByRole('link', { name: /Money collected TZS 130/ })).toHaveAttribute(
      'href',
      '#sales-overview-receipts',
    );
    expect(screen.getByRole('link', { name: /Due in the next 7 days/ })).toHaveAttribute(
      'href',
      '#sales-overview-upcoming',
    );
    await userEvent.click(screen.getByText('View daily figures'));
    expect(screen.getByRole('table', { name: 'Sales performance in TZS' })).toBeVisible();
  });
  it('refetches on period, currency and branch changes and hides stale values while loading', async () => {
    render(<SalesDeskOverview />);
    await screen.findByRole('region', { name: 'Sales performance' });
    await userEvent.click(screen.getByRole('button', { name: 'Today', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/sales-orders/overview',
        expect.objectContaining({ query: expect.objectContaining(overviewDates('today')) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/sales-orders/overview',
        expect.objectContaining({ query: expect.objectContaining({ currency: 'USD' }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Division'), 'division');
    await userEvent.selectOptions(screen.getByLabelText('Branch'), 'branch');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/sales-orders/overview',
        expect.objectContaining({
          query: expect.objectContaining({ divisionId: 'division', branchId: 'branch' }),
        }),
      ),
    );
    state.get.mockImplementation(() => new Promise(() => {}));
    await userEvent.selectOptions(screen.getByLabelText('Currency'), 'EUR');
    expect(await screen.findByRole('status')).toHaveTextContent('Loading your sales overview');
    expect(screen.queryByRole('region', { name: 'Sales performance' })).not.toBeInTheDocument();
  });
  it('opens the existing sale and customer editors', async () => {
    render(<SalesDeskOverview />);
    await screen.findByRole('region', { name: 'Sales performance' });
    await userEvent.click(screen.getByRole('button', { name: 'New sale' }));
    expect(await screen.findByRole('dialog', { name: 'New sale' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByRole('dialog', { name: 'Add customer' })).toBeInTheDocument();
  });
  it('keeps a customer-only overview without querying sales', async () => {
    state.permissions = new Set(['customers.view']);
    render(<SalesDeskOverview />);
    expect(await screen.findByText(/91 customers/)).toBeInTheDocument();
    expect(state.get.mock.calls.every(([path]) => path === '/customers/workbench-summary')).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
  });
  it('offers retry after read failure and renders a useful empty state', async () => {
    state.get.mockRejectedValueOnce(new Error('Connection unavailable'));
    render(<SalesDeskOverview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
    const empty = fixture();
    empty.metrics.salesCount = 0;
    empty.metrics.salesValue = '0';
    empty.trend = [];
    empty.topProducts = [];
    state.get.mockResolvedValue(empty);
    await userEvent.click(screen.getByRole('button', { name: 'Retry overview' }));
    expect(await screen.findByText('No sales or collections in this period.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Recent sales' })).getByText(
        /No sales in this period/,
      ),
    ).toBeInTheDocument();
  });
});
