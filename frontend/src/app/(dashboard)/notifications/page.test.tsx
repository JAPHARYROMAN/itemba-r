import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationsPage from './page';

const h = vi.hoisted(() => ({
  page: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/lib/api-client', () => ({
  backendPage: h.page,
  backendGet: h.get,
  backendPatch: h.patch,
  backendDelete: h.remove,
}));

const TASK_URL = '/msaidizi?workspace=tasks&taskId=11111111-1111-4111-8111-111111111111';

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notification-1',
    title: 'Msaidizi task needs attention',
    message: 'Inspect the durable task.',
    notificationType: 'SYSTEM_ALERT',
    priority: 'CRITICAL',
    status: 'UNREAD',
    actionUrl: TASK_URL,
    createdAt: '2026-08-26T08:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.page.mockResolvedValue({
    data: [notification()],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
  h.get.mockResolvedValue({ count: 37 });
});

describe('NotificationsPage governed Msaidizi links', () => {
  it('uses the exact unread count instead of undercounting the visible page', async () => {
    render(<NotificationsPage />);

    expect(await screen.findByText('37')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('/notifications/unread-count');
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', TASK_URL);
  });

  it('keeps an unsafe persisted action URL inert', async () => {
    h.page.mockResolvedValue({
      data: [notification({ actionUrl: '//attacker.invalid/credential-capture' })],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    render(<NotificationsPage />);

    expect(await screen.findByText('Msaidizi task needs attention')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });
});
