import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlertEvents from '@/app/(dashboard)/alerts/page';
import AlertRules from '@/app/(dashboard)/alerts/rules/page';

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

describe('alerts route gates', () => {
  it('does not read alert events without alert_events.view', () => {
    render(<AlertEvents />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not read alert rules without alert_rules.view', () => {
    render(<AlertRules />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a failed alert-events load', async () => {
    state.permissions = new Set(['alert_events.view']);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Alerts offline')));
    const user = userEvent.setup();
    render(<AlertEvents />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Alerts offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
