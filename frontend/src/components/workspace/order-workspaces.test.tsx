import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessSales as Sales } from '@/features/sales-desk/business-sales';
import Purchases from '@/app/(dashboard)/operations/purchase-orders/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  push: vi.fn(),
  query: new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => '/operations/purchase-orders',
  useSearchParams: () => state.query,
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendGet: state.get,
  backendList: vi.fn().mockResolvedValue([]),
  backendPost: vi.fn(),
  backendPatch: state.patch,
  backendDelete: vi.fn(),
}));
const record = {
  id: 'order-1',
  salesOrderNumber: 'SO-001',
  purchaseOrderNumber: 'PO-001',
  companyId: 'co-1',
  orderDate: '2026-09-17',
  status: 'DRAFT',
  salesType: 'CASH_SALE',
  purchaseType: 'CASH_PURCHASE',
  paymentStatus: 'UNPAID',
  totalAmount: 120,
  outstandingAmount: 120,
  currency: 'USD',
  lines: [],
  supplierName: 'Creditor A',
  customerName: 'Customer A',
};
beforeEach(() => {
  state.query = new URLSearchParams();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.page
    .mockReset()
    .mockImplementation(async (path: string, { query }: { query?: { view?: string } } = {}) => ({
      data:
        query?.view === 'accounts'
          ? [
              {
                accountKey: 'account-a',
                partyName: path === '/sales-orders' ? 'Customer A' : 'Creditor A',
                companyId: record.companyId,
                currency: 'USD',
                documentCount: 1,
                openDocumentCount: 1,
                amount: 120,
                paidAmount: 0,
                outstandingAmount: 120,
                overdueAmount: 0,
                status: 'OPEN',
                documents: [record],
              },
            ]
          : [record],
      total: 1,
      totalPages: 1,
      page: 1,
      limit: 20,
    }));
  state.get.mockReset().mockResolvedValue({
    totalOrders: 1,
    confirmed: 0,
    unpaidCount: 1,
    revenue: 0,
    invoices: { missingInvoiceCount: 0 },
  });
  state.patch.mockReset();
});
it('keeps overview drill-through scope in sales reads and allows clearing additional filters', async () => {
  state.permissions = new Set(['sales.view']);
  state.query = new URLSearchParams({
    overview: 'true',
    companyId: 'co-1',
    divisionId: 'division',
    branchId: 'branch',
    currency: 'USD',
    salespersonId: 'employee',
    confirmedOnly: 'true',
    dateFrom: '2026-10-01',
    dateTo: '2026-10-13',
  });
  render(<Sales />);
  await waitFor(() =>
    expect(state.page).toHaveBeenCalledWith(
      '/sales-orders',
      expect.objectContaining({
        query: expect.objectContaining({
          companyId: 'co-1',
          divisionId: 'division',
          branchId: 'branch',
          currency: 'USD',
          salespersonId: 'employee',
          confirmedOnly: 'true',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-13',
        }),
      }),
    ),
  );
  expect(screen.getByText(/Overview scope:/)).toHaveTextContent('Confirmed sales');
  await userEvent.click(screen.getByRole('button', { name: 'Clear additional filters' }));
  await waitFor(() => {
    const query = state.page.mock.calls.at(-1)?.[1]?.query;
    expect(query).toMatchObject({ companyId: 'co-1', dateFrom: '2026-10-01' });
    expect(query).not.toHaveProperty('branchId');
    expect(query).not.toHaveProperty('currency');
    expect(query).not.toHaveProperty('confirmedOnly');
  });
});
it('shows partial uncovered received order value alongside an existing posted payable', async () => {
  state.permissions = new Set(['purchases.view']);
  const partial = {
    ...record,
    status: 'RECEIVED',
    accountingCoverage: 'POSTED',
    paidAmount: 20,
    outstandingAmount: 100,
    unbilledAmount: '20.00',
  };
  state.page.mockResolvedValue({
    data: [
      {
        accountKey: 'account-a',
        partyName: 'Creditor A',
        companyId: record.companyId,
        currency: 'USD',
        documentCount: 1,
        openDocumentCount: 1,
        amount: 120,
        paidAmount: 20,
        outstandingAmount: 100,
        overdueAmount: 0,
        status: 'OPEN',
        documents: [partial],
      },
    ],
    total: 1,
    totalPages: 1,
    page: 1,
  });
  state.get.mockResolvedValue({
    totalOrders: 1,
    received: 1,
    perCurrency: [
      {
        currency: 'USD',
        totalAmount: 120,
        paidAmount: 20,
        outstandingAmount: 100,
        unbilledAmount: '20.00',
      },
    ],
    invoices: { missingInvoiceCount: 0 },
  });
  render(<Purchases />);
  expect(
    await screen.findByText('Received value awaiting posted payable · USD 20.00 · 1 order'),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'View transactions for Creditor A' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Inspect PO-001' }));
  const inspector = screen.getByRole('complementary', { name: 'Record details' });
  expect(within(inspector).getByText('Posted payable')).toBeInTheDocument();
  expect(within(inspector).getByText('Unbilled order value')).toBeInTheDocument();
  expect(within(inspector).getAllByText('USD 20.00')).toHaveLength(2);
});
describe.each([
  { Page: Sales, permission: 'sales', name: 'SO-001' },
  { Page: Purchases, permission: 'purchases', name: 'PO-001' },
])('$permission record actions', ({ Page, permission, name }) => {
  it('keeps confirm/edit/delete controls out of a read-only inspector', async () => {
    state.permissions = new Set([`${permission}.view`]);
    const user = userEvent.setup();
    render(<Page />);
    await user.click(
      await screen.findByRole('button', {
        name: `View transactions for ${permission === 'sales' ? 'Customer A' : 'Creditor A'}`,
      }),
    );
    await user.click(await screen.findByRole('button', { name: `Inspect ${name}` }));
    const inspector = screen.getByRole('complementary', { name: 'Record details' });
    expect(
      within(inspector).queryByRole('button', { name: `Confirm order ${name}` }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByRole('button', { name: `Edit order ${name}` }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByRole('button', { name: `Delete order ${name}` }),
    ).not.toBeInTheDocument();
  });
  it('requires confirmation before posting an order and does not mutate when cancelled', async () => {
    state.permissions = new Set([`${permission}.view`, `${permission}.confirm`]);
    const user = userEvent.setup();
    render(<Page />);
    await user.click(
      await screen.findByRole('button', {
        name: `View transactions for ${permission === 'sales' ? 'Customer A' : 'Creditor A'}`,
      }),
    );
    await user.click(await screen.findByRole('button', { name: `Inspect ${name}` }));
    await user.click(screen.getByRole('button', { name: `Confirm order ${name}` }));
    const dialog = screen.getByRole('dialog');
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Back', exact: true }));
    expect(state.patch).not.toHaveBeenCalled();
  });
});
