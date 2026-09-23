import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/(dashboard)/dashboard/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  user: { fullName: 'Amina Tester', email: 'amina@example.com' } as {
    fullName: string;
    email: string;
  } | null,
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: state.user,
  }),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.user = { fullName: 'Amina Tester', email: 'amina@example.com' };
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('home dashboard route gate', () => {
  it('does not read the executive summary without a dashboard view permission', () => {
    render(<DashboardPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed executive summary', async () => {
    state.permissions = new Set(['finance.view']);
    state.fetch.mockRejectedValue(new Error('Dashboard offline'));
    const user = userEvent.setup();
    render(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.getByText('Failed to load: Dashboard offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
