import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsDashboard from '@/app/(dashboard)/integrations/page';
import Connections from '@/app/(dashboard)/integrations/connections/page';
import Events from '@/app/(dashboard)/integrations/events/page';
import Mappings from '@/app/(dashboard)/integrations/mappings/page';
import Messages from '@/app/(dashboard)/integrations/messages/page';
import Payments from '@/app/(dashboard)/integrations/payments/page';
import Providers from '@/app/(dashboard)/integrations/providers/page';
import Templates from '@/app/(dashboard)/integrations/templates/page';
import WebhookEvents from '@/app/(dashboard)/integrations/webhook-events/page';
import Webhooks from '@/app/(dashboard)/integrations/webhooks/page';

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

const pages = [
  ['dashboard', IntegrationsDashboard],
  ['connections', Connections],
  ['events', Events],
  ['mappings', Mappings],
  ['messages', Messages],
  ['payments', Payments],
  ['providers', Providers],
  ['templates', Templates],
  ['webhook events', WebhookEvents],
  ['webhooks', Webhooks],
] as const;

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('integrations route gates', () => {
  it.each(pages)('does not read %s without its view permission', (_name, Page) => {
    render(<Page />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed integration-events load', async () => {
    state.permissions = new Set(['integration_events.view']);
    state.fetch.mockRejectedValue(new Error('Events offline'));
    const user = userEvent.setup();
    render(<Events />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Events offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
