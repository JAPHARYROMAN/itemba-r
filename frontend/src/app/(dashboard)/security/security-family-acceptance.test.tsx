import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsApp } from '@/features/reports/reports-app';
import ReportRunPage from '@/app/(dashboard)/reports/run/page';
import ScheduledReports from '@/app/(dashboard)/reports/scheduled/page';
import RolesPage from '@/app/(dashboard)/roles/page';
import CommissionsPage from '@/app/(dashboard)/sales/commissions/page';
import SecurityDashboard from '@/app/(dashboard)/security/page';
import SecurityPolicies from '@/app/(dashboard)/security/policies/page';
import SecurityProfiles from '@/app/(dashboard)/security/user-profiles/page';
import SecurityEvents from '@/app/(dashboard)/security/events/page';
import SecuritySessions from '@/app/(dashboard)/security/sessions/page';
import TwoFactor from '@/app/(dashboard)/security/two-factor/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  user: null as { id: string } | null,
  fetch: vi.fn(),
  backendGet: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: state.user,
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendGet: state.backendGet,
  backendPage: vi.fn(),
  backendList: vi.fn(),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const restricted = [
  ['report run', ReportRunPage],
  ['scheduled reports', ScheduledReports],
  ['roles', RolesPage],
  ['commissions', CommissionsPage],
  ['security dashboard', SecurityDashboard],
  ['security policies', SecurityPolicies],
  ['security profiles', SecurityProfiles],
  ['security events', SecurityEvents],
  ['security sessions', SecuritySessions],
  ['two-factor', TwoFactor],
] as const;

beforeEach(() => {
  state.permissions = new Set();
  state.user = null;
  state.fetch.mockReset();
  state.backendGet.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('reports, roles, sales, and security', () => {
  it('does not read the report catalog before a signed-in user exists', () => {
    render(<ReportsApp />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByText('Access Restricted')).not.toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it.each(restricted)('does not read %s without its view permission', (_name, Page) => {
    state.user = { id: 'user-1' };
    render(<Page />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it('retries a failed roles load', async () => {
    state.user = { id: 'user-1' };
    state.permissions = new Set(['roles.read']);
    state.fetch.mockRejectedValue(new Error('Roles offline'));
    const user = userEvent.setup();
    render(<RolesPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Roles offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
