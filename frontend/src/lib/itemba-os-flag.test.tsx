/**
 * ITEMBA OS release switch (POS_REMAKE_PLAN_2026-09-23.md §3 P3).
 *
 * The flag is inlined at build time, so each case stubs the env, resets the
 * module graph and imports fresh. Off must give back the pre-OS shell, sign-in
 * and sidebar; on must give the OS desktop. vitest.config.ts runs the rest of
 * the suite with the flag on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock('@/contexts/auth-context', () => ({ AuthProvider: passthrough }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { permissions: ['sales_orders.view'] },
    loading: false,
    authOffline: false,
  }),
}));
vi.mock('@/components/workspace/workspace-session', () => ({
  WorkspaceSessionProvider: passthrough,
}));
vi.mock('@/components/workspace/workspace-drafts', () => ({
  WorkspaceDraftsProvider: passthrough,
}));
vi.mock('@/components/workspace/unsaved-work-provider', () => ({
  UnsavedWorkProvider: passthrough,
}));
vi.mock('@/components/aurora/command', () => ({ CommandPaletteProvider: passthrough }));
vi.mock('@/components/aurora/feedback', () => ({ ToastProvider: () => null }));
vi.mock('@/components/security/CsrfFetchProvider', () => ({ CsrfFetchProvider: passthrough }));
vi.mock('@/components/layout/route-progress', () => ({ RouteProgress: () => null }));
vi.mock('@/components/msaidizi/msaidizi-launcher', () => ({
  MsaidiziLauncherProvider: passthrough,
}));
vi.mock('@/lib/design-system/theme', () => ({ initTheme: vi.fn() }));
vi.mock('@/components/os/desktop-shell', () => ({
  DesktopShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="os-shell">{children}</div>
  ),
}));
vi.mock('@/components/layout/legacy-shell', () => ({
  LegacyShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="legacy-shell">{children}</div>
  ),
}));
vi.mock('@/components/auth/os-login', () => ({ OsLogin: () => <div data-testid="os-login" /> }));
vi.mock('@/components/auth/legacy-login', () => ({
  LegacyLogin: () => <div data-testid="legacy-login" />,
}));

async function withFlag(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv('NEXT_PUBLIC_ITEMBA_OS_ENABLED', '');
  else vi.stubEnv('NEXT_PUBLIC_ITEMBA_OS_ENABLED', value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isItembaOsEnabled', () => {
  it('is on only for the exact string "true"', async () => {
    const { isItembaOsEnabled } = await import('./itemba-os-flag');
    expect(isItembaOsEnabled('true')).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      expect(isItembaOsEnabled(value)).toBe(false);
    }
  });
});

describe.each([
  { flag: 'true', shell: 'os-shell', login: 'os-login', appsHidden: false, fuelHidden: true },
  {
    flag: 'false',
    shell: 'legacy-shell',
    login: 'legacy-login',
    appsHidden: true,
    fuelHidden: false,
  },
  {
    flag: undefined,
    shell: 'legacy-shell',
    login: 'legacy-login',
    appsHidden: true,
    fuelHidden: false,
  },
])('with NEXT_PUBLIC_ITEMBA_OS_ENABLED=$flag', ({ flag, shell, login, appsHidden, fuelHidden }) => {
  it(`renders the dashboard inside ${shell}`, async () => {
    await withFlag(flag);
    const { default: DashboardClientLayout } = await import('@/components/os/dashboard-layout');
    render(
      <DashboardClientLayout appUrls={{}}>
        <p>page body</p>
      </DashboardClientLayout>,
    );
    expect(screen.getByTestId(shell)).toHaveTextContent('page body');
    expect(screen.queryByTestId(shell === 'os-shell' ? 'legacy-shell' : 'os-shell')).toBeNull();
  });

  it(`serves ${login} at /login`, async () => {
    await withFlag(flag);
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    render(<LoginPage />);
    expect(screen.getByTestId(login)).toBeInTheDocument();
  });

  it('shows the sidebar rows that exist in this shell', async () => {
    await withFlag(flag);
    const { NAV, isGroup } = await import('@/components/layout/sidebar');
    const leaves = NAV.filter((item) => !isGroup(item)) as Array<{
      href: string;
      sidebarHidden?: boolean;
    }>;
    expect(!!leaves.find((item) => item.href === '/apps')?.sidebarHidden).toBe(appsHidden);
    expect(!!leaves.find((item) => item.href === '/fuel-grid')?.sidebarHidden).toBe(fuelHidden);
  });
});
