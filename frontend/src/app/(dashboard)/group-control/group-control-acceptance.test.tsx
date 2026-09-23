import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GroupControl from '@/app/(dashboard)/group-control/page';
import BankAccounts from '@/app/(dashboard)/group-control/bank-accounts/page';
import Contracts from '@/app/(dashboard)/group-control/contracts/page';
import ContractDetail from '@/app/(dashboard)/group-control/contracts/[id]/page';
import Documents from '@/app/(dashboard)/group-control/documents/page';
import DocumentDetail from '@/app/(dashboard)/group-control/documents/[id]/page';
import FixedAssets from '@/app/(dashboard)/group-control/fixed-assets/page';
import FixedAssetDetail from '@/app/(dashboard)/group-control/fixed-assets/[id]/page';
import LoansDebts from '@/app/(dashboard)/group-control/loans-debts/page';
import LoanDetail from '@/app/(dashboard)/group-control/loans-debts/loans/[id]/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
  backendGet: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendGet: state.backendGet,
  backendPage: vi.fn(),
  backendList: vi.fn(),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'record-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  useWorkspacePathname: () => '/group-control/documents/record-1',
  useWorkspaceRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const restricted = [
  ['overview', GroupControl],
  ['bank accounts', BankAccounts],
  ['contracts', Contracts],
  ['contract detail', ContractDetail],
  ['documents', Documents],
  ['document detail', DocumentDetail],
  ['fixed assets', FixedAssets],
  ['fixed asset detail', FixedAssetDetail],
  ['loan detail', LoanDetail],
] as const;

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  state.backendGet.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('group control route gates', () => {
  it.each(restricted)('does not read %s without its view permission', (_name, Page) => {
    render(<Page />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it('does not read loans and debts without loans.read or debts.read', () => {
    render(<LoansDebts />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it('retries a failed bank-account load', async () => {
    state.permissions = new Set(['bank-accounts.read']);
    state.fetch.mockRejectedValue(new Error('Banks offline'));
    const user = userEvent.setup();
    render(<BankAccounts />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const listCalls = () =>
      state.fetch.mock.calls.filter((call) => String(call[0]).includes('/api/backend/bank-accounts?'));
    expect(listCalls()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(listCalls()).toHaveLength(2);
  });
});
