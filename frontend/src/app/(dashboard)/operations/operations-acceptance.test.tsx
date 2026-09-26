import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '@/app/(dashboard)/operations/page';
import PurchaseDetail from '@/app/(dashboard)/operations/purchase-orders/[id]/page';
import DraftDetail from '@/app/(dashboard)/operations/purchase-orders/order-drafts/[id]/page';
import DraftPrint from '@/app/(dashboard)/operations/purchase-orders/order-drafts/[id]/print/page';
import { BusinessSaleDetail } from '@/features/sales-desk/business-sale-detail';
import SalesPrint from '@/app/(dashboard)/operations/sales-orders/[id]/print/page';
function SalesDetail() {
  return <BusinessSaleDetail saleId="record-1" />;
}

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
  }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'record-1' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/operations',
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: (...args: unknown[]) => state.get(...args),
  backendList: (...args: unknown[]) => state.list(...args),
  backendPage: vi.fn(),
  backendPatch: vi.fn(),
  backendPost: vi.fn(),
  backendDelete: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.get.mockReset();
  state.list.mockReset().mockResolvedValue([]);
});

describe('operations route gates', () => {
  it('does not read a sales order without sales.view', () => {
    render(<SalesDetail />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('does not read a purchase order without purchases.view', () => {
    render(<PurchaseDetail />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('does not read a supplier draft without supplier_order_drafts.view', () => {
    render(<DraftDetail />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('retries a failed sales-order print', async () => {
    state.permissions = new Set(['sales.view']);
    state.get.mockRejectedValue(new Error('Print source unavailable'));
    const user = userEvent.setup();
    render(<SalesPrint />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Print source unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.get).toHaveBeenCalledTimes(2);
  });

  it('hides supplier-draft share without export permission', async () => {
    state.permissions = new Set(['supplier_order_drafts.view']);
    state.get.mockResolvedValue({
      id: 'record-1',
      draftNumber: 'SD-001',
      lines: [],
      company: { name: 'Acme' },
    });
    render(<DraftPrint />);
    expect(await screen.findByRole('button', { name: /Print \/ Save PDF/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate PDF' })).not.toBeInTheDocument();
  });

  it('retries the operations dashboard after a failed read', async () => {
    state.permissions = new Set(['operations.dashboard.view']);
    state.list.mockResolvedValue([{ id: 'co-1', name: 'Acme', code: 'AC' }]);
    state.get.mockRejectedValue(new Error('Dashboard offline'));
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
