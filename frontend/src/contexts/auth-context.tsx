'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@/lib/auth-types';
import { SESSION_EXPIRED_EVENT } from '@/lib/api-client';

// Pages that are reachable without a valid session — never redirect from these.
const PUBLIC_PATHS = new Set<string>(['/login', '/forgot-password', '/reset-password']);
const SESSION_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const SESSION_REFRESH_RETRY_MS = 30 * 1000;

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /**
   * True when the last boot/refresh attempt failed because the server could
   * not be REACHED (fetch threw — offline, captive portal, backend down), and
   * no authoritative rejection (401 response, session-expired, logout) has
   * happened since. Distinguishes "we don't know who you are because the
   * network is gone" from "the server said no". Reset to false by any
   * successful auth AND by any authoritative rejection.
   */
  authOffline: boolean;
  /** Returns true if the current user has ALL of the listed permissions. */
  hasPermission: (...perms: string[]) => boolean;
  /** Returns true if the current user has ANY of the listed roles. */
  hasRole: (...roles: string[]) => boolean;
  /** Refreshes the in-memory user profile from the server. */
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authOffline, setAuthOffline] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentRefreshRef = useRef<(() => Promise<boolean>) | null>(null);
  // Single-flight: when several tabs / components see a 401 simultaneously,
  // collapse all of their `silentRefresh()` calls onto one in-flight Promise
  // so the backend's refresh-token rotation only runs once. Without this,
  // parallel refreshes would consume each other's tokens and trigger
  // refresh-token reuse detection, kicking the user back to /login.
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);

  const armRefreshTimer = useCallback((delayMs = SESSION_REFRESH_INTERVAL_MS) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void silentRefreshRef.current?.();
    }, delayMs);
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.data ?? data.user ?? data);
        setAuthOffline(false);
        return true;
      }
      // The server ANSWERED (e.g. 401): an authoritative signal, not a
      // connection gap — never treat it as offline.
      setAuthOffline(false);
    } catch {
      // fetch threw (TypeError): the server was unreachable — offline, captive
      // portal, or backend down. navigator.onLine can lie "true" behind a
      // captive portal, so the thrown fetch alone is sufficient evidence of a
      // connection problem. Retryable; keep any existing user state.
      setAuthOffline(true);
      return false;
    }
    return false;
  }, []);

  /**
   * Silently refresh the access token, then re-fetch the user profile.
   * Returns true on success. Failures keep the current user state and retry;
   * the app should not throw away in-progress work because a background refresh
   * hit a race, transient backend error, or stale response.
   *
   * P1-08: Single-flight. Concurrent callers share one in-flight Promise so
   * the backend rotates the refresh token exactly once per refresh window.
   */
  const silentRefresh = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const promise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' });
        if (res.ok) {
          await fetchUser();
          armRefreshTimer();
          return true;
        }
        // The server REJECTED the refresh — authoritative. Clear the offline
        // grace so auth gates treat this as a genuine signed-out state.
        setAuthOffline(false);
        armRefreshTimer(SESSION_REFRESH_RETRY_MS);
        return false;
      } catch {
        // Server unreachable — connection-shaped failure, not a rejection.
        setAuthOffline(true);
        armRefreshTimer(SESSION_REFRESH_RETRY_MS);
        return false;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [armRefreshTimer, fetchUser]);

  useEffect(() => {
    silentRefreshRef.current = silentRefresh;
  }, [silentRefresh]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ok = await fetchUser();
      if (!ok) {
        // /me failed — try silent refresh; only auth rejection redirects.
        const refreshed = await silentRefresh();
        if (!refreshed) setUser(null);
      } else {
        armRefreshTimer();
      }
      setLoading(false);
    })();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [armRefreshTimer, fetchUser, silentRefresh]);

  useEffect(() => {
    const refreshOnResume = () => {
      if (PUBLIC_PATHS.has(pathname ?? '')) return;
      void silentRefresh();
    };

    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') refreshOnResume();
    };

    window.addEventListener('focus', refreshOnResume);
    // Reconnect: retry auth as soon as the browser reports connectivity so an
    // offline-grace state (see authOffline) resolves authoritatively — either
    // the session is restored or a real rejection resumes normal redirects.
    // Single-flight via refreshInFlightRef; 'online' fires once per transition.
    window.addEventListener('online', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      window.removeEventListener('focus', refreshOnResume);
      window.removeEventListener('online', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [pathname, silentRefresh]);

  // An unrecoverable backend 401 (a refresh could not restore the session) ->
  // clear the user and bounce to login with a notice, instead of letting pages
  // surface a raw "Unauthorized" on a half-filled form.
  useEffect(() => {
    const onExpired = () => {
      if (PUBLIC_PATHS.has(pathname ?? '')) return;
      setUser(null);
      // A backend 401 that survived a refresh attempt is authoritative.
      setAuthOffline(false);
      router.replace('/login?expired=1');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [pathname, router]);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    // Explicit user sign-out is authoritative — never leave grace behind it.
    setAuthOffline(false);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    router.push('/login');
  }, [router]);

  const hasPermission = useCallback(
    (...perms: string[]) => {
      if (!user) return false;
      return perms.every((p) => user.permissions.includes(p));
    },
    [user],
  );

  const hasRole = useCallback(
    (...roles: string[]) => {
      if (!user) return false;
      return roles.some((r) => user.roles.includes(r));
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, authOffline, hasPermission, hasRole, refreshUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>');
  return ctx;
}
