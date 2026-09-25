import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoanRepaymentsPage from './page';

const fixture = vi.hoisted(() => ({
  outstanding: '207.06',
  requests: [] as Array<Record<string, string>>,
  failures: 0,
  reload: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true, loading: false }),
}));
vi.mock('@/hooks/use-workspace-resource', () => ({
  useWorkspaceResource: (path: string, query: { amount?: string }) => ({
    loading: false,
    error: '',
    reload: fixture.reload,
    data: path.includes('accounting-options')
      ? {
          cash: [{ id: 'cash', name: 'Test bank', currency: 'TZS' }],
          ledger: [],
        }
      : path.includes('payment-preview')
        ? {
            amount: query.amount,
            principal: query.amount,
            interest: '0',
            fees: '0',
            currency: 'TZS',
            allocationFingerprint: `review-${query.amount}`,
          }
        : [],
  }),
}));

beforeEach(() => {
  fixture.outstanding = '207.06';
  fixture.requests = [];
  fixture.failures = 0;
  fixture.reload.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        fixture.requests.push(body);
        if (fixture.failures-- > 0) throw new Error('Connection interrupted');
        fixture.outstanding = (Number(fixture.outstanding) - Number(body.amount)).toFixed(2);
        return { ok: true, json: async () => ({ data: { id: 'payment' } }) };
      }
      const data = url.includes('/loan-repayment-schedules?')
        ? [
            {
              id: 'schedule',
              companyId: 'company',
              loanDebtId: 'loan',
              repaymentScheduleNumber: 'LRS-1',
              installmentNumber: 1,
              dueDate: '2026-10-25',
              principalAmount: '207.06',
              interestAmount: '0',
              feeAmount: '0',
              totalAmount: '207.06',
              outstandingAmount: fixture.outstanding,
              paidAmount: (207.06 - Number(fixture.outstanding)).toFixed(2),
              status: 'UPCOMING',
            },
          ]
        : url.includes('/loans?')
          ? [{ id: 'loan', companyId: 'company', lenderName: 'Test lender', currency: 'TZS' }]
          : url.includes('/companies?')
            ? [{ id: 'company', name: 'Test company' }]
            : [];
      return { ok: true, json: async () => ({ data }) };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openFirstPayment() {
  render(<LoanRepaymentsPage />);
  const row = await screen.findByText(/LRS-1/);
  fireEvent.click(row.closest('tr')!);
  fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
  return screen.getByRole('dialog', { name: 'Record Loan Repayment' });
}

function reviewAndPay(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText(/Pay from Cash Desk account/), {
    target: { value: 'cash' },
  });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /I have reviewed/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record Payment' }));
}

describe('Scheduled payment transaction identity', () => {
  it('uses a fresh request for a second payment on the same installment after acknowledged success', async () => {
    const first = await openFirstPayment();
    fireEvent.change(within(first).getByLabelText(/^Amount/), { target: { value: '100' } });
    fireEvent.change(within(first).getByLabelText('Reference'), { target: { value: 'FIRST' } });
    reviewAndPay(first);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('TZS 100.00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
    const second = screen.getByRole('dialog', { name: 'Record Loan Repayment' });
    expect(within(second).getByLabelText(/^Amount/)).toHaveValue(107.06);
    expect(within(second).getByLabelText('Reference')).toHaveValue('');
    expect(within(second).getByRole('checkbox', { name: /I have reviewed/ })).not.toBeChecked();
    reviewAndPay(second);
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.requests[1].requestId).not.toBe(fixture.requests[0].requestId);
    expect(fixture.requests.map((r) => r.amount)).toEqual(['100', '107.06']);
  });

  it('preserves the request reference and inputs when an uncertain payment is reopened and retried', async () => {
    fixture.failures = 1;
    const first = await openFirstPayment();
    fireEvent.change(within(first).getByLabelText(/^Amount/), { target: { value: '100' } });
    fireEvent.change(within(first).getByLabelText('Reference'), { target: { value: 'UNCERTAIN' } });
    reviewAndPay(first);
    await waitFor(() =>
      expect(within(first).getByText('Connection interrupted')).toBeInTheDocument(),
    );
    fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
    const retry = screen.getByRole('dialog', { name: 'Record Loan Repayment' });
    expect(within(retry).getByLabelText(/^Amount/)).toHaveValue(100);
    expect(within(retry).getByLabelText('Reference')).toHaveValue('UNCERTAIN');
    expect(within(retry).getByRole('checkbox', { name: /I have reviewed/ })).not.toBeChecked();
    reviewAndPay(retry);
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.requests[1]).toEqual(fixture.requests[0]);
  });

  it('does not lose an uncertain transaction identity when its installment is selected again', async () => {
    fixture.failures = 1;
    const first = await openFirstPayment();
    reviewAndPay(first);
    await waitFor(() =>
      expect(within(first).getByText('Connection interrupted')).toBeInTheDocument(),
    );
    fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    fireEvent.click(screen.getByText(/LRS-1/).closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
    reviewAndPay(screen.getByRole('dialog', { name: 'Record Loan Repayment' }));
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.requests[1]).toEqual(fixture.requests[0]);
  });
});
