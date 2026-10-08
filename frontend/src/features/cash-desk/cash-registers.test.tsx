import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consolidateTransactions } from '@/lib/account-consolidation';
import {
  CashLoanAccounts,
  CashMovementAccounts,
  CashSupplierInvoiceAccounts,
  cashMovementSnapshot,
} from './cash-registers';
import type { Invoice, Loan, Movement } from './types';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({
  backendGet: get,
  buildQuery: (query: Record<string, string>) => `?${new URLSearchParams(query)}`,
}));
const account = {
  id: 'till',
  name: 'Till',
  companyId: 'company',
  company: { name: 'Company' },
  currency: 'TZS',
};
const movement = (id: string, changes: Partial<Movement> = {}): Movement => ({
  id,
  kind: 'EXPENSE',
  amount: '100.10',
  currency: 'TZS',
  businessDate: '2026-10-08',
  description: `Expense ${id}`,
  reference: `EXP-${id}`,
  actorName: 'Recorder',
  createdAt: '2026-10-08',
  reversedAt: null,
  reversalReason: null,
  reversalOfId: null,
  invoicePaymentId: null,
  supplier: { id: 'supplier', name: 'Supplier' },
  entries: [{ id: `entry-${id}`, amount: '-100.10', account }],
  ...changes,
});
beforeEach(() => {
  get.mockReset();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});
const paging = { query: {}, revision: 0, page: 1, onPage: vi.fn() };

describe('Cash Desk account registers', () => {
  it('loads expense pages, excludes reversed cash and opens the original movement', async () => {
    const rows = [movement('1'), movement('2'), movement('3', { reversedAt: '2026-10-08' })];
    get.mockImplementation(async (_path, { query }) => ({
      rows: query.page === 1 ? rows.slice(0, 2) : rows.slice(2),
      total: 3,
      pageSize: 2,
    }));
    const select = vi.fn();
    render(<CashMovementAccounts {...paging} onSelect={select} />);
    const button = await screen.findByRole('button', { name: 'View transactions for Supplier' });
    expect(screen.getByText('TZS 200.20')).toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect EXP-3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open movement details' }));
    expect(select).toHaveBeenCalledWith(rows[2]);
    expect(screen.getByText('Transaction ID')).toBeInTheDocument();
  });
  it('keeps anonymous expenses, named parties, currencies and company routes separate', () => {
    const accounts = consolidateTransactions(
      [
        movement('1', { supplier: null }),
        movement('2', { supplier: null }),
        movement('3'),
        movement('4', { customer: { id: 'supplier', name: 'Supplier' }, supplier: null }),
        movement('5', { currency: 'USD' }),
        movement('6', {
          entries: [{ id: 'other', amount: '1', account: { ...account, companyId: 'another' } }],
        }),
      ],
      cashMovementSnapshot,
    );
    expect(accounts).toHaveLength(6);
  });
  it('groups loans by borrower and lender, preserving each repayment target', async () => {
    const loan: Loan = {
      id: 'loan-1',
      principal: '500',
      outstanding: '250',
      currency: 'TZS',
      loanDate: '2026-10-08',
      dueDate: null,
      description: 'Loan 1',
      voidedAt: null,
      lender: account,
      borrower: { ...account, id: 'other', companyId: 'borrower', company: { name: 'Borrower' } },
    };
    const loans = [loan, { ...loan, id: 'loan-2', description: 'Loan 2' }];
    get.mockResolvedValue({ rows: loans, total: 2, pageSize: 25 });
    const repay = vi.fn();
    render(<CashLoanAccounts {...paging} onRepay={repay} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View transactions for Borrower' }));
    expect(screen.getByText('TZS 1,000.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Loan 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record repayment' }));
    expect(repay).toHaveBeenCalledWith(loans[1]);
  });
  it('combines linked supplier aliases and keeps the original invoice payment action', async () => {
    const invoice = {
      id: 'inv-1',
      companyId: 'company',
      company: { name: 'Company' },
      supplier: { id: 'alias-1', canonicalSupplierId: 'supplier', name: 'Supplier' },
      currency: 'TZS',
      totalAmount: '100',
      paidAmount: '25',
      outstanding: '75',
      invoiceNumber: 'INV-1',
      invoiceDate: '2026-10-08',
      dueDate: '2026-10-20',
      branch: { name: 'Branch' },
      status: 'PARTIALLY_PAID',
      voidedAt: null,
    } as Invoice;
    const invoices = [
      invoice,
      {
        ...invoice,
        id: 'inv-2',
        invoiceNumber: 'INV-2',
        supplier: { ...invoice.supplier, id: 'alias-2' },
      },
    ];
    get.mockResolvedValue({ rows: invoices, total: 2, pageSize: 25 });
    const pay = vi.fn();
    render(<CashSupplierInvoiceAccounts {...paging} onPay={pay} />);
    const table = await screen.findByRole('table', { name: 'Supplier invoice accounts' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('TZS 150.00')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'View transactions for Supplier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect INV-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(pay).toHaveBeenCalledWith(invoices[1]);
  });
});
