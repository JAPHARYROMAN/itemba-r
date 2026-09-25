'use client';
import dynamic from 'next/dynamic';
import { Component, memo, type ReactNode } from 'react';
import { PageSpinner } from '@/components/ui/loading-state';
import {
  WorkspaceNavigationProvider,
  useWorkspaceHistory,
  useWorkspaceSearchParams,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import { appForPath } from '@/lib/apps';
import { AppNavigation } from './app-navigation';
import {
  AppSurface,
  ownsInventoryPath,
  ownsPayrollPath,
  ownsReportsPath,
} from './os-navigable-app';
const loading = () => <PageSpinner label="Opening your workspace" />;
const preservesPosCounter = (from: string, to: string) =>
  from.split(/[?#]/)[0] === '/pos' && to.split(/[?#]/)[0] === '/pos';
const Invoice = dynamic(
  () => import('@/features/invoice-desk/invoice-desk').then((m) => m.InvoiceDesk),
  { loading },
);
const Cash = dynamic(() => import('@/features/cash-desk/cash-desk').then((m) => m.CashDesk), {
  loading,
});
const Sales = dynamic(() => import('@/features/sales-desk/sales-desk').then((m) => m.SalesDesk), {
  loading,
});
const Documents = dynamic(() => import('@/app/(dashboard)/documents/documents-app'), { loading });
const Pos = dynamic(() => import('./desktop-pos').then((m) => m.DesktopPos), { loading });
const Records = dynamic(() => import('@/features/records/records-app').then((m) => m.RecordsApp), {
  loading,
});
const DocumentDetail = dynamic(
  () => import('@/app/(dashboard)/group-control/documents/[id]/page'),
  { loading },
);
export function desktopAppForPath(path: string) {
  if (ownsReportsPath(path)) return 'reports';
  if (ownsInventoryPath(path)) return 'inventory';
  if (ownsPayrollPath(path)) return 'payroll';
  return appForPath(path)?.id;
}

class HostBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="desktop-app-error" role="alert">
        <h2>This window needs a fresh start</h2>
        <p>Your other windows are still available.</p>
        <button onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Surface({ appId }: { appId: string }) {
  const params = useWorkspaceSearchParams();
  const navigation = useWorkspaceHistory();
  const record = params.get('record') ?? undefined;
  const view = params.get('view');
  const path = useWorkspacePathname();

  const content =
    appId === 'documents' && /^\/group-control\/documents\/[^/]+$/.test(path) ? (
      <DocumentDetail />
    ) : appId === 'invoice-desk' ? (
      <Invoice targetRecordId={record} />
    ) : appId === 'cash-desk' ? (
      <Cash targetRecordId={record} />
    ) : appId === 'sales-desk' ? (
      <Sales targetRecordId={record} />
    ) : appId === 'pos' ? (
      <Pos />
    ) : appId === 'records' ? (
      <Records />
    ) : appId === 'documents' ? (
      <Documents initialView={view === 'library' || view === 'letter' ? view : 'home'} syncRoute />
    ) : (
      <AppSurface appId={appId as 'inventory' | 'reports' | 'payroll'} navigation={false} />
    );
  return (
    <div
      className="desktop-app-content"
      onClickCapture={(event) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
        if (
          !link ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          link.download ||
          (link.target && link.target !== '_self')
        )
          return;
        if (navigation?.owns(link.href)) {
          event.preventDefault();
          event.stopPropagation();
          navigation.navigate(link.href);
        }
      }}
    >
      <AppNavigation appId={appId} />
      {content}
    </div>
  );
}
export const DesktopAppHost = memo(function DesktopAppHost({
  appId,
  href,
  onHrefChange,
}: {
  appId: string;
  href: string;
  onHrefChange: (href: string) => void;
}) {
  return (
    <HostBoundary>
      <WorkspaceNavigationProvider
        appId={appId}
        initialHref={href}
        ownsPath={(path) => desktopAppForPath(path) === appId}
        onHrefChange={onHrefChange}
        preservesContent={appId === 'pos' ? preservesPosCounter : undefined}
      >
        <Surface appId={appId} />
      </WorkspaceNavigationProvider>
    </HostBoundary>
  );
});
