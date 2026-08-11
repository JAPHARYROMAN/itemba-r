/**
 * Offline cold-start grace for the mobile POS (critique B2).
 *
 * The PWA relaunches at /mobile-pos with no network. The service worker serves
 * the cached document but never touches /api/*, so the auth boot's
 * /api/auth/me + /api/auth/refresh fetches THROW instead of answering. Before
 * the fix, AuthGate treated that exactly like a rejected session and redirected
 * to /login — a route the service worker does not cache — dead-ending an
 * offline-capable POS on the browser error page.
 *
 * Contract under test:
 *  (a) connection-shaped boot failure sets authOffline and does NOT redirect
 *      away from /mobile-pos — the POS renders and serves from IndexedDB;
 *  (b) an authoritative 401/refresh-denial still redirects, even on /mobile-pos;
 *  (c) non-POS paths never get the grace — offline boot still redirects;
 *  (d) the 'online' event retries auth and a success clears the grace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuthContext } from '@/contexts/auth-context';
import { AuthGate } from './layout';

const { replaceMock, pathnameRef } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pathnameRef: { current: '/mobile-pos' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => pathnameRef.current,
  useSearchParams: () => new URLSearchParams(),
}));

const AUTH_USER = {
  id: 'u1',
  email: 'rep@itemba.tz',
  fullName: 'POS Rep',
  roles: ['sales_rep'],
  permissions: ['mobile_pos_lite.use'],
  companyId: null,
};

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function status401() {
  return new Response(JSON.stringify({ message: 'Unauthorized', statusCode: 401 }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Reads context state so tests can await loading/authOffline transitions. */
function Probe() {
  const { user, loading, authOffline } = useAuthContext();
  return (
    <div
      data-testid="auth-probe"
      data-loading={String(loading)}
      data-offline={String(authOffline)}
      data-user={user?.email ?? ''}
    />
  );
}

function renderGate() {
  return render(
    <AuthProvider>
      <AuthGate>
        <div data-testid="pos-shell" />
      </AuthGate>
      <Probe />
    </AuthProvider>,
  );
}

async function waitForBoot() {
  await waitFor(() =>
    expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-loading', 'false'),
  );
}

describe('AuthGate offline grace (mobile POS cold start)', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pathnameRef.current = '/mobile-pos';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the POS instead of redirecting when the auth boot fails to connect', async () => {
    // Offline: the SW never caches /api/*, so every auth fetch throws.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderGate();
    await waitForBoot();

    expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-offline', 'true');
    expect(screen.getByTestId('pos-shell')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('still redirects to /login on an authoritative 401 + refresh denial, even on /mobile-pos', async () => {
    // The server is reachable and says NO: /me 401, /refresh 401.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => status401()),
    );

    renderGate();
    await waitForBoot();

    expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-offline', 'false');
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login?from=%2Fmobile-pos'));
    expect(screen.queryByTestId('pos-shell')).not.toBeInTheDocument();
  });

  it('never grants the grace to non-POS paths — offline boot still redirects', async () => {
    pathnameRef.current = '/dashboard';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderGate();
    await waitForBoot();

    // authOffline is true (the connection really is gone) but the grace is
    // scoped to /mobile-pos, so the normal redirect still fires.
    expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-offline', 'true');
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login?from=%2Fdashboard'));
    expect(screen.queryByTestId('pos-shell')).not.toBeInTheDocument();
  });

  it("retries on the 'online' event and clears the grace when auth succeeds", async () => {
    let network: 'down' | 'up' = 'down';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        if (network === 'down') throw new TypeError('Failed to fetch');
        const url = String(input);
        if (url.startsWith('/api/auth/refresh')) return okJson({ success: true });
        if (url.startsWith('/api/auth/me')) return okJson({ data: AUTH_USER });
        return okJson({});
      }),
    );

    renderGate();
    await waitForBoot();
    expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-offline', 'true');
    expect(screen.getByTestId('pos-shell')).toBeInTheDocument();

    network = 'up';
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-user', AUTH_USER.email),
    );
    expect(screen.getByTestId('auth-probe')).toHaveAttribute('data-offline', 'false');
    // Reconnect restored the session — the POS stays up, no login bounce.
    expect(screen.getByTestId('pos-shell')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
