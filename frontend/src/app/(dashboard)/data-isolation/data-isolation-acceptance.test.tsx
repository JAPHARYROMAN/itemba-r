import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataIsolationDashboard from '@/app/(dashboard)/data-isolation/page';
import DataIsolationIssues from '@/app/(dashboard)/data-isolation/issues/page';
import DataIsolationTestRuns from '@/app/(dashboard)/data-isolation/test-runs/page';

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
  backendPut: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('data isolation route gates', () => {
  it('does not read the dashboard without data_isolation.view', () => {
    render(<DataIsolationDashboard />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read issues without data_isolation.view', () => {
    render(<DataIsolationIssues />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read test runs without data_isolation.view', () => {
    render(<DataIsolationTestRuns />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed data-isolation dashboard load', async () => {
    state.permissions = new Set(['data_isolation.view']);
    state.fetch.mockRejectedValue(new Error('Isolation offline'));
    const user = userEvent.setup();
    render(<DataIsolationDashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Isolation offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
