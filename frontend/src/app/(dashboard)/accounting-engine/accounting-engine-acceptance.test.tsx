import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '@/app/(dashboard)/accounting-engine/page';
import FinancialStatements from '@/app/(dashboard)/accounting-engine/financial-statements/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'record-1' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/accounting-engine',
}));

beforeEach(() => {
  state.permissions = new Set();
  vi.stubGlobal('fetch', vi.fn());
});

describe('accounting engine route gates', () => {
  it('does not read the dashboard without accounting_engine.dashboard', () => {
    render(<Dashboard />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not read financial statements without accounting_engine.dashboard', () => {
    render(<FinancialStatements />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a failed accounting dashboard', async () => {
    state.permissions = new Set(['accounting_engine.dashboard']);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Accounting summary offline')));
    const user = userEvent.setup();
    render(<Dashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Accounting summary offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
