import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLogs from '@/app/(dashboard)/audit-logs/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
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
  backendPage: (...args: unknown[]) => state.page(...args),
  backendGet: (...args: unknown[]) => state.get(...args),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.page.mockReset();
  state.get.mockReset().mockResolvedValue([]);
});

describe('audit log route gate', () => {
  it('does not read audit logs without audit-logs.read', () => {
    render(<AuditLogs />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('retries a failed audit-log load', async () => {
    state.permissions = new Set(['audit-logs.read']);
    state.page.mockRejectedValue(new Error('Audit log offline'));
    const user = userEvent.setup();
    render(<AuditLogs />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Audit log offline')).toBeInTheDocument();
    const reads = state.page.mock.calls.filter((call) => call[0] === 'audit-logs').length;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const readsAfter = state.page.mock.calls.filter((call) => call[0] === 'audit-logs').length;
    expect(readsAfter).toBe(reads + 1);
  });
});
