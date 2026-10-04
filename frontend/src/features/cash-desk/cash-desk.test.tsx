import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDateField } from '@/test/date-field';
import userEvent from '@testing-library/user-event';
import { chooseSelectOption, getSelectField } from '@/test/select-field';
import { CashDesk } from './cash-desk';
import { CashEditor } from './cash-editor';
import { CashExpenses } from './cash-expenses';
import type { Account, Invoice, Movement } from './types';
import { erpMirror, money } from './types';
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  list: vi.fn(),
  permissions: new Set<string>(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendPost: api.post,
  backendList: api.list,
}));
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const directory = {
  companies: [{ id: 'company', name: 'Company' }],
  divisions: [{ id: 'division', name: 'Retail', companyId: 'company' }],
  branches: [{ id: 'branch', name: 'Central', divisionId: 'division', companyId: 'company' }],
};
const account: Account = {
  ...scope,
  id: 'till',
  name: 'Main till',
  currency: 'TZS',
  kind: 'CASH',
  balance: '9999999999999999.99',
  openingDate: '2026-01-01',
  company: { name: 'Company' },
  division: { name: 'Retail' },
  branch: { name: 'Central' },
};
beforeEach(() => {
  vi.resetAllMocks();
  api.permissions = new Set([
    'cash_desk.view',
    'cash_desk.manage',
    'cash_desk.record',
    'cash_desk.reverse',
    'invoice_desk.view',
    'invoice_desk.payments',
  ]);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  api.get.mockImplementation(async (path: string) =>
    path.endsWith('directory')
      ? directory
      : path.endsWith('accounts')
        ? [account]
        : path === '/cash-desk/overview'
          ? {
              date: '2026-01-02',
              currencies: [
                { currency: 'TZS', balance: account.balance, sales: '123.45', accounts: 1 },
                { currency: 'USD', balance: '20', sales: '1', accounts: 1 },
              ],
            }
          : path === '/invoice-desk/overview'
            ? { currencies: [{ currency: 'TZS', outstanding: '100.10' }], suppliers: [] }
            : { rows: [], total: 0, page: 1, pageSize: 25 },
  );
  api.post.mockResolvedValue({ id: 'saved' });
});
describe('Cash Desk', () => {
  it('loads the selected company directory when an explicit financial scope is required', async () => {
    const fallback = api.get.getMockImplementation()!;
    api.get.mockImplementation((path, ...args) =>
      path === '/cash-desk/directory'
        ? Promise.resolve({ ...directory, requiresCompanySelection: true })
        : fallback(path, ...args),
    );
    render(<CashDesk />);
    expect(
      await screen.findByText(
        'Choose a company to view its sales, collections and account balances.',
      ),
    ).toBeInTheDocument();
    await chooseSelectOption('Company', 'Company');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/cash-desk/directory',
        expect.objectContaining({ query: { companyId: 'company' } }),
      ),
    );
  });
  it('opens a searched movement from a fresh scoped read and preserves linked-loan controls', async () => {
    const fallback = api.get.getMockImplementation()!;
    const movement = {
      id: 'target',
      kind: 'BORROWING',
      description: 'Loan received',
      businessDate: '2026-09-01',
      amount: '1000',
      currency: 'TZS',
      reference: 'REF-NEW',
      entries: [],
      actorName: 'Treasury',
      loanFinancialEvent: { id: 'event', loanId: 'loan' },
    } as Movement;
    api.get.mockImplementation((path, ...args) =>
      path === '/cash-desk/movements/target' ? Promise.resolve(movement) : fallback(path, ...args),
    );
    render(<CashDesk targetRecordId="target" />);
    await screen.findByRole('dialog', { name: 'Borrowing received' });
    expect(screen.getByText('REF-NEW')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse movement' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /loan/i })).toHaveAttribute(
      'href',
      '/group-control/loans-debts/loans/loan',
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true })[0]);
    expect(navigation.replace).toHaveBeenCalledWith('/cash-desk', { scroll: false });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('keeps failed search targets retryable and removes the prior movement while changing target', async () => {
    const fallback = api.get.getMockImplementation()!;
    let fail = true;
    api.get.mockImplementation((path, ...args) =>
      path.startsWith('/cash-desk/movements/')
        ? fail
          ? Promise.reject(new Error('Movement unavailable'))
          : Promise.resolve({
              id: 'target',
              kind: 'OTHER_IN',
              description: 'Current movement',
              amount: '1',
              currency: 'TZS',
              businessDate: '2026-09-01',
              entries: [],
              actorName: 'User',
            })
        : fallback(path, ...args),
    );
    const view = render(<CashDesk targetRecordId="missing" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Movement unavailable');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Current movement');
    fail = true;
    view.rerender(<CashDesk targetRecordId="other" />);
    expect(screen.queryByText('Current movement')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Movement unavailable');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('does not fetch a search target after app access is denied', () => {
    api.permissions.clear();
    render(<CashDesk targetRecordId="target" />);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('records categorized expenses with the payee, notes and cash account', async () => {
    const saved = vi.fn();
    render(
      <CashEditor
        editor={{ kind: 'movement', movementKind: 'EXPENSE' }}
        accounts={[account]}
        directory={directory}
        scope={scope}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await chooseSelectOption('Paying account', /Main till/);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '150.25' } });
    await chooseSelectOption('Expense category', 'Travel & transport');
    fireEvent.change(screen.getByLabelText(/Paid to/), { target: { value: 'Courier service' } });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Document delivery' },
    });
    fireEvent.change(screen.getByLabelText(/Expense notes/), {
      target: { value: 'Delivery to head office' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save movement' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({
      kind: 'EXPENSE',
      accountId: 'till',
      expenseCategory: 'TRANSPORT',
      payee: 'Courier service',
      expenseNotes: 'Delivery to head office',
      amount: '150.25',
    });
  });
  it('links an expense to a supplier picked from the directory and defaults the payee to its name', async () => {
    api.permissions.add('suppliers.view');
    const supplier = { id: 'sup-1', name: 'Mwanjalisi Station' };
    api.list.mockResolvedValue([supplier]);
    const fallback = api.get.getMockImplementation()!;
    api.get.mockImplementation((path, ...args) =>
      path === '/suppliers/sup-1' ? Promise.resolve(supplier) : fallback(path, ...args),
    );
    const saved = vi.fn();
    render(
      <CashEditor
        editor={{ kind: 'movement', movementKind: 'EXPENSE' }}
        accounts={[account]}
        directory={directory}
        scope={scope}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await chooseSelectOption(/Paying account/, 'till');
    const picker = screen.getByLabelText('Supplier (optional)');
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Mwan' } });
    const option = await screen.findByText('Mwanjalisi Station');
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByLabelText(/Paid to/)).toHaveValue('Mwanjalisi Station'));
    expect(api.list).toHaveBeenCalledWith(
      '/suppliers',
      expect.objectContaining({ query: expect.objectContaining({ companyId: 'company' }) }),
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '150.25' } });
    await chooseSelectOption(/Expense category/, 'TRANSPORT');
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Fuel delivery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save movement' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({
      kind: 'EXPENSE',
      supplierId: 'sup-1',
      payee: 'Mwanjalisi Station',
    });
  });
  it('keeps paid and reversed spending separate, and never adds different currencies', async () => {
    api.get.mockResolvedValue({
      rows: [],
      total: 35,
      page: 1,
      pageSize: 25,
      currencies: [
        {
          currency: 'TZS',
          paid: '125000.10',
          reversed: '500.20',
          count: 34,
          categories: { RENT: '125000.10' },
        },
        { currency: 'USD', paid: '10.10', reversed: '0', count: 1, categories: { FEES: '10.10' } },
      ],
    });
    render(
      <CashExpenses
        scope={scope}
        accounts={[account]}
        revision={0}
        onSelect={vi.fn()}
        onSuppliers={vi.fn()}
      />,
    );
    await screen.findByText('TZS 500.20');
    expect(screen.getAllByText('TZS 125,000.10')).toHaveLength(2);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await chooseSelectOption('Currency', 'USD');
    expect(screen.getAllByText('USD 10.10')).toHaveLength(2);
    expect(screen.queryByText('TZS 500.20')).not.toBeInTheDocument();
  });
  it('sends expense filters with the organisation scope and rejects a reversed date range', async () => {
    api.get.mockResolvedValue({ rows: [], total: 0, currencies: [] });
    render(
      <CashExpenses
        scope={scope}
        accounts={[account]}
        revision={0}
        onSelect={vi.fn()}
        onSuppliers={vi.fn()}
      />,
    );
    await screen.findByText('No expenses in this view');
    await chooseSelectOption('Filter expense category', 'Rent & premises');
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/cash-desk/expenses',
        expect.objectContaining({
          query: expect.objectContaining({ ...scope, expenseCategory: 'RENT', page: 1 }),
        }),
      ),
    );
    await setDateField('Expenses from', '2099-01-01');
    expect(screen.getByRole('alert')).toHaveTextContent('start date');
    expect(screen.queryByText('Spending summary')).not.toBeInTheDocument();
  });
  it('shows failed expense reads as errors rather than zero spending', async () => {
    api.get.mockRejectedValue(new Error('Service unavailable'));
    render(
      <CashExpenses
        scope={scope}
        accounts={[account]}
        revision={0}
        onSelect={vi.fn()}
        onSuppliers={vi.fn()}
      />,
    );
    await screen.findByRole('alert');
    expect(screen.queryByText('No expenses in this view')).not.toBeInTheDocument();
  });
  it('does not fetch financial data without app access', () => {
    api.permissions.clear();
    render(<CashDesk />);
    expect(screen.getByText(/Ask your administrator for Cash Desk access/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('keeps currency balances separate and formats exact decimal strings', async () => {
    render(<CashDesk />);
    await screen.findByText('TZS 9,999,999,999,999,999.99');
    await chooseSelectOption('Desk account currency', 'USD');
    expect(screen.getByText('USD 20.00')).toBeInTheDocument();
    expect(screen.queryByText('TZS 9,999,999,999,999,999.99')).not.toBeInTheDocument();
  });
  it('does not fetch shared invoice balances without Invoice Desk access', async () => {
    api.permissions.delete('invoice_desk.view');
    render(<CashDesk />);
    await screen.findByText('TZS 9,999,999,999,999,999.99');
    expect(api.get.mock.calls.some(([p]) => p.startsWith('/invoice-desk'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Supplier balances' }));
    expect(screen.getByText('Invoice Desk access needed')).toBeInTheDocument();
  });
  it('hides recording and account creation for read-only users', async () => {
    api.permissions = new Set(['cash_desk.view']);
    render(<CashDesk />);
    await screen.findByText('TZS 9,999,999,999,999,999.99');
    expect(screen.queryByRole('button', { name: 'Record movement' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(screen.queryByRole('button', { name: 'New account' })).not.toBeInTheDocument();
  });
  it('retains the draft and request reference after a failed submission', async () => {
    api.post.mockRejectedValueOnce(new Error('Connection interrupted'));
    const saved = vi.fn();
    render(
      <CashEditor
        editor={{ kind: 'movement' }}
        accounts={[account]}
        directory={directory}
        scope={scope}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await chooseSelectOption('Receiving account', /Main till/);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '20.10' } });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Tuesday cash sales' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save movement' }));
    await screen.findByText('Connection interrupted');
    expect(screen.getByLabelText(/Amount/)).toHaveValue('20.10');
    fireEvent.click(screen.getByRole('button', { name: 'Save movement' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].requestId).toBe(api.post.mock.calls[1][1].requestId);
    expect(api.post.mock.calls[1][1]).toMatchObject({
      kind: 'DAILY_SALES',
      amount: '20.10',
      accountId: 'till',
    });
  });
  it('shows the counterparty and the settled document as links when the reader may open them', async () => {
    api.permissions.add('suppliers.view');
    api.permissions.add('payables.view');
    const fallback = api.get.getMockImplementation()!;
    const movement = {
      id: 'target',
      kind: 'SUPPLIER_PAYMENT',
      description: 'Fuel delivery settled',
      businessDate: '2026-09-01',
      amount: '1000',
      currency: 'TZS',
      reference: 'REF-9',
      entries: [],
      actorName: 'Treasury',
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      supplier: { id: 'sup-1', name: 'Mwanjalisi Station' },
      payable: { id: 'pay-1', payableNumber: 'PAY-7' },
      supplierPayment: { id: 'sp-1', paymentNumber: 'SPY-3' },
    } as Movement;
    api.get.mockImplementation((path, ...args) =>
      path === '/cash-desk/movements/target' ? Promise.resolve(movement) : fallback(path, ...args),
    );
    render(<CashDesk targetRecordId="target" />);
    await screen.findByRole('dialog', { name: 'Purchases' });
    expect(screen.getByRole('link', { name: /Mwanjalisi Station/ })).toHaveAttribute(
      'href',
      '/invoice-desk/suppliers/sup-1',
    );
    expect(screen.getByRole('link', { name: /PAY-7/ })).toHaveAttribute(
      'href',
      '/cash-desk/payables?search=PAY-7',
    );
    expect(screen.getByText('SPY-3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /SPY-3/ })).not.toBeInTheDocument();
  });
  it('keeps the counterparty as text without profile access and honours a supplier in the URL', async () => {
    const fallback = api.get.getMockImplementation()!;
    const row = {
      id: 'm1',
      kind: 'SUPPLIER_PAYMENT',
      description: 'Fuel delivery settled',
      businessDate: '2026-09-01',
      amount: '1000',
      currency: 'TZS',
      reference: 'REF-9',
      entries: [],
      actorName: 'Treasury',
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      supplier: { id: 'sup-1', name: 'Mwanjalisi Station' },
      payable: { id: 'pay-1', payableNumber: 'PAY-7' },
    } as Movement;
    api.get.mockImplementation((path, ...args) =>
      path === '/cash-desk/movements'
        ? Promise.resolve({ rows: [row], total: 1, page: 1, pageSize: 25 })
        : fallback(path, ...args),
    );
    render(<CashDesk targetSupplierId="sup-1" />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/cash-desk/movements',
        expect.objectContaining({ query: expect.objectContaining({ supplierId: 'sup-1' }) }),
      ),
    );
    expect(await screen.findByText('Showing supplier', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Mwanjalisi Station').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Mwanjalisi Station/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(navigation.replace).toHaveBeenCalledWith('/cash-desk?view=movements', {
      scroll: false,
    });
  });
  it('shows supplier balances from the resolver with their split and a profile link', async () => {
    api.permissions.add('suppliers.view');
    const fallback = api.get.getMockImplementation()!;
    api.get.mockImplementation((path, ...args) =>
      path === '/party-balance/suppliers'
        ? Promise.resolve([
            {
              kind: 'supplier',
              partyId: 'sup-1',
              companyId: 'company',
              name: 'Mwanjalisi Station',
              code: 'SUP-001',
              baseCurrency: 'TZS',
              erp: [{ currency: 'TZS', open: '1000.00', overdue: '400.00', documents: 3 }],
              desk: [{ currency: 'TZS', outstanding: '150.00', overdue: '0.00', documents: 2 }],
              notebook: [{ currency: 'TZS', outstanding: '50.00', records: 1 }],
              total: [{ currency: 'TZS', amount: '1150.00' }],
              overdue: [{ currency: 'TZS', amount: '400.00' }],
              creditLimit: '0.00',
              creditAvailable: null,
              cached: '900.00',
              lastPaymentAt: '2026-09-30T00:00:00.000Z',
            },
          ])
        : fallback(path, ...args),
    );
    render(<CashDesk />);
    await screen.findByText('TZS 9,999,999,999,999,999.99');
    fireEvent.click(screen.getByRole('button', { name: 'Supplier balances' }));
    expect(await screen.findByRole('link', { name: 'Mwanjalisi Station' })).toHaveAttribute(
      'href',
      '/invoice-desk/suppliers/sup-1',
    );
    expect(screen.getByText('TZS 1,150.00')).toBeInTheDocument();
    expect(screen.getByText(/Payables TZS 1,000\.00 · TZS 400\.00 overdue/)).toBeInTheDocument();
    expect(screen.getByText(/NoteBook TZS 50\.00 · not in total/)).toBeInTheDocument();
    expect(screen.queryByText('TZS 900.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
  it('links supplier payment to the selected invoice and its version', async () => {
    const invoice = {
      ...scope,
      id: 'invoice',
      invoiceNumber: 'INV-1',
      supplier: { name: 'Supplier' },
      outstanding: '30.10',
      currency: 'TZS',
      version: 4,
    } as Invoice;
    const saved = vi.fn();
    render(
      <CashEditor
        editor={{ kind: 'movement', invoice }}
        accounts={[
          account,
          { ...account, id: 'other', companyId: 'other-company', name: 'Other till' },
        ]}
        directory={directory}
        scope={scope}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await userEvent.click(getSelectField('Paying account'));
    await screen.findByRole('option', { name: /Main till/ });
    expect(screen.queryByRole('option', { name: /Other till/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Main till/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save movement' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toMatchObject({
      kind: 'SUPPLIER_PAYMENT',
      invoiceId: 'invoice',
      invoiceVersion: 4,
      amount: '30.10',
    });
  });
});

/** Party linkage, Phase 3 PR-8: Accounts shows the connected ERP account and any difference. */
describe('Cash Desk accounts and the ERP mirror', () => {
  const connected = (currentBalance: string): Account => ({
    ...account,
    erpCashAccountId: 'bank',
    erpCashAccount: { id: 'bank', accountName: 'Main bank', currentBalance, currency: 'TZS' },
  });

  it('computes the mirror and the difference exactly, to the cent, whatever the size', () => {
    expect(erpMirror(account)).toBeNull();
    expect(erpMirror(connected('9999999999999998.99'))).toEqual({
      name: 'Main bank',
      mirror: '9999999999999998.99',
      difference: '-1.00',
      inStep: false,
    });
    expect(erpMirror(connected(account.balance))).toMatchObject({
      difference: '0.00',
      inStep: true,
    });
    expect(erpMirror(connected('10000000000000000.49'))).toMatchObject({ difference: '0.50' });
    expect(erpMirror(connected('not money'))).toMatchObject({ difference: '?', inStep: false });
  });

  it('names the connection and the difference on each account card', async () => {
    const fallback = api.get.getMockImplementation()!;
    api.get.mockImplementation((path, ...args) =>
      path.endsWith('accounts')
        ? Promise.resolve([
            connected('9999999999999998.99'),
            { ...account, id: 'petty', name: 'Petty cash', balance: '5.00' },
          ])
        : fallback(path, ...args),
    );
    render(<CashDesk />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }));
    const notes = await screen.findAllByTestId('cash-account-mirror');
    expect(notes.map((n) => n.textContent)).toEqual([
      `ERP Main bank · mirror ${money('9999999999999998.99', 'TZS')} · difference ${money('-1.00', 'TZS')}`,
      'Not connected to an ERP cash account',
    ]);
  });
});
