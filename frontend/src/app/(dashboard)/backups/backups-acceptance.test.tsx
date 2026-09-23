import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackupDashboard from '@/app/(dashboard)/backups/page';
import BackupJobs from '@/app/(dashboard)/backups/jobs/page';
import BackupRuns from '@/app/(dashboard)/backups/runs/page';
import DisasterRecovery from '@/app/(dashboard)/backups/disaster-recovery/page';

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
  ApiError: class ApiError extends Error {},
  backendGet: (...args: unknown[]) => state.get(...args),
  backendList: (...args: unknown[]) => state.list(...args),
  backendDelete: vi.fn(),
  backendPatch: vi.fn(),
  backendPost: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.get.mockReset();
  state.list.mockReset();
});

describe('backup route gates', () => {
  it('does not read the dashboard without backups.dashboard.view', () => {
    render(<BackupDashboard />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('does not read jobs without backup_jobs.view', () => {
    render(<BackupJobs />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('does not read runs without backup_runs.view', () => {
    render(<BackupRuns />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
  });

  it('keeps the disaster-recovery runbook behind disaster_recovery.view', () => {
    render(<DisasterRecovery />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(screen.queryByText('Target RTO')).not.toBeInTheDocument();
  });

  it('retries a failed backup dashboard load', async () => {
    state.permissions = new Set(['backups.dashboard.view']);
    state.get.mockRejectedValue(new Error('Backups offline'));
    const user = userEvent.setup();
    render(<BackupDashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Backups offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.get).toHaveBeenCalledTimes(2);
  });
});
