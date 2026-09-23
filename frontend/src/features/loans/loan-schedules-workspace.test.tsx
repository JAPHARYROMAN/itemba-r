import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import LoanRepayments from '@/app/(dashboard)/accounting-engine/loan-repayments/page';

const state = vi.hoisted(() => ({ failHistory: false }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('@/components/aurora/feedback', () => ({ showToast: vi.fn() }));
beforeEach(() => {
  state.failHistory = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url, 'http://localhost').pathname;
      const error = path.endsWith('/payments') && state.failHistory;
      const data = path.endsWith('/companies')
        ? [{ id: 'co', name: 'Example company', code: 'EX' }]
        : path.endsWith('/loans')
          ? [{ id: 'loan', lenderName: 'Example bank', loanReference: 'LN-101', currency: 'TZS' }]
          : path.endsWith('/payments')
            ? []
            : path.endsWith('/loan-repayment-schedules')
              ? [
                  {
                    id: 'schedule',
                    repaymentScheduleNumber: 'LRS-101',
                    companyId: 'co',
                    loanDebtId: 'loan',
                    installmentNumber: 1,
                    dueDate: '2026-10-01',
                    principalAmount: '800',
                    interestAmount: '90',
                    feeAmount: '10',
                    totalAmount: '900',
                    outstandingAmount: '900',
                    paidAmount: '0',
                    status: 'UPCOMING',
                  },
                ]
              : [];
      return {
        ok: !error,
        status: error ? 503 : 200,
        json: async () =>
          error ? { message: 'Payment history unavailable' } : { success: true, data },
      };
    }),
  );
});
function capture(name: string) {
  const dir = process.env.ITEMBA_OS_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), document.body.innerHTML);
}
describe('Accounting installment workspace', () => {
  it('opens the installment inspector from a keyboard row and retains all payment components', async () => {
    render(<LoanRepayments />);
    const reference = await screen.findByText(/LRS-101 · #1/);
    capture('schedule-list');
    const row = reference.closest('tr')!;
    row.focus();
    await userEvent.keyboard('{Enter}');
    const inspector = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(inspector).getByRole('heading', { name: 'Record details' })).toHaveFocus();
    expect(await within(inspector).findByText(/No payments recorded/)).toBeVisible();
    expect(within(inspector).getByText('TZS 800.00')).toBeVisible();
    capture('schedule-details');
    expect(within(inspector).getByRole('button', { name: 'Record Payment' })).toBeVisible();
  });
  it('distinguishes an unavailable payment history from an empty one and retries', async () => {
    state.failHistory = true;
    render(<LoanRepayments />);
    await userEvent.click((await screen.findByText(/LRS-101 · #1/)).closest('tr')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment history unavailable');
    expect(screen.queryByText(/No payments recorded/)).not.toBeInTheDocument();
    state.failHistory = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No payments recorded/)).toBeVisible();
  });
  it('keeps schedule validation inside its dialog', async () => {
    render(<LoanRepayments />);
    await screen.findByText(/LRS-101 · #1/);
    await userEvent.click(screen.getByRole('button', { name: 'Generate schedule' }));
    const dialog = screen.getByRole('dialog', { name: 'Generate Loan Repayment Schedule' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate', exact: true }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select a loan');
  });
});
