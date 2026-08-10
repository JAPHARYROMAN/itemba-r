'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AuthProvider } from '@/contexts/auth-context';
import { useAuth } from '@/hooks/use-auth';
import { initTheme } from '@/lib/design-system/theme';
import { CommandPaletteProvider } from '@/components/aurora/command';
import { ToastProvider } from '@/components/aurora/feedback';
import { CsrfFetchProvider } from '@/components/security/CsrfFetchProvider';
import { PageSpinner } from '@/components/ui';
import { RouteProgress } from '@/components/layout/route-progress';
import { BreadcrumbTrail } from '@/components/aurora/navigation/BreadcrumbTrail';

// Routes where a breadcrumb trail is redundant (top-level landing pages that
// would only render "Home / Dashboard").
const BREADCRUMB_HIDDEN_PATHS = new Set(['/', '/dashboard']);

const PUBLIC_DASHBOARD_PATHS = new Set(['/westsides/mobile-pos/install']);

// A user whose every permission sits in this set is a POS-only sales rep:
// their whole app is Itemba POS, and the ERP shell should never appear.
// Office users always hold other permissions, so they are never redirected.
const POS_ONLY_PERMISSIONS = new Set(['mobile_pos_lite.use']);

function isPosOnlyUser(user: { permissions: string[] } | null | undefined): boolean {
  return (
    !!user &&
    user.permissions.includes('mobile_pos_lite.use') &&
    user.permissions.every((permission) => POS_ONLY_PERMISSIONS.has(permission))
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublicDashboardPath = PUBLIC_DASHBOARD_PATHS.has(pathname ?? '');

  useEffect(() => {
    if (isPublicDashboardPath) return;
    if (loading || user) return;
    const query = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
    const returnPath = `${pathname ?? '/'}${query ? `?${query}` : ''}`;
    router.replace(`/login?from=${encodeURIComponent(returnPath)}`);
  }, [isPublicDashboardPath, loading, pathname, router, user]);

  useEffect(() => {
    if (loading || !isPosOnlyUser(user)) return;
    if (pathname?.startsWith('/mobile-pos')) return;
    router.replace('/mobile-pos');
  }, [loading, pathname, router, user]);

  if (isPublicDashboardPath) return <>{children}</>;

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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const mobilePosStandalone =
    pathname?.startsWith('/mobile-pos') || pathname?.startsWith('/westsides/mobile-pos');
  const showBreadcrumbs = !BREADCRUMB_HIDDEN_PATHS.has(pathname ?? '');

  useEffect(() => {
    initTheme();
  }, []);

  return (
    <AuthProvider>
      <AuthGate>
        <CsrfFetchProvider>
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
              <div className="flex h-full min-h-screen" style={{ background: 'var(--aurora-bg)' }}>
                <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
                  <Topbar onMenuClick={() => setSidebarOpen(true)} />
                  <main className="flex-1 overflow-auto" style={{ background: 'var(--aurora-bg)' }}>
                    {showBreadcrumbs && (
                      <div className="px-4 pt-4 sm:px-6 lg:px-8">
                        <BreadcrumbTrail />
                      </div>
                    )}
                    {children}
                  </main>
                </div>
              </div>
            )}
          </CommandPaletteProvider>
        </CsrfFetchProvider>
      </AuthGate>
    </AuthProvider>
  );
}
