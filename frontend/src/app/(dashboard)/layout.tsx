'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AuthProvider } from '@/contexts/auth-context';
import { initTheme } from '@/lib/design-system/theme';
import { CommandPaletteProvider } from '@/components/aurora/command';
import { ToastProvider } from '@/components/aurora/feedback';
import { CsrfFetchProvider } from '@/components/security/CsrfFetchProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    initTheme();
  }, []);

  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}
