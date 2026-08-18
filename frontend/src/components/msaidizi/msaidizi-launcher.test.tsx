/**
 * The launcher, and the POS boundary that comes free with where it hangs.
 *
 * `layout.tsx` has two arms. `mobilePosStandalone` strips the entire ERP shell
 * for `/mobile-pos` and `/westsides/mobile-pos`; everything else gets the
 * sidebar, the topbar and the assistant. The Msaidizi provider is mounted inside
 * the second arm only, so Kaunta has no launcher for a structural reason rather
 * than a runtime pathname check somebody has to remember to write.
 *
 * These tests render the REAL `DashboardLayout` so the property under test is
 * the tree the browser gets. Only the boundaries are doubled: the auth context
 * (which would otherwise boot against the network) and the router.
 *
 * LAUNCH-1  The topbar entry opens a composer and submitting NAVIGATES — the
 *           launcher is a launcher. It renders no steps and no thread; a compact
 *           thread here would be the docked panel again, with two renderers and
 *           a mid-stream handover across a route change.
 * LAUNCH-2  Ctrl/⌘+J does the same, following the CommandPaletteProvider
 *           precedent exactly.
 * LAUNCH-3  ══ THE POS EXCLUSION ══ the POS shell mounts no launcher, no button
 *           and no shortcut. Ctrl+J in Kaunta navigates nowhere.
 * LAUNCH-4  Without `msaidizi.use` the whole surface is ABSENT, not disabled —
 *           an unpermitted capability is invisible, never refused.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardLayout from '@/app/(dashboard)/layout';

/* ------------------------------------------------------------------------ *
 * Doubles — only the two boundaries that reach outside the tree.
 * ------------------------------------------------------------------------ */
const h = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: { current: '/dashboard' },
  permissions: { current: ['msaidizi.use', 'sales.view'] },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: h.push,
    replace: h.replace,
    prefetch: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => h.pathname.current,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthContext: () => ({
    user: {
      id: 'u1',
      email: 'manager@itemba.tz',
      fullName: 'Asha Manager',
      roles: ['company_manager'],
      permissions: h.permissions.current,
      companyId: 'c1',
    },
    loading: false,
    authOffline: false,
    hasPermission: (...perms: string[]) =>
      perms.every((permission) => h.permissions.current.includes(permission)),
    hasRole: () => true,
    refreshUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Monkey-patches window.fetch in an effect; irrelevant here and noisy in jsdom.
vi.mock('@/components/security/CsrfFetchProvider', () => ({
  CsrfFetchProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/design-system/theme', () => ({ initTheme: vi.fn() }));

// jsdom ships no `matchMedia`, and the topbar's theme selector asks for it on
// mount. Nothing under test here depends on the answer, so a permanently-light
// stub keeps the real shell rendering instead of forcing a mock of the topbar —
// which is the component the launcher entry actually lives in.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function renderShell() {
  return render(
    <DashboardLayout>
      <div data-testid="page-content" />
    </DashboardLayout>,
  );
}

beforeEach(() => {
  h.push.mockClear();
  h.pathname.current = '/dashboard';
  h.permissions.current = ['msaidizi.use', 'sales.view'];
});

/* ------------------------------------------------------------------------ *
 * LAUNCH-1 · It opens the page, and only opens the page
 * ------------------------------------------------------------------------ */

describe('LAUNCH-1 · the topbar entry opens the page with the question running', () => {
  it('opens a composer rather than answering in place', async () => {
    renderShell();

    await userEvent.click(screen.getByTestId('msaidizi-launcher-button'));

    const dialog = screen.getByTestId('msaidizi-launcher-dialog');
    expect(dialog).toBeInTheDocument();
    // A launcher, not a destination: no thread, no steps, no answer.
    expect(screen.queryByTestId('msaidizi-thread')).toBeNull();
    expect(screen.queryByTestId('msaidizi-step')).toBeNull();
  });

  it('navigates to /msaidizi carrying the question', async () => {
    renderShell();

    await userEvent.click(screen.getByTestId('msaidizi-launcher-button'));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Ask Msaidizi' }),
      'How much do we owe suppliers?{Enter}',
    );

    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith('/msaidizi?ask=How%20much%20do%20we%20owe%20suppliers%3F');
    expect(screen.queryByTestId('msaidizi-launcher-dialog')).toBeNull();
  });

  it('opens the bare page when nothing was typed', async () => {
    renderShell();

    await userEvent.click(screen.getByTestId('msaidizi-launcher-button'));
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(h.push).toHaveBeenCalledWith('/msaidizi');
  });
});

/* ------------------------------------------------------------------------ *
 * LAUNCH-2 · The shortcut
 * ------------------------------------------------------------------------ */

describe('LAUNCH-2 · Ctrl/Cmd+J follows the command-palette precedent', () => {
  it('toggles the launcher open and closed', async () => {
    renderShell();

    await userEvent.keyboard('{Control>}j{/Control}');
    expect(screen.getByTestId('msaidizi-launcher-dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Control>}j{/Control}');
    expect(screen.queryByTestId('msaidizi-launcher-dialog')).toBeNull();
  });

  it('closes on Escape without navigating', async () => {
    renderShell();

    await userEvent.keyboard('{Meta>}j{/Meta}');
    expect(screen.getByTestId('msaidizi-launcher-dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('msaidizi-launcher-dialog')).toBeNull();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+K to the command palette', async () => {
    renderShell();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByTestId('msaidizi-launcher-dialog')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * LAUNCH-3 · The POS exclusion
 * ------------------------------------------------------------------------ */

describe('LAUNCH-3 · the POS shell never gets a launcher', () => {
  it.each(['/mobile-pos', '/westsides/mobile-pos'])(
    'mounts no assistant button at %s',
    (pathname) => {
      h.pathname.current = pathname;
      renderShell();

      expect(screen.getByTestId('page-content')).toBeInTheDocument();
      expect(screen.queryByTestId('msaidizi-launcher-button')).toBeNull();
    },
  );

  it('does not answer the shortcut inside Kaunta', async () => {
    h.pathname.current = '/mobile-pos';
    renderShell();

    await userEvent.keyboard('{Control>}j{/Control}');

    expect(screen.queryByTestId('msaidizi-launcher-dialog')).toBeNull();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('mounts it again in the ERP shell, so the exclusion is the branch and not the feature', () => {
    h.pathname.current = '/dashboard';
    renderShell();
    expect(screen.getByTestId('msaidizi-launcher-button')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * LAUNCH-4 · Invisible, not refused
 * ------------------------------------------------------------------------ */

describe('LAUNCH-4 · without msaidizi.use the surface is absent', () => {
  beforeEach(() => {
    h.permissions.current = ['sales.view'];
  });

  it('shows no topbar entry', () => {
    renderShell();
    expect(screen.queryByTestId('msaidizi-launcher-button')).toBeNull();
    // Absent, not present-and-disabled: an unpermitted capability is invisible.
    expect(screen.queryByRole('button', { name: /msaidizi/i })).toBeNull();
  });

  it('ignores the shortcut', async () => {
    renderShell();
    await userEvent.keyboard('{Control>}j{/Control}');
    expect(screen.queryByTestId('msaidizi-launcher-dialog')).toBeNull();
  });

  it('keeps the nav leaf out of the sidebar', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: /msaidizi/i })).toBeNull();
  });
});
