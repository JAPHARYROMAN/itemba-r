import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AutomationRules from '@/app/(dashboard)/automation/rules/page';
import AutomationRuns from '@/app/(dashboard)/automation/runs/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
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
  backendGet: (...args: unknown[]) => state.get(...args),
  backendList: (...args: unknown[]) => state.list(...args),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

beforeEach(() => {
  state.permissions = new Set();
  state.get.mockReset();
  state.list.mockReset().mockResolvedValue([]);
});

describe('automation route gates', () => {
  it('does not read rules without automation_rules.list', () => {
    render(<AutomationRules />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('does not read runs without automation_runs.list', () => {
    render(<AutomationRuns />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('retries a failed automation-rules load', async () => {
    state.permissions = new Set(['automation_rules.list']);
    state.get.mockRejectedValue(new Error('Rules offline'));
    const user = userEvent.setup();
    render(<AutomationRules />);
    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.getByText('Rules offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(state.get).toHaveBeenCalledTimes(2);
  });
});
