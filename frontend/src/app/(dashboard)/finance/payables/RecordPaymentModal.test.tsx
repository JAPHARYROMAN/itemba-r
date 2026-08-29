import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordPaymentModal, Payable } from './page';

/**
 * Payables record-payment modal regressions.
 *
 * - Cash-account fetch failure must be SURFACED (warning + retry), not
 *   swallowed into an empty list that permanently blocks payment. The backend
 *   record-payment DTO deliberately accepts an omitted cashAccountId (falls
 *   back to cash on hand), so the client gate only applies when options exist,
 *   and the request omits cashAccountId when none was chosen.
 * - The account options are filtered to the payable's currency and the label
 *   carries the currency — the backend rejects cross-currency picks because
 *   the running-balance cache is denominated in the account's own currency.
 */

const PAYABLE_TZS: Payable = {
  id: 'pay-1',
  payableNumber: 'AP-2026-000001',
  supplierName: 'Mto Supplies',
  amount: 1000,
  outstandingAmount: 600,
  currency: 'TZS',
  issueDate: '2026-08-01',
  status: 'OPEN',
  companyId: 'co-1',
  createdAt: new Date().toISOString(),
};

const PAYABLE_USD: Payable = { ...PAYABLE_TZS, id: 'pay-2', currency: 'USD' };

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
    {
      id: 'ca-dead',
      accountName: 'Closed Till',
      accountType: 'CASH',
      currency: 'TZS',
      isActive: false,
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(handler: (url: string, init?: RequestInit) => any) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    if (result instanceof Error) throw result;
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

describe('Payables RecordPaymentModal — cash-account handling', () => {
  it('filters the options to the payable currency and shows the currency in the label', async () => {
    mockFetch((url) => {
      if (url.includes('/cash-accounts/company/')) return CASH_ACCOUNTS;
      return {};
    });

    render(<RecordPaymentModal payable={PAYABLE_USD} onClose={() => {}} onDone={() => {}} />);

    await screen.findByRole('option', { name: 'USD Bank · BANK · USD' });
    // TZS and inactive accounts are not offered against a USD payable.
    expect(screen.queryByRole('option', { name: /Petty Cash/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Closed Till/ })).not.toBeInTheDocument();
  });

  it('still requires a selection when matching accounts exist', async () => {
    mockFetch((url) => {
      if (url.includes('/cash-accounts/company/')) return CASH_ACCOUNTS;
      return {};
    });

    render(<RecordPaymentModal payable={PAYABLE_TZS} onClose={() => {}} onDone={() => {}} />);

    await screen.findByRole('option', { name: 'Petty Cash · CASH · TZS' });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(
      await screen.findByText('Select the cash / bank account the payment came from'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/record-payment'))).toBe(false);
  });

  it('surfaces a cash-account fetch failure, offers retry, and still allows payment without an account', async () => {
    let failAccounts = true;
    mockFetch((url) => {
      if (url.includes('/cash-accounts/company/')) {
        if (failAccounts) return { __override: { ok: false, status: 403 }, message: 'Forbidden' };
        return CASH_ACCOUNTS;
      }
      return { success: true, data: {} };
    });
    const onDone = vi.fn();

    render(<RecordPaymentModal payable={PAYABLE_TZS} onClose={() => {}} onDone={onDone} />);

    // The failure is visible instead of a silent empty list.
    expect(await screen.findByText(/Couldn't load the cash \/ bank accounts/)).toBeInTheDocument();

    // Payment is NOT hard-blocked: the backend accepts an omitted
    // cashAccountId and falls back to cash on hand.
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/payables/pay-1/record-payment' &&
          (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.amount).toBe(100);
      expect(body).not.toHaveProperty('cashAccountId');
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    // Retry re-runs the fetch and recovers the list.
    failAccounts = false;
    fireEvent.click(screen.getByText('Retry'));
    await screen.findByRole('option', { name: 'Petty Cash · CASH · TZS' });
    expect(screen.queryByText(/Couldn't load the cash \/ bank accounts/)).not.toBeInTheDocument();
  });

  it('explains an empty matching-currency list and lets the payment fall back to cash on hand', async () => {
    mockFetch((url) => {
      if (url.includes('/cash-accounts/company/')) {
        // Only a USD account exists; the payable is TZS.
        return { success: true, data: [CASH_ACCOUNTS.data[1]] };
      }
      return { success: true, data: {} };
    });

    render(<RecordPaymentModal payable={PAYABLE_TZS} onClose={() => {}} onDone={() => {}} />);

    expect(
      await screen.findByText(/No active TZS cash \/ bank accounts found for this company/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/backend/payables/pay-1/record-payment' &&
          (c[1] as RequestInit)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).not.toHaveProperty('cashAccountId');
    });
  });
});
