'use client';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { appForPath, usesStandalonePosShell } from '@/lib/apps';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NAV, isGroup, type NavItem } from '@/components/layout/sidebar';
import { DesktopShell as OsShell } from '@/components/os/desktop-shell';
import { LegacyShell } from '@/components/layout/legacy-shell';
import { ITEMBA_OS_ENABLED } from '@/lib/itemba-os-flag';
import { AuthProvider } from '@/contexts/auth-context';
import { useAuth } from '@/hooks/use-auth';
import { initTheme } from '@/lib/design-system/theme';
import { CommandPaletteProvider } from '@/components/aurora/command';
import { ToastProvider } from '@/components/aurora/feedback';
import { CsrfFetchProvider } from '@/components/security/CsrfFetchProvider';
import { PageSpinner } from '@/components/ui';
import { RouteProgress } from '@/components/layout/route-progress';
import { MsaidiziLauncherProvider } from '@/components/msaidizi/msaidizi-launcher';

const PUBLIC_DASHBOARD_PATHS = new Set(['/westsides/mobile-pos/install']);

/**
 * Resolve the browser-tab title from the NAV tree: the deepest nav entry whose
 * href is the pathname or an ancestor of it. Every page gets a distinguishable
 * tab title without per-page wiring; unknown routes fall back to the app name.
 */
function titleForPath(pathname: string): string | null {
  const app = appForPath(pathname);
  if (app) return app.label;
  let best: { href: string; label: string } | null = null;
  const visit = (items: NavItem[]) => {
    for (const item of items) {
      if (isGroup(item)) {
        visit(item.children);
      } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!best || item.href.length > best.href.length) best = item;
      }
    }
  };
  visit(NAV);
  return best ? (best as { label: string }).label : null;
}

// A user whose every permission sits in this set is a POS-only user: their
// whole app is Itemba POS, and the ERP shell should never appear. Office
// users always hold other permissions, so they are never redirected.
// Includes the manager-tier POS codes (owner decision, 2026-08-11): a
// phone-only branch manager who can also receive stock and count inventory
// still lives entirely in the POS. (.stock_count ships with the Stoo phase;
// listing it now is inert until the permission is seeded.)
// Price editing (POS remake phase 3) is granted to reps, so both codes belong
// here: without them a rep who can change a price would stop counting as
// POS-only and be sent from the till into the ERP shell.
const POS_ONLY_PERMISSIONS = new Set([
  'mobile_pos_lite.use',
  'mobile_pos_lite.purchase',
  'mobile_pos_lite.stock_count',
  'mobile_pos_lite.edit_price',
  'mobile_pos_lite.edit_price_unlimited',
]);

export function isPosOnlyUser(user: { permissions: string[] } | null | undefined): boolean {
  return (
    !!user &&
    user.permissions.includes('mobile_pos_lite.use') &&
    user.permissions.every((permission) => POS_ONLY_PERMISSIONS.has(permission))
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, authOffline } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicDashboardPath = PUBLIC_DASHBOARD_PATHS.has(pathname ?? '');

  // SECURITY: offline grace for the mobile POS ONLY. On an offline PWA cold
  // start the auth boot cannot reach /api/auth/* (the service worker
  // deliberately never caches /api/*), so user stays null for a
  // connection-shaped reason, not because the server rejected the session.
  // Redirecting then would send the rep to /login — a route the service
  // worker does not cache — dead-ending an offline-capable POS on the browser
  // error page. In the grace state we render the POS instead: it binds to its
  // terminal, restores its cached session from IndexedDB, and queues sales
  // locally; its API calls fail harmlessly until connectivity returns.
  // This is gated on authOffline, which auth-context sets ONLY for unreachable
  // servers (fetch threw) and clears on any authoritative answer — so a real
  // 401/refresh-denial still redirects even on /mobile-pos, and every
  // non-POS path keeps the unconditional redirect. Server-side enforcement is
  // untouched: middleware still requires token cookies on live navigations and
  // the backend authenticates every API call; this grace only decides which
  // offline-rendered shell (POS vs login) the browser shows.
  const posOfflineGrace =
    !loading && !user && authOffline && (pathname?.startsWith('/mobile-pos') ?? false);

  useEffect(() => {
    if (isPublicDashboardPath) return;
    if (loading || user) return;
    if (posOfflineGrace) return;
    const query = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
    const returnPath = `${pathname ?? '/'}${query ? `?${query}` : ''}`;
    router.replace(`/login?from=${encodeURIComponent(returnPath)}`);
  }, [isPublicDashboardPath, loading, pathname, posOfflineGrace, router, user]);

  useEffect(() => {
    if (loading || !isPosOnlyUser(user)) return;
    if (pathname?.startsWith('/mobile-pos')) return;
    router.replace('/mobile-pos');
  }, [loading, pathname, router, user]);

  if (isPublicDashboardPath) return <>{children}</>;

  if (posOfflineGrace) return <>{children}</>;

  if (loading || !user || (isPosOnlyUser(user) && !pathname?.startsWith('/mobile-pos'))) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'var(--aurora-bg)' }}
      >
        <PageSpinner label="Checking your session" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function DashboardClientLayout({
  children,
  appUrls,
}: {
  children: React.ReactNode;
  appUrls: Record<string, string | null>;
}) {
  const pathname = usePathname();
  const mobilePosStandalone = usesStandalonePosShell(pathname ?? '');

  useEffect(() => {
    initTheme();
  }, []);

  useEffect(() => {
    const label = titleForPath(pathname ?? '');
    if (ITEMBA_OS_ENABLED) document.title = label ? `${label} · ITEMBA OS` : 'ITEMBA OS';
    else document.title = label ? `${label} · Itemba` : 'Itemba OS';
  }, [pathname]);

  return (
    <AuthProvider>
      <AuthGate>
        <CsrfFetchProvider>
          <WorkspaceSessionProvider>
            <UnsavedWorkProvider>
              <WorkspaceDraftsProvider synchronize>
                <CommandPaletteProvider>
                  <RouteProgress />
                  <ToastProvider />
                  {mobilePosStandalone ? (
                    <main
                      className="min-h-screen overflow-auto"
                      style={{ background: 'var(--aurora-bg)' }}
                    >
                      {children}
                    </main>
                  ) : (
                    // The Msaidizi launcher hangs HERE, inside the ERP arm only. The
                    // POS shell above never mounts it, so Kaunta has no assistant
                    // button and no Ctrl+J — the boundary is structural, not a
                    // runtime pathname check anyone can forget to write.
                    <MsaidiziLauncherProvider>
                      {ITEMBA_OS_ENABLED ? (
                        <OsShell appUrls={appUrls}>{children}</OsShell>
                      ) : (
                        <LegacyShell>{children}</LegacyShell>
                      )}
                    </MsaidiziLauncherProvider>
                  )}
                </CommandPaletteProvider>
              </WorkspaceDraftsProvider>
            </UnsavedWorkProvider>
          </WorkspaceSessionProvider>
        </CsrfFetchProvider>
      </AuthGate>
    </AuthProvider>
  );
}
