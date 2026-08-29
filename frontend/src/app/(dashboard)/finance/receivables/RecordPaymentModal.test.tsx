import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordPaymentModal, Receivable } from './page';

/**
 * Receivables record-payment modal regressions (mirror of the payables modal).
 *
 * - Cash-account fetch failure must be SURFACED (warning + retry), not
 *   swallowed into an empty list that permanently blocks payment; the backend
 *   accepts an omitted cashAccountId (falls back to cash on hand).
 * - The account options are filtered to the receivable's currency and the
 *   label carries the currency — the backend rejects cross-currency picks
 *   because the running-balance cache is denominated in the account's own
 *   currency.
 */

const RECEIVABLE_USD: Receivable = {
  id: 'rec-1',
  receivableNumber: 'REC-2026-000001',
  customerName: 'Kilima Traders',
  amount: 1500,
  outstandingAmount: 900,
  currency: 'USD',
  issueDate: '2026-08-01',
  dueDate: '2026-09-01',
  status: 'OPEN',
  companyId: 'co-1',
  createdAt: new Date().toISOString(),
};

const CASH_ACCOUNTS = {
  success: true,
  data: [
    {
      id: 'ca-tzs',
      accountName: 'Petty Cash',
      accountType: 'CASH',
      currency: 'TZS',
      isActive: true,
    },
    { id: 'ca-usd', accountName: 'USD Bank', accountType: 'BANK', currency: 'USD', isActive: true },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(handler: (url: string, init?: RequestInit) => any) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    return { ok: true, status: 200, json: async () => result, ...(result?.__override ?? {}) };
  });
  globalThis.fetch = fetchMock as any;
}

beforeEach(() => {
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)) as any;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as any;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Receivables RecordPaymentModal — cash-account handling', () => {
  it('filters the options to the receivable currency and shows the currency in the label', async () => {
    mockFetch((url) => {
      if (url.includes('/cash-accounts/company/')) return CASH_ACCOUNTS;
      return {};
    });

    render(<RecordPaymentModal receivable={RECEIVABLE_USD} onClose={() => {}} onDone={() => {}} />);

    await screen.findByRole('option', { name: 'USD Bank · BANK · USD' });
    expect(screen.queryByRole('option', { name: /Petty Cash/ })).not.toBeInTheDocument();

    // With matching options present, a selection is still required.
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(
      await screen.findByText('Select the cash / bank account the money landed in'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/record-payment'))).toBe(false);
  });

  it('surfaces a cash-account fetch failure, offers retry, and still allows payment without an account', async () => {
    let failAccounts = true;
    mockFetch((url) => {
      if (url.includes('/cash-accounts/company/')) {
        if (failAccounts) return { __override: { ok: false, status: 500 }, message: 'boom' };
        return CASH_ACCOUNTS;
      }
      return { success: true, data: {} };
    });
    const onDone = vi.fn();

    render(<RecordPaymentModal receivable={RECEIVABLE_USD} onClose={() => {}} onDone={onDone} />);

    expect(await screen.findByText(/Couldn't load the cash \/ bank accounts/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/receivables/rec-1/record-payment' &&
          (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.amount).toBe(100);
      expect(body).not.toHaveProperty('cashAccountId');
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    // Retry recovers the list and clears the warning.
    failAccounts = false;
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByRole('option', { name: 'USD Bank · BANK · USD' });
    expect(screen.queryByText(/Couldn't load the cash \/ bank accounts/)).not.toBeInTheDocument();
  });
});
