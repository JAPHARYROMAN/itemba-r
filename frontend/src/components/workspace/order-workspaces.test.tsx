import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sales from '@/app/(dashboard)/operations/sales-orders/page';
import Purchases from '@/app/(dashboard)/operations/purchase-orders/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  usePathname: () => '/operations/purchase-orders',
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
};
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.page
    .mockReset()
    .mockResolvedValue({ data: [record], total: 1, totalPages: 1, page: 1, limit: 20 });
  state.get.mockReset().mockResolvedValue({
    totalOrders: 1,
    confirmed: 0,
    unpaidCount: 1,
    revenue: 0,
    invoices: { missingInvoiceCount: 0 },
  });
  state.patch.mockReset();
});
describe.each([
  { Page: Sales, permission: 'sales', name: 'SO-001' },
  { Page: Purchases, permission: 'purchases', name: 'PO-001' },
])('$permission record actions', ({ Page, permission, name }) => {
  it('keeps confirm/edit/delete controls out of a read-only inspector', async () => {
    state.permissions = new Set([`${permission}.view`]);
    const user = userEvent.setup();
    render(<Page />);
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
    await user.click(await screen.findByRole('button', { name: `Inspect ${name}` }));
    await user.click(screen.getByRole('button', { name: `Confirm order ${name}` }));
    const dialog = screen.getByRole('dialog');
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Back', exact: true }));
    expect(state.patch).not.toHaveBeenCalled();
  });
});
