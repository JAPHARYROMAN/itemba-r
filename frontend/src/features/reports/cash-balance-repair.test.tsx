import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CashBalanceRepair } from './cash-balance-repair';
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendGet: mock.get, backendPost: mock.post }));
const review = {
  currency: 'TZS',
  deskBalance: '79518000.00',
  erpBalance: '148293000.00',
  delta: '-68775000.00',
  fingerprint: 'a'.repeat(64),
  canApply: true,
  rows: [
    {
      id: 'entry',
      movementId: 'movement',
      businessDate: '2026-10-06',
      amount: '-40875000.00',
      description: 'Marine boards',
    },
    {
      id: 'entry2',
      movementId: 'movement2',
      businessDate: '2026-10-06',
      amount: '-27900000.00',
      description: 'Wall putty',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockResolvedValue(review);
  mock.post.mockResolvedValue({ applied: 2 });
});
it('shows the existing expenses and requires verification before applying their exact reviewed fingerprint', async () => {
  const saved = vi.fn();
  render(
    <CashBalanceRepair id="desk" name="MAIN CASH ACCOUNT" onClose={vi.fn()} onSaved={saved} />,
  );
  await screen.findByText(/Marine boards/);
  expect(screen.getByText(/Wall putty/)).toBeInTheDocument();
  const save = screen.getByRole('button', { name: 'Apply missing deductions' });
  expect(save).toBeDisabled();
  expect(mock.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(save);
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(mock.post).toHaveBeenCalledWith('/cash-connections/accounts/desk/balance-repair', {
    fingerprint: review.fingerprint,
  });
});
it('keeps a difference that is not explained by the entries blocked', async () => {
  mock.get.mockResolvedValue({ ...review, canApply: false });
  render(
    <CashBalanceRepair id="desk" name="MAIN CASH ACCOUNT" onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  await screen.findByText(/do not explain the balance difference/);
  expect(screen.getByRole('button', { name: 'Apply missing deductions' })).toBeDisabled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(mock.post).not.toHaveBeenCalled();
});
