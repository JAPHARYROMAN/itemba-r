import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesDesk } from './sales-desk';
import {
  WorkspaceInstanceProvider,
  WorkspaceSessionProvider,
} from '@/components/workspace/workspace-session';
import { WorkspaceNavigationProvider } from '@/components/workspace/workspace-navigation';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  path: '/sales-desk',
  query: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => state.query,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user', companyId: 'company', permissions: [...state.permissions] },
    loading: false,
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendList: vi.fn().mockResolvedValue([]),
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
vi.mock('./direct-sales-desk', () => ({
  DirectSalesDesk: ({ targetRecordId }: { targetRecordId?: string }) => (
    <p>Direct record: {targetRecordId}</p>
  ),
}));
const customer = {
  id: 'existing-customer',
  name: 'Acacia Trading',
  companyId: 'company',
  customerCode: 'CUS-42',
  customerType: 'COMPANY',
  company: { name: 'Example Company' },
  status: 'ACTIVE',
  currentBalance: '1250',
  creditLimit: '5000',
};
const sale = {
  id: 'existing-sale',
  salesOrderNumber: 'SO-042',
  companyId: 'company',
  orderDate: '2025-01-02',
  status: 'CONFIRMED',
  salesType: 'CREDIT_SALE',
  paymentStatus: 'PARTIALLY_PAID',
  totalAmount: '2000',
  paidAmount: '750',
  outstandingAmount: '1250',
  currency: 'TZS',
  lines: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set(['sales.view', 'customers.view']);
  state.path = '/sales-desk';
  state.query = new URLSearchParams();
  state.get.mockImplementation(async (path: string) =>
    path === '/customers'
      ? { data: [customer], total: 1 }
      : path === '/customers/workbench-summary'
        ? { total: 1, active: 1, blocked: 0, currentBalance: 1250 }
        : {
            totalOrders: 1,
            draft: 0,
            confirmed: 1,
            revenue: 2000,
            paidAmount: 750,
            outstanding: 1250,
            unpaidCount: 1,
          },
  );
  state.page.mockResolvedValue({ data: [sale], total: 1, page: 1, limit: 20, totalPages: 1 });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});
function AppWindow({ id, href }: { id: string; href: string }) {
  return (
    <section aria-label={id}>
      <WorkspaceInstanceProvider id={id} appId="sales-desk">
        <WorkspaceNavigationProvider
          appId="sales-desk"
          initialHref={href}
          ownsPath={(path) => path.startsWith('/sales-desk')}
        >
          <SalesDesk />
        </WorkspaceNavigationProvider>
      </WorkspaceInstanceProvider>
    </section>
  );
}
describe('Operations records in Sales Desk', () => {
  it('reads the original customer directory and links profiles by the existing ID without copying data', async () => {
    state.query = new URLSearchParams('view=customers');
    render(<SalesDesk />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Acacia Trading' }));
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute(
      'href',
      '/sales-desk/customers/existing-customer',
    );
    expect(state.get).toHaveBeenCalledWith('/customers', expect.anything());
    expect(state.get.mock.calls.some(([path]) => path === '/sales-desk/customers')).toBe(false);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.patch).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('retains customer permissions when a Sales Desk user opens a business customer link', async () => {
    state.permissions = new Set(['sales_desk.view']);
    state.query = new URLSearchParams('view=customers');
    render(<SalesDesk />);
    expect(await screen.findByText('Your role cannot view customers.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });
  it('keeps direct-entry record links on their original register', async () => {
    state.permissions = new Set(['sales_desk.view']);
    state.query = new URLSearchParams('record=direct-sale');
    render(<SalesDesk />);
    expect(await screen.findByText('Direct record: direct-sale')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('shows older sales and preserves independent filters when windows navigate away and back', async () => {
    const user = userEvent.setup();
    const windows = (showFirst: boolean) => (
      <WorkspaceSessionProvider>
        <UnsavedWorkProvider>
          {showFirst && <AppWindow id="First sales window" href="/sales-desk?view=sales" />}
          <AppWindow id="Second sales window" href="/sales-desk?view=sales" />
        </UnsavedWorkProvider>
      </WorkspaceSessionProvider>
    );
    const mounted = render(windows(true));
    const first = within(screen.getByRole('region', { name: 'First sales window' }));
    const second = within(screen.getByRole('region', { name: 'Second sales window' }));
    const firstSearch = await first.findByPlaceholderText('Order # or customer…');
    await second.findByPlaceholderText('Order # or customer…');
    expect(
      state.page.mock.calls
        .filter(([path]) => path === '/sales-orders')
        .every(([, options]) => !options.query.dateFrom && !options.query.dateTo),
    ).toBe(true);
    await user.type(firstSearch, 'SO-042');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/sales-orders',
        expect.objectContaining({ query: expect.objectContaining({ search: 'SO-042' }) }),
      ),
    );
    expect(second.getByPlaceholderText('Order # or customer…')).toHaveValue('');
    mounted.rerender(windows(false));
    mounted.rerender(windows(true));
    expect(
      await within(
        screen.getByRole('region', { name: 'First sales window' }),
      ).findByPlaceholderText('Order # or customer…'),
    ).toHaveValue('SO-042');
    expect(state.post).not.toHaveBeenCalled();
    expect(state.patch).not.toHaveBeenCalled();
  });
});
