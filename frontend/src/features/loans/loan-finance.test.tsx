import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LoanFundingFields,
  LoanPaymentModal,
  LoanFinancialHistory,
  emptyFunding,
} from './loan-finance';
const state = vi.hoisted(() => ({ post: vi.fn(), canReverse: true }));
vi.mock('@/lib/api-client', () => ({ backendPost: state.post }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => p !== 'journal_entries.reverse' || state.canReverse,
  }),
}));
vi.mock('@/hooks/use-workspace-resource', () => ({
  useWorkspaceResource: (path: string) => ({
    loading: false,
    error: '',
    reload: vi.fn(),
    data: path.includes('accounting-options')
      ? {
          cash: [
            { id: 'cash', name: 'Connected bank', currency: 'TZS' },
            { id: 'usd', name: 'USD account', currency: 'USD' },
          ],
          ledger: [
            {
              id: 'liability',
              accountCode: '2100',
              accountName: 'Loan payable',
              accountType: 'LIABILITY',
            },
            {
              id: 'expense',
              accountCode: '6000',
              accountName: 'Loan interest',
              accountType: 'EXPENSE',
            },
            {
              id: 'equity',
              accountCode: '3000',
              accountName: 'Opening equity',
              accountType: 'EQUITY',
            },
          ],
        }
      : {
          loan: { currency: 'TZS', outstandingBalance: '100' },
          expectedPrincipal: '100',
          agrees: true,
          issues: [],
          schedules: [],
          events: [
            {
              id: 'event',
              kind: 'OPENING',
              businessDate: '2026-01-01',
              amount: '100',
              principal: '100',
              interest: '0',
              fees: '0',
              penalties: '0',
              journalEntry: { id: 'journal', journalNumber: 'JE-1', status: 'POSTED' },
            },
          ],
        },
  }),
}));
beforeEach(() => {
  state.post.mockReset();
  state.canReverse = true;
});
describe('Connected loan forms', () => {
  it('separates opening recognition from receiving cash', () => {
    render(
      <LoanFundingFields
        companyId="co"
        currency="TZS"
        value={{ ...emptyFunding, fundingMode: 'OPENING' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/No cash is received/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Receive into/)).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Opening equity/ })).toBeInTheDocument();
  });
  it('only offers cash in the loan currency', () => {
    render(
      <LoanFundingFields companyId="co" currency="TZS" value={emptyFunding} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('option', { name: 'Connected bank' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'USD account' })).not.toBeInTheDocument();
  });
  it('sends selected accounts and preserves the request reference after an uncertain error', async () => {
    state.post.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({});
    const close = vi.fn();
    render(
      <LoanPaymentModal
        loan={{ id: 'loan', company: { id: 'co' }, currency: 'TZS', outstandingBalance: '100' }}
        onClose={close}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Total paid/), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/^Interest$/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Pay from Cash Desk/), { target: { value: 'cash' } });
    fireEvent.change(screen.getByLabelText('Interest expense account'), {
      target: { value: 'expense' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByText('Connection interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    const first = state.post.mock.calls[0][1],
      second = state.post.mock.calls[1][1];
    expect(first).toMatchObject({
      amount: '15',
      interest: '5',
      cashDeskAccountId: 'cash',
      interestAccountId: 'expense',
      currency: 'TZS',
    });
    expect(first.requestId).toBe(second.requestId);
  });
  it('shows reconciliation and respects reversal permission', () => {
    state.canReverse = false;
    render(<LoanFinancialHistory loanId="loan" onChanged={vi.fn()} />);
    expect(screen.getByText(/Linked records agree/)).toBeInTheDocument();
    expect(screen.getByText('No cash movement')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });
});
