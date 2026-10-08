import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSalesConnection,
  outstandingAccounts,
  receiptAccounts,
} from './cash-sales-consolidation';
import type { OutstandingSale, SalesConnection } from './cash-sales-connection';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ backendGet: get }));
const sale = (id: string, changes: Partial<OutstandingSale> = {}): OutstandingSale => ({
  id,
  companyId: 'company',
  company: { name: 'Company' },
  divisionId: null,
  branchId: null,
  customerId: 'kamendu',
  customerName: 'KAMENDU HARDWARE',
  receivableNumber: `REC-${id}`,
  salesOrderNumber: `SO-${id}`,
  saleId: `sale-${id}`,
  currency: 'TZS',
  amount: '10.10',
  outstandingAmount: '10.00',
  paidAmount: '0.10',
  dueDate: null,
  branch: null,
  ...changes,
});
const receipt = (
  id: string,
  changes: Partial<SalesConnection['receipts']['rows'][number]> = {},
) => ({
  id,
  companyId: 'company',
  customerId: 'kamendu',
  customer: 'KAMENDU HARDWARE',
  date: '2026-10-08',
  reference: `PAY-${id}`,
  amount: '0.10',
  currency: 'TZS',
  account: 'Till',
  saleId: null,
  kind: 'Customer payment',
  ...changes,
});
const projection = (
  page: number,
  rows: OutstandingSale[],
  receipts = [receipt(String(page))],
): SalesConnection => ({
  date: '2026-10-08',
  page,
  pageSize: 2,
  accountsVisible: true,
  receiptsVisible: true,
  accounts: [],
  currencies: [],
  outstanding: { rows, total: 3 },
  receipts: { rows: receipts, total: 3 },
});
beforeEach(() => get.mockReset());

describe('Complete Cash Desk collection accounts', () => {
  it('reads every nested page before summing an account and retains scope and date', async () => {
    get
      .mockResolvedValueOnce(projection(1, [sale('1'), sale('2')], [receipt('1'), receipt('2')]))
      .mockResolvedValueOnce(projection(2, [sale('3')], [receipt('3')]));
    const signal = new AbortController().signal;
    const result = await loadSalesConnection({ companyId: 'company', date: '2026-10-08' }, signal);
    expect(get).toHaveBeenLastCalledWith('/cash-desk/sales-connection', {
      query: { companyId: 'company', date: '2026-10-08', page: 2 },
      signal,
    });
    expect(outstandingAccounts(result.outstanding.rows)[0]).toMatchObject({
      documentCount: 3,
      amount: '30.30',
      paidAmount: '0.30',
      outstandingAmount: '30.00',
    });
    expect(receiptAccounts(result.receipts.rows)[0]).toMatchObject({
      documentCount: 3,
      amount: '0.30',
    });
  });
  it('continues through the longer receipt register after outstanding pages end', async () => {
    const first = projection(1, [sale('1')], [receipt('1'), receipt('2')]);
    first.outstanding.total = 1;
    const second = projection(2, [], [receipt('3')]);
    second.outstanding.total = 1;
    get.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const result = await loadSalesConnection({}, new AbortController().signal);
    expect(result.outstanding.rows).toHaveLength(1);
    expect(result.receipts.rows).toHaveLength(3);
  });
  it('rejects a later page failure instead of publishing partial totals', async () => {
    get
      .mockResolvedValueOnce(projection(1, [sale('1'), sale('2')]))
      .mockRejectedValueOnce(new Error('offline'));
    await expect(loadSalesConnection({}, new AbortController().signal)).rejects.toThrow('offline');
  });
  it.each(['duplicate', 'changed total', 'missing rows'])(
    'rejects %s pagination',
    async (condition) => {
      const second = projection(2, [sale(condition === 'duplicate' ? '1' : '3')]);
      if (condition === 'changed total') second.outstanding.total = 4;
      if (condition === 'missing rows') second.outstanding.rows = [];
      get
        .mockResolvedValueOnce(projection(1, [sale('1'), sale('2')], [receipt('1'), receipt('2')]))
        .mockResolvedValueOnce(second);
      await expect(loadSalesConnection({}, new AbortController().signal)).rejects.toThrow(
        /Refresh/,
      );
    },
  );
  it('stops requesting pages after the scope is cancelled', async () => {
    const controller = new AbortController();
    get.mockImplementationOnce(async () => {
      controller.abort();
      return projection(1, [sale('1'), sale('2')]);
    });
    await expect(loadSalesConnection({}, controller.signal)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('combines formal and unpromoted desk debt, keeping NoteBook, company, currency and identity separate', () => {
    const accounts = outstandingAccounts([
      sale('1'),
      sale('2', { source: 'SALES_DESK' }),
      sale('3', { source: 'NOTEBOOK' }),
      sale('4', { companyId: 'another' }),
      sale('5', { currency: 'USD' }),
      sale('6', { customerId: 'another' }),
      sale('7', { customerId: null }),
    ]);
    expect(accounts).toHaveLength(6);
    const formal = accounts.find((row) => row.documents.some(({ id }) => id === '1'))!;
    expect(formal).toMatchObject({ outstandingAmount: '20.00', documentCount: 2 });
    expect(accounts.find((row) => row.documents[0].source === 'NOTEBOOK')?.partyName).toContain(
      'NoteBook',
    );
  });
  it('keeps receipt totals separate by linked identity, company and currency', () => {
    const accounts = receiptAccounts([
      receipt('1'),
      receipt('2'),
      receipt('3', { companyId: 'another' }),
      receipt('4', { currency: 'USD' }),
      receipt('5', { customerId: null }),
    ]);
    expect(accounts).toHaveLength(4);
    expect(accounts.find((row) => row.documentCount === 2)?.amount).toBe('0.20');
  });
});
