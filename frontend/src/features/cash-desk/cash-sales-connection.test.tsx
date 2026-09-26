import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashSalesConnection, type SalesConnection } from './cash-sales-connection';
import { notifyDeskSaved } from '@/components/workspace/linked-desk-changes';

const api = vi.hoisted(() => ({ get: vi.fn(), permissions: new Set<string>(), modal: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p) }),
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  WorkspaceLink: (props: any) => <a {...props} />,
}));
vi.mock('@/app/(dashboard)/operations/_components/record-sales-order-payment-modal', () => ({
  RecordSalesOrderPaymentModal: (props: any) => {
    api.modal(props);
    return (
      <div role="dialog" aria-label="Collect">
        <button onClick={props.onSaved}>Save test payment</button>
        <button onClick={props.onClose}>Cancel payment</button>
      </div>
    );
  },
}));
const scope = { companyId: 'c', divisionId: 'd', branchId: 'b' };
const response: SalesConnection = {
  date: '2026-09-26',
  page: 1,
  pageSize: 25,
  accountsVisible: true,
  receiptsVisible: true,
  currencies: [{ currency: 'TZS', balance: '500', outstanding: '170', received: '30' }],
  accounts: [
    {
      id: 'a',
      accountName: 'Business till',
      accountType: 'CASH_ON_HAND',
      currency: 'TZS',
      currentBalance: '500',
      isActive: true,
      company: { name: 'Company' },
      branch: { name: 'Branch' },
    },
  ],
  outstanding: {
    total: 1,
    rows: [
      {
        ...scope,
        id: 'r',
        customerName: 'Test customer',
        receivableNumber: 'REC',
        salesOrderNumber: 'SO1',
        saleId: 's',
        currency: 'TZS',
        outstandingAmount: '170',
        paidAmount: '30',
        dueDate: '2026-09-27',
        branch: { name: 'Branch' },
      },
    ],
  },
  receipts: {
    total: 1,
    rows: [
      {
        id: 'j',
        date: '2026-09-26',
        reference: 'JE1',
        customer: 'Test customer',
        amount: '30',
        currency: 'TZS',
        account: null,
        saleId: 's',
        kind: 'Receivable collection',
      },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  api.permissions = new Set([
    'cash_desk.view',
    'sales.view',
    'receivables.view',
    'receivables.manage',
  ]);
  api.get.mockResolvedValue(response);
});
describe('Business sales in Cash Desk', () => {
  it('opens the same sale and collects against its existing receivable', async () => {
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    expect(screen.getByRole('link', { name: 'View sale' })).toHaveAttribute(
      'href',
      '/sales-desk/sales/s',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collect payment for SO1' }));
    expect(api.modal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        receivableId: 'r',
        companyId: 'c',
        divisionId: 'd',
        branchId: 'b',
        outstanding: 170,
        currency: 'TZS',
      }),
    );
    const before = api.get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save test payment' }));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('refreshes after Sales Desk changes but defers while a collection is being edited', async () => {
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    fireEvent.click(screen.getByRole('button', { name: 'Collect payment for SO1' }));
    const before = api.get.mock.calls.length;
    act(() => notifyDeskSaved('sales-desk'));
    expect(api.get).toHaveBeenCalledTimes(before);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' }));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before));
  });
  it('retains company/branch/date filters and shows real receipt accounts', async () => {
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    expect(api.get).toHaveBeenCalledWith(
      '/cash-desk/sales-connection',
      expect.objectContaining({ query: { ...scope, date: '2026-09-26', page: 1, search: '' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Business accounts' }));
    expect(screen.getByText('Business till')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collected payments' }));
    expect(screen.getByText('Receivable collection · JE1')).toBeInTheDocument();
    expect(screen.getByText('Receipt account not available in this history')).toBeInTheDocument();
  });
  it('does not offer collections without write access or read business records without view access', async () => {
    api.permissions.delete('receivables.manage');
    const view = render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    expect(
      screen.queryByRole('button', { name: 'Collect payment for SO1' }),
    ).not.toBeInTheDocument();
    view.unmount();
    api.get.mockClear();
    api.permissions.delete('sales.view');
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('shows a failed read as unavailable instead of a zero balance', async () => {
    api.get.mockRejectedValue(new Error('Connection unavailable'));
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
    expect(screen.queryByText('TZS 0.00')).not.toBeInTheDocument();
  });
});
