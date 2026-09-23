import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CashAccounting } from './cash-accounting';
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  canPost: true,
  issues: [] as string[],
  transfer: false,
  linked: false,
  canConnect: true,
  legacyPayload: false,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (p: string) =>
      !['journal_entries.create', 'journal_entries.post'].includes(p) || mocks.canPost,
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendPost: mocks.post, backendGet: mocks.get }));
vi.mock('./analysis-filters', () => ({
  useAnalysisFilters: () => ({ filters: {}, query: {}, apply: vi.fn() }),
  AnalysisFilterForm: () => null,
}));
function resource(path: string) {
  return {
    loading: false,
    error: '',
    reload: vi.fn(),
    data: path.includes('directory')
      ? { companies: [], divisions: [], branches: [] }
      : path.endsWith('/accounts')
        ? {
            desk: [],
            bank: [
              {
                id: 'bank-cash-legacy',
                companyId: 'c1',
                divisionId: null,
                branchId: null,
                accountName: 'Main Cash',
                currency: 'TZS',
                canConnect: mocks.legacyPayload ? undefined : mocks.canConnect,
                recordedBalance: mocks.legacyPayload ? undefined : '0.00',
                ledgerBalance: null,
                balanceDifference: null,
                ledgerAccountId: null,
                ledgerAccount: null,
              },
            ],
            ledger: [
              {
                id: 'legacy-ledger',
                companyId: 'c1',
                divisionId: null,
                branchId: null,
                accountCode: '1000',
                accountName: 'Cash on Hand',
                accountType: 'ASSET',
                ledgerBalance: '1000.00',
              },
            ],
          }
        : path.endsWith('/m1')
          ? {
              source: {
                id: 'm1',
                kind: mocks.transfer ? 'TRANSFER' : 'SUPPLIER_PAYMENT',
                date: '2026-09-19',
                amount: '100.00',
                currency: 'TZS',
                description: 'Supplier payment',
              },
              fingerprint: 'fresh-token',
              issues: mocks.issues,
              offsetId: mocks.transfer ? null : 'payable',
              accounts: [{ id: 'payable', accountCode: '2001', accountName: 'Supplier payables' }],
              journals: mocks.linked ? [{ id: 'j1', number: 'JE-1', status: 'POSTED' }] : [],
              cashAccounts: mocks.transfer
                ? [
                    { id: 'bank', name: 'Bank', amount: '-100.00' },
                    { id: 'till', name: 'Till', amount: '100.00' },
                  ]
                : [{ id: 'bank', name: 'Bank', amount: '-100.00' }],
            }
          : path.endsWith('/movements')
            ? [
                {
                  id: 'm1',
                  kind: 'SUPPLIER_PAYMENT',
                  date: '2026-09-19',
                  description: 'Supplier payment',
                  reference: 'REF1',
                  amount: '100.00',
                  currency: 'TZS',
                  status: 'Unposted',
                  entries: [{ name: 'Bank', amount: '-100.00' }],
                },
              ]
            : [],
  };
}
vi.mock('@/hooks/use-workspace-resource', () => ({ useWorkspaceResource: resource }));

describe('Cash accounting review', () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.get.mockReset().mockImplementation(async (path: string) => resource(path).data);
    mocks.canPost = true;
    mocks.issues = [];
    mocks.transfer = false;
    mocks.linked = false;
    mocks.canConnect = true;
    mocks.legacyPayload = false;
  });
  it('keeps cached older responses reviewable without assuming missing balances or write access', async () => {
    mocks.legacyPayload = true;
    render(<CashAccounting connections />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review Main Cash' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('combobox', { name: 'Dedicated asset ledger account' }), {
      target: { value: 'legacy-ledger' },
    });
    expect(
      screen.getByText('Reload account connections to compare the recorded balance.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save connection' })).not.toBeInTheDocument();
  });
  it('lets company read-only users inspect balances without offering a save action', async () => {
    mocks.canConnect = false;
    render(<CashAccounting connections />);
    expect(screen.queryByRole('button', { name: 'Map Main Cash' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review Main Cash' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('combobox', { name: 'Dedicated asset ledger account' }), {
      target: { value: 'legacy-ledger' },
    });
    expect(screen.getByText(/The balances differ/)).toBeInTheDocument();
    expect(screen.getByText(/Review only. Saving requires/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save connection' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('reviews candidate ledger balances and preserves legacy identifiers when saving', async () => {
    mocks.post.mockResolvedValue({});
    render(<CashAccounting connections />);
    fireEvent.click(screen.getByRole('button', { name: 'Map Main Cash' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByRole('combobox', { name: 'Dedicated asset ledger account' }), {
      target: { value: 'legacy-ledger' },
    });
    expect(screen.getByText(/The balances differ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/cash-connections/accounts', {
        deskAccountId: undefined,
        cashAccountId: 'bank-cash-legacy',
        ledgerAccountId: 'legacy-ledger',
      }),
    );
  });
  it('uses the linked payable account and requires explicit duplicate review', async () => {
    mocks.post.mockResolvedValue({ journalNumber: 'JE-CASH-1' });
    render(<CashAccounting connections={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Invoice control account')).toBeDisabled();
    const submit = screen.getByRole('button', { name: 'Post cash movement' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/cash-connections/movements/m1', {
        fingerprint: 'fresh-token',
        offsetAccountId: 'payable',
      }),
    );
    expect(await screen.findByText(/Posted JE-CASH-1/)).toBeInTheDocument();
  });
  it('posts transfers without asking for a revenue or expense account', async () => {
    mocks.transfer = true;
    mocks.post.mockResolvedValue({ journalNumber: 'JE-T1' });
    render(<CashAccounting connections={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog');
    expect(screen.queryByLabelText('Offset account')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Post cash movement' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/cash-connections/movements/m1', {
        fingerprint: 'fresh-token',
      }),
    );
  });
  it('blocks posting when a connection is missing or the role is read-only', async () => {
    mocks.issues = ['Connect the paying bank account first.'];
    mocks.canPost = false;
    render(<CashAccounting connections={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('Connect the paying bank account first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post cash movement' })).toBeDisabled();
  });
  it('shows the existing journal instead of a second posting action', async () => {
    mocks.linked = true;
    render(<CashAccounting connections={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('dialog');
    expect(screen.getByText('Journal JE-1 · POSTED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post cash movement' })).not.toBeInTheDocument();
  });
});
