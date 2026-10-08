import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        amount: '200',
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
        companyId: 'c',
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
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  api.permissions = new Set([
    'cash_desk.view',
    'sales.view',
    'receivables.view',
    'receivables.manage',
  ]);
  api.get.mockResolvedValue(response);
});
async function individualTransactions() {
  fireEvent.click(await screen.findByRole('button', { name: 'Individual transactions' }));
  await screen.findAllByText('Test customer');
}
describe('Business sales in Cash Desk', () => {
  it('starts collected payments with one customer account and opens the original receipt details', async () => {
    api.get.mockResolvedValue({
      ...response,
      receipts: {
        total: 2,
        rows: [
          response.receipts.rows[0],
          { ...response.receipts.rows[0], id: 'second', reference: 'JE2', amount: '40' },
        ],
      },
    });
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    fireEvent.click(screen.getByRole('button', { name: 'Collected payments' }));
    const table = screen.getByRole('table', { name: 'Collected customer accounts' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('TZS 70.00')).toBeInTheDocument();
    fireEvent.click(
      within(table).getByRole('button', { name: 'View transactions for Test customer' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inspect JE2' }));
    expect(screen.getByRole('link', { name: 'View sale' })).toHaveAttribute(
      'href',
      '/sales-desk/sales/s',
    );
    expect(screen.getByText('second')).toBeInTheDocument();
  });
  it('defers a parent refresh until the collection form closes', async () => {
    const view = render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    await individualTransactions();
    fireEvent.click(screen.getByRole('button', { name: 'Collect payment for SO1' }));
    const before = api.get.mock.calls.length;
    view.rerender(<CashSalesConnection scope={scope} date="2026-09-26" revision={1} />);
    expect(api.get).toHaveBeenCalledTimes(before);
    expect(screen.getByRole('dialog', { name: 'Collect' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' }));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before));
  });
  it('opens the same sale and collects against its existing receivable', async () => {
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await screen.findByText('Test customer');
    await individualTransactions();
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
    await individualTransactions();
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
    await individualTransactions();
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
    await individualTransactions();
    expect(
      screen.queryByRole('button', { name: 'Collect payment for SO1' }),
    ).not.toBeInTheDocument();
    view.unmount();
    api.get.mockClear();
    api.permissions.delete('sales.view');
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('labels Sales Desk and NoteBook debt by source, links the customer and only collects receivables', async () => {
    api.permissions.add('customers.view');
    const base = response.outstanding.rows[0];
    api.get.mockResolvedValue({
      ...response,
      currencies: [{ ...response.currencies[0], notebook: '20' }],
      outstanding: {
        total: 3,
        rows: [
          { ...base, source: 'RECEIVABLE', customerId: 'cus-1' },
          {
            ...base,
            id: 'desk',
            source: 'SALES_DESK',
            customerId: 'cus-1',
            saleId: null,
            salesOrderNumber: null,
            deskSaleId: 'desk',
            saleNumber: 'SD-1',
          },
          {
            ...base,
            id: 'note',
            source: 'NOTEBOOK',
            customerId: null,
            customerName: 'Walk-in',
            saleId: null,
            salesOrderNumber: null,
            recordId: 'note',
            receivableNumber: 'NB-1',
          },
        ],
      },
    });
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    await individualTransactions();
    const customers = await screen.findAllByRole('link', { name: 'Test customer' });
    expect(customers).toHaveLength(2);
    expect(customers[0]).toHaveAttribute('href', '/sales-desk/customers/cus-1');
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
    expect(screen.getByText('NoteBook debtors (informal)')).toBeInTheDocument();
    expect(screen.getByText(/Sales Desk · SD-1/)).toBeInTheDocument();
    expect(screen.getByText(/NoteBook · NB-1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open NoteBook' })).toHaveAttribute(
      'href',
      '/records?record=note',
    );
    expect(
      screen.getAllByRole('link', { name: 'View sale' }).map((l) => l.getAttribute('href')),
    ).toEqual(['/sales-desk/sales/s', '/sales-desk/sales/desk']);
    expect(screen.getAllByRole('button', { name: /Collect payment for/ })).toHaveLength(1);
  });
  it('shows a failed read as unavailable instead of a zero balance', async () => {
    api.get.mockRejectedValue(new Error('Connection unavailable'));
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
    expect(screen.queryByText('TZS 0.00')).not.toBeInTheDocument();
  });
  it('starts with one KAMENDU account across result pages and retains every transaction and collection action', async () => {
    const balances = ['620000', '85000', '160000', '725000'];
    const rows = balances.map((amount, index) => ({
      ...response.outstanding.rows[0],
      id: `kamendu-${index}`,
      customerId: 'kamendu',
      customerName: 'KAMENDU HARDWARE',
      salesOrderNumber: `SO-KAMENDU-${index}`,
      amount,
      outstandingAmount: amount,
      paidAmount: '0',
    }));
    api.get.mockImplementation(async (_path, options) => ({
      ...response,
      page: options.query.page,
      pageSize: 2,
      outstanding: {
        total: 4,
        rows: rows.slice((options.query.page - 1) * 2, options.query.page * 2),
      },
      receipts: { total: 0, rows: [] },
    }));
    render(<CashSalesConnection scope={scope} date="2026-09-26" revision={0} />);
    const account = await screen.findByRole('button', {
      name: 'View transactions for KAMENDU HARDWARE',
    });
    expect(screen.getAllByText('KAMENDU HARDWARE')).toHaveLength(1);
    expect(within(account.closest('tr')!).getAllByRole('cell')[5]).toHaveTextContent(
      'TZS 1,590,000.00',
    );
    expect(screen.queryByRole('button', { name: /Collect payment for/ })).not.toBeInTheDocument();
    fireEvent.click(account);
    for (let index = 0; index < 4; index++)
      expect(screen.getByText(`ID: kamendu-${index}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect SO-KAMENDU-3' }));
    expect(screen.getByText('Transaction ID')).toBeInTheDocument();
    expect(
      screen.getAllByRole('term').filter((term) => term.textContent === 'Customer'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Collect payment for SO-KAMENDU-3' }));
    expect(api.modal).toHaveBeenLastCalledWith(
      expect.objectContaining({ receivableId: 'kamendu-3', outstanding: 725000 }),
    );
  });
});
