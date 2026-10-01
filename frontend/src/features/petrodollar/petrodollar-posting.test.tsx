import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { Report } from '@/components/fuel-reporting/types';
import { PetroDollarPosting } from './petrodollar-posting';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), allowed: true }));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  backendGet: state.get,
  backendPost: state.post,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ hasPermission: () => state.allowed }) }));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  WorkspaceLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const report = {
  id: 'shift',
  version: 2,
  businessDate: '2026-10-01',
  status: 'CLOSED',
  payload: { collections: { cash: 100 }, creditSales: [], deliveries: [], expenses: [] },
  summary: { collected: 100, cashOut: 0 },
} as unknown as Report;
const posted = {
  id: 'posting',
  reversedAt: null,
  reportVersion: 2,
  evidence: { saleIds: ['sale'], invoiceIds: [], movementIds: ['cash'], journalIds: ['journal'] },
};
const review = {
  version: 2,
  fingerprint: 'a'.repeat(64),
  postings: [],
  customers: [{ id: 'customer', name: 'Retail customer' }],
  suppliers: [],
  accounts: [{ id: 'cash', name: 'Till', connected: true, balance: '0.00' }],
  ledger: ['ASSET', 'INCOME', 'LIABILITY', 'COST_OF_GOODS_SOLD', 'EXPENSE'].map((type, i) => ({
    id: `ledger-${i}`,
    accountType: type,
    accountCode: `${i}`,
    accountName: type,
  })),
  issues: [],
  missingPermissions: [],
  canPost: true,
};
async function openReview() {
  fireEvent.click(await screen.findByRole('button', { name: 'Review & post shift' }));
  for (const select of screen.getAllByRole('combobox')) {
    fireEvent.change(select, { target: { value: select.querySelectorAll('option')[1].value } });
  }
}
describe('PetroDollar posting review', () => {
  beforeEach(() => {
    state.get.mockReset();
    state.post.mockReset();
    state.allowed = true;
    state.get.mockResolvedValue(review);
  });
  it('requires review access before requesting financial choices', () => {
    state.allowed = false;
    render(<PetroDollarPosting report={report} onLock={vi.fn()} />);
    expect(state.get).not.toHaveBeenCalled();
    expect(screen.getByText(/user with sales, cash/)).toBeInTheDocument();
  });
  it('explains reconciliation blockers and disables posting', async () => {
    state.get.mockResolvedValue({ ...review, issues: ['Opening stock differs from Inventory.'] });
    render(<PetroDollarPosting report={report} onLock={vi.fn()} />);
    expect(await screen.findByText('Opening stock differs from Inventory.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review & post shift' })).toBeDisabled();
  });
  it('checks an uncertain outcome before retrying the identical request', async () => {
    const lock = vi.fn();
    state.post
      .mockRejectedValueOnce(new TypeError('Network interrupted'))
      .mockResolvedValueOnce(posted);
    render(<PetroDollarPosting report={report} onLock={lock} />);
    await openReview();
    fireEvent.submit(screen.getByRole('button', { name: 'Post shift to apps' }).closest('form')!);
    await screen.findByText('Network interrupted');
    const original = state.post.mock.calls[0][1];
    expect(original.requestId).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry same posting' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Walk-in / retail customer' })).toBeDisabled();
    expect(lock).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry same posting' })).toBeEnabled(),
    );
    state.get.mockResolvedValue({ ...review, postings: [posted] });
    fireEvent.submit(screen.getByRole('button', { name: 'Retry same posting' }).closest('form')!);
    await screen.findByText('Connected to your apps');
    expect(state.post.mock.calls[1][1]).toEqual(original);
    expect(lock).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('link', { name: /Sales ·/ })).toHaveAttribute(
      'href',
      '/sales-desk?source=direct&view=sales',
    );
  });
  it('recovers an acknowledged posting through status without submitting twice', async () => {
    state.post.mockRejectedValueOnce(new ApiError('Upstream timed out', 504, {}));
    render(<PetroDollarPosting report={report} onLock={vi.fn()} />);
    await openReview();
    fireEvent.submit(screen.getByRole('button', { name: 'Post shift to apps' }).closest('form')!);
    await screen.findByText('Upstream timed out');
    state.get.mockResolvedValue({ ...review, postings: [posted] });
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await screen.findByText('Connected to your apps');
    expect(state.post).toHaveBeenCalledTimes(1);
  });
  it('cancels an unsubmitted review and releases its navigation warning', async () => {
    const lock = vi.fn();
    render(<PetroDollarPosting report={report} onLock={lock} />);
    await openReview();
    expect(lock).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }));
    await waitFor(() => expect(lock).toHaveBeenLastCalledWith(false));
    expect(state.post).not.toHaveBeenCalled();
  });
});
