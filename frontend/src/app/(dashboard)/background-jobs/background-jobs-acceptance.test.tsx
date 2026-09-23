import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackgroundJobs from '@/app/(dashboard)/background-jobs/page';
import JobQueues from '@/app/(dashboard)/background-jobs/queues/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
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
  backendList: (...args: unknown[]) => state.list(...args),
  backendPut: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.page.mockReset();
  state.get.mockReset();
  state.list.mockReset();
});

describe('background job route gates', () => {
  it('does not read jobs without background_jobs.view', () => {
    render(<BackgroundJobs />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('does not read queues without job_queue_configs.view', () => {
    render(<JobQueues />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('retries a failed background-job load', async () => {
    state.permissions = new Set(['background_jobs.view']);
    state.page.mockRejectedValue(new Error('Jobs offline'));
    state.get.mockRejectedValue(new Error('Jobs offline'));
    const user = userEvent.setup();
    render(<BackgroundJobs />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Jobs offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.page).toHaveBeenCalledTimes(2);
  });
});
