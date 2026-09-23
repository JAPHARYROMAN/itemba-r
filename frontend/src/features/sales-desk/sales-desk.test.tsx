import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesDesk } from './sales-desk';
import { SalesEditor } from './sales-editor';
import { lineTotal, saleTotal, type Sale } from './types';
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), permissions: new Set<string>() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (...p: string[]) => p.every((x) => api.permissions.has(x)) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get, backendPost: api.post }));
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const directory = {
  companies: [{ id: 'company', name: 'Company' }],
  divisions: [{ id: 'division', name: 'Retail', companyId: 'company' }],
  branches: [{ id: 'branch', name: 'Central', divisionId: 'division', companyId: 'company' }],
};
const customer = {
  id: 'customer',
  companyId: 'company',
  name: 'Acme',
  company: { name: 'Company' },
};
const sale: Sale = {
  ...scope,
  id: 'sale',
  customerId: customer.id,
  customer,
  saleNumber: 'S-TEST',
  saleDate: '2026-01-02',
  dueDate: '2026-01-03',
  currency: 'TZS',
  totalAmount: '100.11',
  paidAmount: '40.10',
  outstanding: '60.01',
  status: 'Overdue',
  version: 2,
  voidedAt: null,
  company: { name: 'Company' },
  division: { name: 'Retail' },
  branch: { name: 'Central' },
  lines: [],
  payments: [],
  events: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  api.permissions = new Set([
    'sales_desk.view',
    'sales_desk.manage',
    'sales_desk.payments',
    'cash_desk.view',
    'cash_desk.record',
  ]);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  api.get.mockImplementation(async (path: string) =>
    path.endsWith('directory')
      ? directory
      : path.endsWith('customers')
        ? [customer]
        : path.endsWith('overview')
          ? {
              currencies: [
                {
                  currency: 'TZS',
                  total: '100.11',
                  paid: '40.10',
                  outstanding: '60.01',
                  overdue: '60.01',
                  count: 1,
                },
                {
                  currency: 'USD',
                  total: '20',
                  paid: '0',
                  outstanding: '20',
                  overdue: '0',
                  count: 1,
                },
              ],
              customers: [],
            }
          : path.endsWith('/sale')
            ? sale
            : { rows: [sale], total: 1, page: 1, pageSize: 25 },
  );
  api.post.mockResolvedValue({ id: 'sale' });
});
describe('Sales Desk', () => {
  it('opens a searched sale directly without recording a payment and clears its route on close', async () => {
    render(<SalesDesk targetRecordId="sale" />);
    await screen.findByRole('dialog', { name: 'S-TEST' });
    expect(api.get).toHaveBeenCalledWith(
      '/sales-desk/sales/sale',
      expect.objectContaining({ query: {} }),
    );
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true })[0]);
    expect(navigation.replace).toHaveBeenCalledWith('/sales-desk', { scroll: false });
  });
  it('does not fetch a searched sale without Sales Desk access', () => {
    api.permissions.clear();
    render(<SalesDesk targetRecordId="sale" />);
    expect(api.get).not.toHaveBeenCalled();
  });
  it('keeps preview calculations exact and rounds each line half up', () => {
    expect(lineTotal('0.5', '0.01')).toBe('0.01');
    expect(lineTotal('1', '9999999999999999.99')).toBe('9999999999999999.99');
    expect(
      saleTotal([
        { quantity: '1', unitPrice: '0.10' },
        { quantity: '1', unitPrice: '0.20' },
      ]),
    ).toBe('0.30');
    expect(lineTotal('2', '9999999999999999.99')).toBeNull();
    expect(lineTotal('0.001', '0.01')).toBeNull();
  });
  it('does not fetch sales data without app access', () => {
    api.permissions.clear();
    render(<SalesDesk />);
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('separates currency summaries and hides write actions for viewers', async () => {
    api.permissions = new Set(['sales_desk.view']);
    render(<SalesDesk />);
    await screen.findByText('TZS 40.10');
    fireEvent.change(screen.getByLabelText('Sales summary currency'), { target: { value: 'USD' } });
    expect(screen.getAllByText('USD 20.00')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'New sale' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Acme S-TEST/ }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
  it('does not describe failed reads as an empty business', async () => {
    api.get.mockRejectedValue(new Error('Service unavailable'));
    render(<SalesDesk />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Start with your customers')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
    expect(screen.queryByText('No sales match this view.')).not.toBeInTheDocument();
  });
  it('records line items and reuses the request ID after an uncertain response', async () => {
    const saved = vi.fn();
    api.post
      .mockRejectedValueOnce(new Error('Network interrupted'))
      .mockResolvedValueOnce({ id: 'sale' });
    render(
      <SalesEditor
        editor={{ kind: 'sale' }}
        scope={scope}
        directory={directory}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await screen.findByRole('option', { name: 'Acme' });
    fireEvent.change(screen.getByLabelText(/^Customer/), { target: { value: 'customer' } });
    fireEvent.change(screen.getByLabelText(/Item 1 description/), { target: { value: 'Feed' } });
    fireEvent.change(screen.getByLabelText(/Item 1 quantity/), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText(/Item 1 unit price/), { target: { value: '100.01' } });
    expect(screen.getByText('TZS 50.01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save sale' }));
    await screen.findByText('Network interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Save sale' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('sale'));
    expect(api.post.mock.calls[0][1]).toMatchObject({
      ...scope,
      customerId: 'customer',
      lines: [{ description: 'Feed', quantity: '0.5', unitPrice: '100.01' }],
    });
    expect(api.post.mock.calls[0][1].requestId).toBe(api.post.mock.calls[1][1].requestId);
  });
  it('limits receipt accounts to the sale currency and sends the sale version', async () => {
    api.get.mockResolvedValue([
      {
        id: 'till',
        currency: 'TZS',
        name: 'Till',
        branch: { name: 'Central' },
        company: { name: 'Company' },
      },
      {
        id: 'usd',
        currency: 'USD',
        name: 'Dollar account',
        branch: { name: 'Central' },
        company: { name: 'Company' },
      },
    ]);
    const saved = vi.fn();
    render(
      <SalesEditor
        editor={{ kind: 'payment', sale }}
        scope={scope}
        directory={directory}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await screen.findByRole('option', { name: /Till/ });
    expect(screen.queryByRole('option', { name: /Dollar account/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Receiving account/), { target: { value: 'till' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('sale'));
    expect(api.post).toHaveBeenCalledWith(
      '/sales-desk/sales/sale/payments',
      expect.objectContaining({ version: 2, accountId: 'till', amount: '60.01' }),
    );
  });
  it('requires Cash Desk recording permission and blocks voiding paid sales', async () => {
    api.permissions.delete('cash_desk.record');
    render(<SalesDesk />);
    fireEvent.click(await screen.findByRole('button', { name: /Acme S-TEST/ }));
    await screen.findByText('No payments recorded yet.');
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void this sale' })).not.toBeInTheDocument();
  });
});
