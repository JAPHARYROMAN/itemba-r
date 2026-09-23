import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TasksPage from '@/app/(dashboard)/tasks/page';

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
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendPost: vi.fn(),
  backendPatch: vi.fn(),
  backendDelete: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('tasks route gate', () => {
  it('does not read tasks without tasks.view', () => {
    render(<TasksPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed task list', async () => {
    state.permissions = new Set(['tasks.view']);
    state.fetch.mockRejectedValue(new Error('Tasks offline'));
    const user = userEvent.setup();
    render(<TasksPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Tasks offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const taskCalls = state.fetch.mock.calls.filter((call) =>
      String(call[0]).includes('/api/backend/tasks'),
    );
    expect(taskCalls).toHaveLength(2);
  });
});
