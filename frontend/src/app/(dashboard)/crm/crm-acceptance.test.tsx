import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CrmDashboard from '@/app/(dashboard)/crm/page';
import CreditProfiles from '@/app/(dashboard)/crm/credit-profiles/page';
import SupplierPerformance from '@/app/(dashboard)/crm/supplier-performance/page';
import CustomerStatements from '@/app/(dashboard)/crm/customer-statements/page';
import SupplierStatements from '@/app/(dashboard)/crm/supplier-statements/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
  page: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
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
  backendPage: (...args: unknown[]) => state.page(...args),
  backendList: (...args: unknown[]) => state.list(...args),
  backendGet: (...args: unknown[]) => state.get(...args),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  state.page.mockReset();
  state.list.mockReset();
  state.get.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('CRM route gates', () => {
  it('does not read the dashboard without crm.dashboard', () => {
    render(<CrmDashboard />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read credit profiles without credit_profiles.list', () => {
    render(<CreditProfiles />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read supplier performance without supplier_performance.list', () => {
    render(<SupplierPerformance />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read supplier statements without supplier_statements.list', () => {
    render(<SupplierStatements />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read customer statements without list or view permission', () => {
    render(<CustomerStatements />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(state.list).not.toHaveBeenCalled();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('retries a failed CRM dashboard load', async () => {
    state.permissions = new Set(['crm.dashboard']);
    state.fetch.mockRejectedValue(new Error('CRM offline'));
    const user = userEvent.setup();
    render(<CrmDashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('CRM offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(4);
  });

  it('retries a failed credit-profile load', async () => {
    state.permissions = new Set(['credit_profiles.list']);
    state.fetch.mockRejectedValue(new Error('Profiles offline'));
    const user = userEvent.setup();
    render(<CreditProfiles />);
    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.getByText('Profiles offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    const profileReads = state.fetch.mock.calls.filter((call) =>
      String(call[0]).includes('/api/backend/customer-credit-profiles'),
    );
    expect(profileReads).toHaveLength(2);
  });
});
