import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApiRequestLogs from '@/app/(dashboard)/api-gateway/logs/page';

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

beforeEach(() => {
  state.permissions = new Set();
  vi.stubGlobal('fetch', vi.fn());
});

describe('api gateway route gate', () => {
  it('does not read request logs without api_request_logs.view', () => {
    render(<ApiRequestLogs />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a failed request-log load', async () => {
    state.permissions = new Set(['api_request_logs.view']);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Request logs offline')));
    const user = userEvent.setup();
    render(<ApiRequestLogs />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Request logs offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
