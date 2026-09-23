import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Receivables from '@/app/(dashboard)/finance/receivables/page';
import Payables from '@/app/(dashboard)/finance/payables/page';
import Expenses from '@/app/(dashboard)/finance/expenses/page';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => auth.permissions.has(p) }),
}));
const cases = [
  {
    route: 'receivables',
    Page: Receivables,
    record: {
      id: 'record-1',
      receivableNumber: 'REC-001',
      customerName: 'Example customer',
      amount: 900,
      outstandingAmount: 400,
      currency: 'USD',
      issueDate: '2026-01-01',
      dueDate: '2026-02-01',
      status: 'OPEN',
      companyId: 'co-1',
    },
    name: 'REC-001',
  },
  {
    route: 'payables',
    Page: Payables,
    record: {
      id: 'record-1',
      payableNumber: 'PAY-001',
      supplierName: 'Example supplier',
      amount: 900,
      outstandingAmount: 400,
      currency: 'USD',
      issueDate: '2026-01-01',
      dueDate: '2026-02-01',
      status: 'OPEN',
      companyId: 'co-1',
    },
    name: 'PAY-001',
  },
  {
    route: 'expenses',
    Page: Expenses,
    record: {
      id: 'record-1',
      expenseNumber: 'EXP-001',
      vendorName: 'Example vendor',
      amount: 90,
      currency: 'USD',
      expenseDate: '2026-01-01',
      status: 'DRAFT',
      companyId: 'co-1',
    },
    name: 'EXP-001',
  },
];
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe.each(cases)('$route focus workspace', ({ route, Page, record, name }) => {
  it('preserves URL scope, searches on the server, and exposes only read actions to a viewer', async () => {
    auth.permissions = new Set([`${route}.view`]);
    window.history.replaceState({}, '', `/finance/${route}?companyId=co-1&status=${record.status}`);
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: url.includes(`/api/backend/${route}?`)
          ? { data: [record], total: 31, page: 1, totalPages: 2, limit: 20 }
          : [],
      }),
    }));
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole('button', { name: `Inspect ${name}` }));
    const inspector = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(inspector).getByRole('button', { name: 'View', exact: true })).toBeVisible();
    expect(
      within(inspector).queryByRole('button', { name: 'Pay', exact: true }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByRole('button', { name: 'Delete', exact: true }),
    ).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(
        ([url]) => url.includes(`companyId=co-1`) && url.includes(`status=${record.status}`),
      ),
    ).toBe(true);
    await user.type(screen.getByRole('searchbox'), 'Example');
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([url]) => url.includes('search=Example'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) => url.includes('page=2') && url.includes('search=Example'),
        ),
      ).toBe(true),
    );
  });
  it('shows a request failure with retry instead of an empty ledger', async () => {
    auth.permissions = new Set([`${route}.view`]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: !url.includes(`/api/backend/${route}?`),
        json: async () =>
          url.includes(`/api/backend/${route}?`)
            ? { message: 'Service unavailable' }
            : { data: [] },
      })),
    );
    render(<Page />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  });
});
