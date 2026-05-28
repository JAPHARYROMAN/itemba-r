'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthUser } from '@/lib/auth-types';

// Pages that are reachable without a valid session — never redirect from these.
const PUBLIC_PATHS = new Set<string>(['/login', '/forgot-password', '/reset-password']);
const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_REFRESH_RETRY_MS = 30 * 1000;
const AUTH_REJECTED_STATUSES = new Set([401, 403]);

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
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

  /**
   * When the session can't be re-established (silent refresh failed, or
   * /me returned 401 with no recoverable token), bounce the user to login.
   * Skip if we're already on a public page so we don't loop. Preserve the
   * current path as ?from= so login can return them after.
   */
  const redirectToLogin = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (PUBLIC_PATHS.has(pathname ?? '')) return;
    const from = encodeURIComponent(pathname ?? '/');
    router.replace(`/login?from=${from}`);
  }, [router, pathname]);

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
        return true;
      }
      if (AUTH_REJECTED_STATUSES.has(res.status)) {
        setUser(null);
      }
    } catch {
      // Retryable network/backend failure. Keep any existing user state.
    }
    return false;
  }, []);

  /**
   * Silently refresh the access token, then re-fetch the user profile.
   * Returns true on success. Auth rejection clears local state and redirects;
   * transient backend/network failures keep the current user state and retry.
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
        if (AUTH_REJECTED_STATUSES.has(res.status)) {
          setUser(null);
          redirectToLogin();
        } else {
          armRefreshTimer(SESSION_REFRESH_RETRY_MS);
        }
        return false;
      } catch {
        armRefreshTimer(SESSION_REFRESH_RETRY_MS);
        return false;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [armRefreshTimer, fetchUser, redirectToLogin]);

  useEffect(() => {
    silentRefreshRef.current = silentRefresh;
  }, [silentRefresh]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const ok = await fetchUser();
      if (!ok) {
        // /me failed — try silent refresh; only auth rejection redirects.
        await silentRefresh();
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
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      window.removeEventListener('focus', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [pathname, silentRefresh]);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
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
    <AuthContext.Provider value={{ user, loading, hasPermission, hasRole, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>');
  return ctx;
}
