'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { BreadcrumbTrail } from '@/components/aurora/navigation/BreadcrumbTrail';

const BREADCRUMB_HIDDEN_PATHS = new Set(['/', '/dashboard']);

/**
 * The pre-OS dashboard frame (sidebar + topbar + breadcrumbs), restored from
 * main so the ITEMBA OS switch can be off in production. See itemba-os-flag.ts.
 */
export function LegacyShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const showBreadcrumbs = !BREADCRUMB_HIDDEN_PATHS.has(pathname ?? '');

  return (
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
  );
}
