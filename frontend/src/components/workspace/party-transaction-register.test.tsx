import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { businessTransactionSnapshot } from '@/lib/account-consolidation';
import { loadAllTransactions, PartyTransactionRegister } from './party-transaction-register';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  backendGet: api.get,
}));
const rows = Array.from({ length: 7 }, (_, i) => ({
  id: `transaction-${i}`,
  supplierId: 'supplier-a',
  supplierName: 'Creditor A',
  companyId: 'company-a',
  company: { name: 'Company A' },
  currency: 'USD',
  amount: '10.10',
  paidAmount: '0.10',
  outstandingAmount: '10.00',
  status: 'OPEN',
  date: '2026-10-01',
}));
beforeEach(() => {
  api.get.mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});
describe('Account to transaction drill-down', () => {
  it('shows an account when a restored transaction page exceeds the account count', async () => {
    api.get.mockResolvedValue(rows);
    render(
      <PartyTransactionRegister
        endpoint="/invoices"
        query={{}}
        page={7}
        title="Creditor accounts"
        snapshot={businessTransactionSnapshot}
        documentName={(record: (typeof rows)[number]) => record.id}
        documentDate={(record) => record.date}
        documentStatus={(record) => record.status}
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'View transactions for Creditor A' }),
    ).toBeInTheDocument();
    expect(screen.getByText('USD 70.00')).toBeInTheDocument();
  });
  it('uses the last valid account page and navigates from that page after totals shrink', async () => {
    api.get.mockResolvedValue(
      Array.from({ length: 45 }, (_, i) => ({
        ...rows[0],
        id: `r-${i}`,
        supplierId: `s-${i}`,
        supplierName: `Creditor ${i}`,
      })),
    );
    const onPage = vi.fn();
    render(
      <PartyTransactionRegister
        endpoint="/invoices"
        query={{}}
        page={9}
        pageSize={20}
        onPage={onPage}
        title="Creditor accounts"
        snapshot={businessTransactionSnapshot}
        documentName={(record: (typeof rows)[number]) => record.id}
        documentDate={(record) => record.date}
        documentStatus={(record) => record.status}
      />,
    );
    await screen.findByText('45 accounts · Page 3 of 3');
    expect(screen.getAllByRole('button', { name: /View transactions for Creditor/ })).toHaveLength(
      5,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
  it('loads all pages and opens an individual transaction with its full ID and actions', async () => {
    api.get.mockImplementation(async (_path, { query }) => ({
      data: query.page === 1 ? rows.slice(0, 3) : rows.slice(3),
      total: 7,
      totalPages: 2,
    }));
    const open = vi.fn();
    const user = userEvent.setup();
    render(
      <PartyTransactionRegister
        endpoint="/invoices"
        query={{ companyId: 'company-a' }}
        title="Creditor accounts"
        snapshot={businessTransactionSnapshot}
        documentName={(record: (typeof rows)[number]) => record.id}
        documentDate={(record) => record.date}
        documentStatus={(record) => record.status}
        documentActions={(record) => (
          <button onClick={() => open(record.id)}>Open full record</button>
        )}
      />,
    );
    const account = await screen.findByRole('button', { name: 'View transactions for Creditor A' });
    expect(screen.getAllByText('USD 70.00')).toHaveLength(1);
    await user.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Inspect transaction-6' }));
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(detail).getByText('transaction-6', { selector: 'dd' })).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Open full record' }));
    expect(open).toHaveBeenCalledWith('transaction-6');
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('shows an error instead of a partial total when a later page fails', async () => {
    api.get
      .mockResolvedValueOnce({ rows: rows.slice(0, 3), total: 7, pageSize: 3 })
      .mockRejectedValueOnce(new Error('Second page failed'));
    const user = userEvent.setup();
    render(
      <PartyTransactionRegister
        endpoint="/invoices"
        query={{}}
        title="Creditor accounts"
        snapshot={businessTransactionSnapshot}
        documentName={(record: (typeof rows)[number]) => record.id}
        documentDate={(record) => record.date}
        documentStatus={(record) => record.status}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Second page failed');
    expect(
      screen.queryByRole('button', { name: 'View transactions for Creditor A' }),
    ).not.toBeInTheDocument();
    api.get.mockResolvedValue({ items: rows, totalPages: 1 });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'View transactions for Creditor A' }),
    ).toBeInTheDocument();
  });
  it('uses fixed-page desk APIs without sending an unsupported limit', async () => {
    api.get.mockResolvedValue({ rows, total: 7, pageSize: 25 });
    await loadAllTransactions(
      '/sales-desk/sales',
      { status: 'all' },
      new AbortController().signal,
      null,
    );
    expect(api.get.mock.calls[0][1].query).toEqual({ status: 'all', page: 1 });
  });
  it('rejects duplicate pages and aborted loads', async () => {
    api.get.mockResolvedValue({ data: rows, totalPages: 2 });
    await expect(
      loadAllTransactions('/invoices', {}, new AbortController().signal),
    ).rejects.toThrow('register changed');
    const controller = new AbortController();
    controller.abort();
    await expect(loadAllTransactions('/invoices', {}, controller.signal)).rejects.toThrow();
  });
  it.each([
    {
      title: 'Recorded expense accounts',
      showSettlement: false,
      showAging: true,
      absent: ['Paid / settled', 'Outstanding', 'Overdue', 'Next due'],
    },
    {
      title: 'Purchase order accounts',
      showSettlement: true,
      showAging: false,
      absent: ['Overdue', 'Next due'],
    },
  ])(
    'shows only meaningful financial columns for $title',
    async ({ title, showSettlement, showAging, absent }) => {
      api.get.mockResolvedValue(rows);
      render(
        <PartyTransactionRegister
          endpoint="/documents"
          query={{}}
          title={title}
          showSettlement={showSettlement}
          showAging={showAging}
          snapshot={businessTransactionSnapshot}
          documentName={(record: (typeof rows)[number]) => record.id}
          documentDate={(record) => record.date}
          documentStatus={(record) => record.status}
        />,
      );
      await screen.findByRole('button', { name: 'View transactions for Creditor A' });
      expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
      for (const name of absent)
        expect(screen.queryByRole('columnheader', { name })).not.toBeInTheDocument();
    },
  );
  it('discards a late response after the account scope changes', async () => {
    let resolveOld!: (value: typeof rows) => void;
    api.get.mockImplementation((_endpoint, { query }) =>
      query.companyId === 'old'
        ? new Promise<typeof rows>((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(rows.map((row) => ({ ...row, supplierName: 'Current creditor' }))),
    );
    const props = {
      endpoint: '/invoices',
      title: 'Creditor accounts',
      snapshot: businessTransactionSnapshot,
      documentName: (record: (typeof rows)[number]) => record.id,
      documentDate: (record: (typeof rows)[number]) => record.date,
      documentStatus: (record: (typeof rows)[number]) => record.status,
    };
    const { rerender } = render(
      <PartyTransactionRegister {...props} query={{ companyId: 'old' }} />,
    );
    rerender(<PartyTransactionRegister {...props} query={{ companyId: 'new' }} />);
    await screen.findByRole('button', { name: 'View transactions for Current creditor' });
    resolveOld(rows);
    await Promise.resolve();
    expect(
      screen.queryByRole('button', { name: 'View transactions for Creditor A' }),
    ).not.toBeInTheDocument();
  });
});
