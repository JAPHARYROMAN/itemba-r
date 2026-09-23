'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, House } from 'lucide-react';
import { PageSpinner } from '@/components/ui/loading-state';
import { getApp } from '@/lib/apps';
import { payrollCompanionRoute } from '@/features/payroll/payroll-companion-routes';
import {
  WorkspaceNavigationProvider,
  useWorkspaceHistory,
  useWorkspacePathname,
  useWorkspaceSearchParams,
  WorkspaceLink,
} from '@/components/workspace/workspace-navigation';
import { isControlKind } from '@/features/reports/accounting-controls-types';
import { AppGlyph } from './app-glyph';

const loading = () => <PageSpinner label="Opening workspace" />;
const Inventory = dynamic(() => import('@/features/inventory/inventory-workspace'), { loading });
const Product = dynamic(
  () => import('@/components/workspace/product-profile').then((m) => m.ProductProfile),
  { loading },
);
const Reports = dynamic(() => import('@/features/reports/reports-app').then((m) => m.ReportsApp), {
  loading,
});
const Library = dynamic(() => import('@/app/(dashboard)/reports/library/page'), { loading });
const ReportRunner = dynamic(() => import('@/app/(dashboard)/reports/run/page'), { loading });
const Reconciliations = dynamic(
  () =>
    import('@/features/reports/reconciliation-workspace').then(
      (module) => module.ReconciliationWorkspace,
    ),
  { loading },
);
const AccountingControls = dynamic(
  () =>
    import('@/features/reports/accounting-controls-workspace').then(
      (m) => m.AccountingControlsWorkspace,
    ),
  { loading },
);
const controlPath = (path: string) => {
  const kind = path.replace('/accounting-engine/', '');
  return path.startsWith('/accounting-engine/') && isControlKind(kind) ? kind : null;
};
const Schedules = dynamic(() => import('@/app/(dashboard)/reports/scheduled/page'), { loading });
const Payroll = dynamic(
  () => import('@/features/payroll/payroll-companion').then((m) => m.PayrollCompanion),
  { loading },
);
type NavigableAppId = 'inventory' | 'reports' | 'payroll';
export const ownsPayrollPath = (path: string) => payrollCompanionRoute(path) !== null;

export const ownsInventoryPath = (path: string) =>
  path === '/inventory' || /^\/inventory\/products\/[^/]+$/.test(path);
export const ownsReportsPath = (path: string) =>
  !!controlPath(path) ||
  [
    '/reports',
    '/reports/library',
    '/reports/run',
    '/reports/scheduled',
    '/accounting-engine/bank-reconciliations',
  ].includes(path);

export function AppSurface({ appId }: { appId: NavigableAppId }) {
  const pathname = useWorkspacePathname();
  const params = useWorkspaceSearchParams();
  const history = useWorkspaceHistory()!;
  const app = getApp(appId)!;
  const content = useRef<HTMLDivElement>(null);
  const previous = useRef(history.href);
  useEffect(() => {
    if (history.href === previous.current) return;
    previous.current = history.href;
    if (document.activeElement === document.body) {
      // The route may still be loading; this stable surface precedes its content
      // in the keyboard order and does not depend on an asynchronously rendered heading.
      content.current?.focus();
    }
  }, [history.href]);
  let page;
  if (appId === 'inventory') {
    const match = /^\/inventory\/products\/([^/]+)$/.exec(pathname);
    const back = new URLSearchParams({ tab: 'catalog', view: 'products' });
    for (const key of ['companyId', 'divisionId', 'branchId', 'q']) {
      const value = params.get(key);
      if (value) back.set(key, value);
    }
    page = match ? (
      <Product
        key={match[1]}
        productId={decodeURIComponent(match[1])}
        backHref={`/inventory?${back}`}
      />
    ) : (
      <Inventory />
    );
  } else if (appId === 'payroll') page = <Payroll />;
  else
    page = controlPath(pathname) ? (
      <AccountingControls key={controlPath(pathname)!} kind={controlPath(pathname)!} />
    ) : pathname === '/accounting-engine/bank-reconciliations' ? (
      <Reconciliations />
    ) : pathname === '/reports/library' ? (
      <Library />
    ) : pathname === '/reports/run' ? (
      <ReportRunner />
    ) : pathname === '/reports/scheduled' ? (
      <Schedules />
    ) : (
      <Reports />
    );
  return (
    <div className="os-navigable-app">
      <nav className="os-app-history" aria-label={`${app.label} navigation`}>
        <button
          type="button"
          aria-label={`Back in ${app.label}`}
          title="Back"
          disabled={!history.canBack}
          onClick={history.back}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          aria-label={`Forward in ${app.label}`}
          title="Forward"
          disabled={!history.canForward}
          onClick={history.forward}
        >
          <ArrowRight size={16} />
        </button>
        <WorkspaceLink href={app.href} aria-label={`${app.label} home`} title={`${app.label} home`}>
          <House size={16} />
        </WorkspaceLink>
        <span>
          <AppGlyph app={app} size="small" />
          {app.label}
        </span>
      </nav>
      <div
        ref={content}
        className="os-app-surface"
        role="region"
        aria-label={`${app.label} content`}
        tabIndex={-1}
      >
        {page}
      </div>
    </div>
  );
}

export function OsNavigableApp({ appId }: { appId: NavigableAppId }) {
  return (
    <WorkspaceNavigationProvider
      appId={appId}
      initialHref={`/${appId}`}
      ownsPath={
        appId === 'inventory'
          ? ownsInventoryPath
          : appId === 'payroll'
            ? ownsPayrollPath
            : ownsReportsPath
      }
    >
      <AppSurface appId={appId} />
    </WorkspaceNavigationProvider>
  );
}
