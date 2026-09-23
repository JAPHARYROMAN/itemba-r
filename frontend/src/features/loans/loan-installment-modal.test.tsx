import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoanInstallmentModal } from './loan-installment-modal';
import { setDateField } from '@/test/date-field';
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendPost: api.post }));
it('records contractual fees and lets the server derive installment totals', async () => {
  api.post.mockResolvedValue({});
  const saved = vi.fn();
  render(
    <LoanInstallmentModal
      loans={[{ id: 'loan', lenderName: 'Bank', currency: 'TZS' }]}
      onClose={vi.fn()}
      onSaved={saved}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^Loan/), { target: { value: 'loan' } });
  await setDateField(/Due date/, '2026-12-01');
  fireEvent.change(screen.getByLabelText(/Principal/), { target: { value: '100.01' } });
  fireEvent.change(screen.getByLabelText(/Interest/), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText(/Fees/), { target: { value: '2.01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add installment' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(api.post.mock.calls[0][1]).toMatchObject({
    principalAmount: '100.01',
    interestAmount: '8',
    feeAmount: '2.01',
    installmentNumber: 1,
  });
  expect(api.post.mock.calls[0][1]).not.toHaveProperty('paidAmount');
});
