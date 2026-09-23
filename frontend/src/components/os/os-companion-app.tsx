'use client';

import dynamic from 'next/dynamic';
import { Component, memo, type ReactNode } from 'react';
import { PageSpinner } from '@/components/ui/loading-state';

// Explicit app adapters own any local navigation. Never retain Next route children here.
export const COMPANION_APP_IDS = [
  'invoice-desk',
  'cash-desk',
  'sales-desk',
  'documents',
  'inventory',
  'reports',
  'payroll',
] as const;
export function supportsCompanion(id: string) {
  return COMPANION_APP_IDS.some((value) => value === id);
}
const loading = () => <PageSpinner label="Opening your app" />;
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
const Navigable = dynamic(() => import('./os-navigable-app').then((m) => m.OsNavigableApp), {
  loading,
});

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="os-companion-error" role="alert">
        <h2>This app couldn’t open</h2>
        <p>Your other workspace is still available. Close this app and open it again to retry.</p>
      </div>
    ) : (
      this.props.children
    );
  }
}

export const OsCompanionApp = memo(function OsCompanionApp({ appId }: { appId: string }) {
  const content =
    appId === 'invoice-desk' ? (
      <Invoice />
    ) : appId === 'cash-desk' ? (
      <Cash />
    ) : appId === 'sales-desk' ? (
      <Sales />
    ) : appId === 'documents' ? (
      <Documents />
    ) : appId === 'inventory' || appId === 'reports' || appId === 'payroll' ? (
      <Navigable appId={appId} />
    ) : null;
  return <AppBoundary key={appId}>{content}</AppBoundary>;
});
