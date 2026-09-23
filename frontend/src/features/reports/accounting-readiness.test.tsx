import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountingReadiness } from './accounting-readiness';
const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), canPost: true }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      permission === 'sales_desk.view' ||
      permission === 'journal_entries.view' ||
      (mocks.canPost && ['journal_entries.create', 'journal_entries.post'].includes(permission)),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendPost: mocks.post, backendGet: mocks.get }));
vi.mock('./analysis-filters', () => ({
  useAnalysisFilters: () => ({ filters: {}, query: {}, apply: vi.fn(), tab: 'sales' }),
  AnalysisFilterForm: () => null,
}));
function resource(path: string) {
  return {
    loading: false,
    error: '',
    reload: vi.fn(),
    data: path.endsWith('/s1')
      ? {
          source: {
            id: 's1',
            reference: 'INV-01',
            date: '2026-09-18',
            amount: '100.00',
            currency: 'TZS',
          },
          fingerprint: 'review-token',
          status: 'Unposted',
          blocked: null,
          journals: [],
          accounts: [
            { id: 'ar', accountCode: '1100', accountName: 'Receivables', accountType: 'ASSET' },
            { id: 'income', accountCode: '4000', accountName: 'Sales', accountType: 'INCOME' },
          ],
        }
      : path.includes('directory')
        ? { companies: [], divisions: [], branches: [] }
        : [
            {
              id: 's1',
              kind: 'sales',
              reference: 'INV-01',
              date: '2026-09-18',
              amount: '100.00',
              currency: 'TZS',
              status: 'Unposted',
              fingerprint: 'list-token',
              journalId: null,
            },
          ],
  };
}
vi.mock('@/hooks/use-workspace-resource', () => ({ useWorkspaceResource: resource }));

describe('Accounting review workflow', () => {
  beforeEach(() => {
    mocks.canPost = true;
    mocks.post.mockReset();
    mocks.get.mockReset().mockImplementation(async (path: string) => resource(path).data);
  });
  it('requires account review and acknowledgement, then posts the fresh review fingerprint', async () => {
    mocks.post.mockResolvedValue({ journalNumber: 'JE-1' });
    render(<AccountingReadiness />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog');
    const submit = screen.getByRole('button', { name: 'Post balanced journal' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Debit · Customer receivables'), {
      target: { value: 'ar' },
    });
    fireEvent.change(screen.getByLabelText('Credit · Sales income'), {
      target: { value: 'income' },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/desk-posting/sales/s1', {
        fingerprint: 'review-token',
        debitAccountId: 'ar',
        creditAccountId: 'income',
      }),
    );
    expect(await screen.findByText(/Posted JE-1/)).toBeInTheDocument();
  });
  it('keeps posting disabled for reviewers without posting permissions', async () => {
    mocks.canPost = false;
    render(<AccountingReadiness />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Post balanced journal' })).toBeDisabled();
    expect(screen.getByText('Your role can review but cannot post journals.')).toBeInTheDocument();
  });
});
