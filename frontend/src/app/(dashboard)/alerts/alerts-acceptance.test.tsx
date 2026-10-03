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
  it('links a party alert to the party profile (party linkage, Phase 3)', async () => {
    state.permissions = new Set(['alert_events.view']);
    const events = [
      {
        id: 'ev-1',
        alertEventNumber: 'ALRT-PT-1',
        alertType: 'CREDIT_LIMIT_BREACH',
        title: 'Credit limit exceeded: Westsides',
        priority: 'CRITICAL',
        status: 'OPEN',
        linkedEntityType: 'Customer',
        linkedEntityId: 'cus-1',
        triggeredAt: '2026-10-03T06:00:00.000Z',
      },
      {
        id: 'ev-2',
        alertEventNumber: 'ALRT-LS-1',
        alertType: 'LOW_STOCK',
        title: 'Low stock: Cement',
        priority: 'HIGH',
        status: 'OPEN',
        linkedEntityType: 'Product',
        linkedEntityId: 'prod-1',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { data: events } }) }),
    );
    render(<AlertEvents />);
    expect(await screen.findByText('Credit limit exceeded: Westsides')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Open profile' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/sales-desk/customers/cus-1');
  });
});
