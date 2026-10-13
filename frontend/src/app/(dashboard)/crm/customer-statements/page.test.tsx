import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import CustomerStatementsPage from './page';

const state = vi.hoisted(() => ({
  page: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ loading: false, hasPermission: () => true }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendList: state.list,
  backendGet: state.get,
  backendPost: state.post,
}));
vi.mock('@/lib/export-download', () => ({ downloadBinaryExport: state.download }));
vi.mock('@/components/aurora/data-display/ResponsiveDataTable', () => ({
  ResponsiveDataTable: ({ columns, data }: any) => (
    <table>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.id}>
            {columns.map((column: any) => (
              <td key={column.key}>{column.accessor(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock('@/components/aurora/overlays', () => ({
  Drawer: ({ open, children }: any) =>
    open ? <section aria-label="Statement preview">{children}</section> : null,
  Modal: ({ open, children }: any) => (open ? <section>{children}</section> : null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.list.mockImplementation(async (path: string) =>
    path === '/companies'
      ? [{ id: 'company', name: 'Example Company' }]
      : [{ id: 'customer', name: 'Acacia Trading' }],
  );
  state.page.mockResolvedValue({
    data: [
      {
        id: 'saved-run',
        companyId: 'company',
        customerId: 'customer',
        statementRunNumber: 'ST-001',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        currency: 'USD',
        status: 'GENERATED',
        closingBalance: '50',
      },
    ],
    total: 1,
    page: 1,
    totalPages: 1,
  });
  state.get.mockResolvedValue({
    companyId: 'company',
    customerId: 'customer',
    customerName: 'Acacia Trading',
    customerEmail: 'customer@example.test',
    currency: 'USD',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    openingBalance: '0',
    totalDebits: '50',
    totalCredits: '0',
    closingBalance: '50',
    generatedAt: '2026-10-13T10:00:00Z',
    lines: [],
    aging: {
      current: 50,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      over90: 0,
      total: 50,
      oldestDaysOverdue: 0,
    },
  });
  state.download.mockResolvedValue(undefined);
});

it('reopens and exports the saved statement snapshot and preserves its currency', async () => {
  render(<CustomerStatementsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'View statement' }));
  await waitFor(() =>
    expect(state.get).toHaveBeenCalledWith(
      '/customer-statements/saved-run/detail',
      expect.objectContaining({ query: {} }),
    ),
  );
  expect(state.get.mock.calls.some(([path]) => path === '/customer-statements/detail')).toBe(false);
  await userEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
  expect(state.download).toHaveBeenCalledWith(
    '/customer-statements/export/pdf',
    { runId: 'saved-run' },
    'statement.pdf',
  );
  expect(screen.getAllByText('USD 50.00').length).toBeGreaterThan(0);
  expect(state.post).not.toHaveBeenCalled();
});

it('emails the selected saved statement identity instead of recomputing its live account', async () => {
  state.post.mockResolvedValue({ emailed: true });
  render(<CustomerStatementsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'View statement' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Email to customer' }));
  expect(state.post).toHaveBeenCalledWith('/customer-statements/email', { runId: 'saved-run' });
});
