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

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    const query = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
    const returnPath = `${pathname ?? '/'}${query ? `?${query}` : ''}`;
    router.replace(`/login?from=${encodeURIComponent(returnPath)}`);
  }, [loading, pathname, router, user]);

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

  useEffect(() => {
    initTheme();
  }, []);

  return (
    <AuthProvider>
      <AuthGate>
        <CsrfFetchProvider>
          <CommandPaletteProvider>
            <ToastProvider />
            <div className="flex h-full min-h-screen" style={{ background: 'var(--aurora-bg)' }}>
              <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
              <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
                <Topbar onMenuClick={() => setSidebarOpen(true)} />
                <main className="flex-1 overflow-auto" style={{ background: 'var(--aurora-bg)' }}>
                  {children}
                </main>
              </div>
            </div>
          </CommandPaletteProvider>
        </CsrfFetchProvider>
      </AuthGate>
    </AuthProvider>
  );
}
