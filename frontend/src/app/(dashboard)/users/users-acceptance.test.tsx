import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsersPage from '@/app/(dashboard)/users/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('users route gate', () => {
  it('does not read users without users.read', () => {
    render(<UsersPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed user list', async () => {
    state.permissions = new Set(['users.read']);
    state.fetch.mockRejectedValue(new Error('Users offline'));
    const user = userEvent.setup();
    render(<UsersPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Users offline')).toBeInTheDocument();
    const userCalls = () =>
      state.fetch.mock.calls.filter((call) => String(call[0]) === '/api/backend/users');
    expect(userCalls()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(userCalls()).toHaveLength(2);
  });
});
