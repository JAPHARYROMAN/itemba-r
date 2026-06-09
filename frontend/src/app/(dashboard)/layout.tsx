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

const PUBLIC_DASHBOARD_PATHS = new Set(['/westsides/mobile-pos/install']);

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

  if (isPublicDashboardPath) return <>{children}</>;

  if (loading || !user) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'var(--aurora-bg)' }}
      >
        <PageSpinner />
      </div>
    );
  }

  return <>{children}</>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const mobilePosStandalone = pathname?.startsWith('/westsides/mobile-pos');

  useEffect(() => {
    initTheme();
  }, []);

  return (
    <AuthProvider>
      <AuthGate>
        <CsrfFetchProvider>
          <CommandPaletteProvider>
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
