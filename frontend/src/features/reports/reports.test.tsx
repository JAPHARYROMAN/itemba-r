import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsApp } from './reports-app';
import { AnalysisGrid, analysisCsv } from './analysis-table';
import { branchPerformance } from './branch-performance';
import type { Analysis } from './analysis-types';
import { allReportRows } from './report-data';
import { REPORTS } from './report-definitions';
import { WorkspaceNavigationProvider } from '@/components/workspace/workspace-navigation';
const state = vi.hoisted(() => ({
  params: '',
  permissions: new Set<string>(),
  get: vi.fn(),
  push: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => state.permissions.has(p),
    user: { id: 'reports-reader' },
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams(state.params),
  useRouter: () => ({ push: state.push }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get }));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
const analysis: Analysis = {
  source: 'Sales Desk',
  period: {
    from: '2026-09-01',
    to: '2026-09-30',
    previousFrom: '2026-08-02',
    previousTo: '2026-08-31',
  },
  generatedAt: '2026-09-30T12:00:00Z',
  basis: 'Current valid records.',
  currencies: [
    {
      currency: 'TZS',
      opening: '80.00',
      issued: '50.00',
      paid: '40.00',
      closing: '90.00',
      overdue: '50.00',
      previous: '100.00',
      change: '-50.0',
      count: 1,
    },
  ],
  tables: [
    {
      id: 'parties',
      title: 'Customers',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'closing', label: 'Closing', money: true },
      ],
      rows: [{ id: 'customer', name: 'Customer One', currency: 'TZS', closing: '90.00' }],
    },
    {
      id: 'documents',
      title: 'Invoices in period',
      columns: [
        { key: 'reference', label: 'Invoice' },
        { key: 'amount', label: 'Amount', money: true },
      ],
      rows: [{ id: 'invoice', reference: 'INV-01', currency: 'TZS', amount: '50.00' }],
    },
    {
      id: 'statement',
      title: 'Account statement',
      columns: [
        { key: 'reference', label: 'Reference' },
        { key: 'balance', label: 'Running balance', money: true },
      ],
      rows: [
        {
          id: 'pay',
          documentId: 'invoice',
          reference: 'PAY-01',
          currency: 'TZS',
          balance: '90.00',
        },
      ],
    },
    {
      id: 'branches',
      title: 'Branch breakdown',
      columns: [
        { key: 'branch', label: 'Branch' },
        { key: 'issued', label: 'Sales', money: true },
      ],
      rows: [
        {
          id: 'br',
          companyId: 'a',
          divisionId: 'd',
          branchId: 'br',
          company: 'Company A',
          division: 'Division A',
          branch: 'Branch A',
          currency: 'TZS',
          issued: '50.00',
          closing: '90.00',
        },
      ],
    },
    {
      id: 'monthly',
      title: 'Monthly trend',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'issued', label: 'Sales', money: true },
      ],
      rows: [{ month: '2026-09', currency: 'TZS', issued: '50.00', paid: '40.00' }],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  state.params = 'from=2026-09-01&to=2026-09-30';
  state.permissions = new Set(['sales_desk.view', 'cash_desk.view', 'invoice_desk.view']);
  state.get.mockImplementation(async (path: string) =>
    path.endsWith('/directory')
      ? {
          companies: [
            { id: 'a', name: 'Company A' },
            { id: 'b', name: 'Company B' },
          ],
          divisions: [{ id: 'd', companyId: 'a', name: 'Division A' }],
          branches: [{ id: 'br', companyId: 'a', divisionId: 'd', name: 'Branch A' }],
        }
      : path === '/sales-desk/customers' || path === '/invoice-desk/suppliers'
        ? [{ id: 'customer', name: 'Customer One' }]
        : path.startsWith('/desk-reports/')
          ? {
              ...analysis,
              source: path.endsWith('cash')
                ? 'Cash Desk'
                : path.endsWith('purchases')
                  ? 'Invoice Desk'
                  : 'Sales Desk',
            }
          : path === '/sales-desk/sales/invoice'
            ? {
                id: 'invoice',
                saleNumber: 'INV-01',
                customer: { name: 'Customer One' },
                company: { name: 'Company A' },
                division: { name: 'Division A' },
                branch: { name: 'Branch A' },
                currency: 'TZS',
                totalAmount: '50',
                paidAmount: '10',
                outstanding: '40',
                status: 'PARTIAL',
                payments: [],
                lines: [],
              }
            : {},
  );
});
describe('Expanded reports', () => {
  it('uses a companion report’s own hierarchy and drills without changing the main route', async () => {
    state.params = 'view=expenses&companyId=unrelated-main-company';
    render(
      <WorkspaceNavigationProvider
        appId="reports"
        initialHref="/reports?view=customers&companyId=a&from=2026-09-01&to=2026-09-30"
        ownsPath={(path) => path === '/reports'}
      >
        <ReportsApp />
      </WorkspaceNavigationProvider>,
    );
    await screen.findByRole('cell', { name: 'Customer One' });
    expect(
      state.get.mock.calls.find(([path]) => path === '/desk-reports/sales')?.[1].query,
    ).toMatchObject({ companyId: 'a', from: '2026-09-01' });
    expect(
      state.get.mock.calls.some(
        ([, options]) => options?.query?.companyId === 'unrelated-main-company',
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'View statement' }));
    await waitFor(() =>
      expect(
        state.get.mock.calls.some(
          ([path, options]) =>
            path === '/desk-reports/sales' && options.query.partyId === 'customer',
        ),
      ).toBe(true),
    );
    expect(state.push).not.toHaveBeenCalled();
  });
  it('loads the business overview only from authorised sources', async () => {
    state.permissions = new Set(['cash_desk.view']);
    render(<ReportsApp />);
    await screen.findByRole('heading', { name: 'Business overview' });
    expect(
      state.get.mock.calls.every(
        ([path]) => path.startsWith('/cash-desk/') || path === '/desk-reports/cash',
      ),
    ).toBe(true);
    expect(screen.queryByText('Customers owe')).not.toBeInTheDocument();
  });
  it('blocks direct links without the source permission', () => {
    state.permissions = new Set(['cash_desk.view']);
    state.params += '&view=customers';
    render(<ReportsApp />);
    expect(screen.getByRole('heading', { name: 'Report unavailable' })).toBeVisible();
    expect(state.get).not.toHaveBeenCalled();
  });
  it('shows partial coverage and does not fetch loans without both source permissions', async () => {
    state.params = 'view=health&from=2025-09-01&to=2025-09-30';
    state.permissions = new Set(['cash_desk.view']);
    render(<ReportsApp />);
    await screen.findByText('Management view · partial coverage');
    expect(screen.getByRole('heading', { name: 'Known payments due' })).toBeInTheDocument();
    expect(state.get.mock.calls.map(([p]) => p)).not.toContain(
      '/desk-reports/financing/borrowings',
    );
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  });
  it('rejects a future health date without loading actual balance reports', () => {
    state.params = 'view=health&from=2099-01-01&to=2099-01-31';
    render(<ReportsApp />);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose today or an earlier balance date');
    expect(state.get.mock.calls.some(([p]) => p.startsWith('/desk-reports/'))).toBe(false);
  });
  it('does not apply a customer identifier to the whole-business overview', async () => {
    state.params += '&partyId=customer';
    render(<ReportsApp />);
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith('/desk-reports/sales', expect.anything()),
    );
    const request = state.get.mock.calls.find(([path]) => path === '/desk-reports/sales')!;
    expect(request[1].query).not.toHaveProperty('partyId');
  });
  it('drills from a customer into a filtered statement', async () => {
    state.params += '&view=customers';
    render(<ReportsApp />);
    await screen.findByRole('cell', { name: 'Customer One' });
    fireEvent.click(screen.getByRole('button', { name: 'View statement' }));
    expect(state.push.mock.calls[0][0]).toContain('partyId=customer');
    expect(state.push.mock.calls[0][0]).toContain('tab=statement');
    expect(state.push.mock.calls[0][0]).toContain('from=2026-09-01');
  });
  it('applies explicit date and hierarchy filters; rejects invalid calendar dates', async () => {
    state.params += '&view=sales';
    render(<ReportsApp />);
    await screen.findByRole('option', { name: 'Company A' });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'd' } });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'br' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'b' } });
    expect(screen.getByLabelText('Division')).toHaveValue('');
    expect(screen.getByLabelText('Branch')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid dates');
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(state.push.mock.calls[0][0]).toContain('companyId=b');
  });
  it('opens the real source invoice without posting a payment', async () => {
    state.params += '&view=sales&tab=documents';
    render(<ReportsApp />);
    await screen.findByRole('button', { name: 'Open invoice' });
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('INV-01');
    expect(state.get).toHaveBeenCalledWith('/sales-desk/sales/invoice', expect.anything());
    expect(within(dialog).queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
  });
  it('shows report failures rather than fabricated zero balances', async () => {
    state.params += '&view=sales';
    state.get.mockRejectedValue(new Error('Report unavailable from API'));
    render(<ReportsApp />);
    await screen.findByText('Report unavailable from API');
    expect(screen.queryByText('Opening balance')).not.toBeInTheDocument();
  });
  it('saves report filters per account and opens the same view', async () => {
    state.params += '&view=customers&partyId=customer&tab=statement';
    render(<ReportsApp />);
    fireEvent.click(screen.getByText('Saved reports'));
    fireEvent.change(screen.getByLabelText('Saved report name'), {
      target: { value: 'September statement' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save this view' }));
    expect(
      JSON.parse(localStorage.getItem('itemba-reports-views-v1:reports-reader')!)[0].href,
    ).toContain('partyId=customer');
    fireEvent.click(screen.getByRole('button', { name: 'September statement' }));
    expect(state.push.mock.calls[0][0]).toContain('tab=statement');
  });
  it('exports every displayed result beyond page one and preserves exact decimals', async () => {
    const table = {
      id: 'test',
      title: 'Large statement',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'amount', label: 'Amount', money: true },
      ],
      rows: Array.from({ length: 30 }, (_, i) => ({
        id: String(i),
        name: `Row ${i}`,
        amount: i === 29 ? '9007199254740993.11' : '0.10',
      })),
    };
    render(
      <AnalysisGrid
        table={table}
        caption="TZS · September"
        metadata={{ 'Opening balance': '10.00', 'Closing balance': '20.00' }}
      />,
    );
    expect(screen.queryByRole('cell', { name: 'Row 29' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(state.download.mock.calls[0][2]).toContain('9007199254740993.11');
    expect(state.download.mock.calls[0][2]).toContain('Opening balance,10.00');
    expect(state.download.mock.calls[0][2]).toContain('Closing balance,20.00');
    expect(state.download.mock.calls[0][2]).toContain('TZS · September');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('cell', { name: '9,007,199,254,740,993.11' })).toBeVisible();
  });
  it('neutralises spreadsheet formulas and keeps missing-source branch columns out', () => {
    expect(
      analysisCsv({
        id: 't',
        title: 'T',
        columns: [{ key: 'name', label: 'Name' }],
        rows: [{ name: '=DANGEROUS()' }],
      }),
    ).toContain("'=DANGEROUS()");
    const branches = branchPerformance(analysis, null, null, 'TZS');
    expect(branches.columns.map((c) => c.key)).not.toContain('expenses');
    expect(branches.rows[0].sales).toBe('50.00');
  });
  it('keeps the legacy loan export complete across pages', async () => {
    state.get
      .mockResolvedValueOnce({ rows: [{ id: '1' }], total: 2, pageSize: 1 })
      .mockResolvedValueOnce({ rows: [{ id: '2' }], total: 2, pageSize: 1 });
    expect(
      await allReportRows(REPORTS.find((r) => r.id === 'loans')!, {}, new AbortController().signal),
    ).toHaveLength(2);
  });
});
