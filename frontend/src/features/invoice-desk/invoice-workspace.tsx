'use client';
import dynamic from 'next/dynamic';
import { AppGlyph } from '@/components/os/app-glyph';
import { getApp } from '@/lib/apps';
import { PageSpinner, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  WorkspaceLink as Link,
  useWorkspacePathname,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { TradingPartnerWorkspace } from '@/components/workspace/trading-partner-workspace';
import { InvoiceSupplierReconciliation } from './invoice-supplier-reconciliation';
import { invoiceRoute, invoiceSections } from './invoice-routes';
import './invoice-desk.css';
import { BusinessInvoiceDetail } from './business-invoice-detail';
const loading = () => <PageSpinner label="Opening Invoice Desk" />;
const Direct = dynamic(() => import('./invoice-desk').then((m) => m.InvoiceDesk), { loading });
const Invoices = dynamic(() => import('@/app/(dashboard)/procurement/supplier-invoices/page'), {
  loading,
});
const Purchases = dynamic(() => import('@/app/(dashboard)/operations/purchase-orders/page'), {
  loading,
});
const Purchase = dynamic(() => import('@/app/(dashboard)/operations/purchase-orders/[id]/page'), {
  loading,
});
const PurchasePrint = dynamic(
  () => import('@/app/(dashboard)/operations/purchase-orders/[id]/print/page'),
  { loading },
);
const Receiving = dynamic(() => import('@/app/(dashboard)/procurement/grns/page'), { loading });
const Matching = dynamic(() => import('@/app/(dashboard)/procurement/three-way-matching/page'), {
  loading,
});
const Drafts = dynamic(
  () => import('@/app/(dashboard)/operations/purchase-orders/order-drafts/page'),
  { loading },
);
const Draft = dynamic(
  () => import('@/app/(dashboard)/operations/purchase-orders/order-drafts/[id]/page'),
  { loading },
);
const DraftPrint = dynamic(
  () => import('@/app/(dashboard)/operations/purchase-orders/order-drafts/[id]/print/page'),
  { loading },
);
const Supplier = dynamic(
  () =>
    import('@/app/(dashboard)/operations/suppliers/_components/SupplierProfile').then(
      (m) => m.SupplierProfile,
    ),
  { loading },
);

export function InvoiceWorkspace({ targetRecordId }: { targetRecordId?: string } = {}) {
  const { hasPermission, loading: authLoading } = useAuth();
  const path = useWorkspacePathname(),
    params = useWorkspaceSearchParams();
  const route = invoiceRoute(path, params);
  if (authLoading) return loading();
  if (targetRecordId || route.kind === 'direct')
    return (
      <>
        <div className="desk-source-bar">
          <Link href="/invoice-desk">Back to purchasing & suppliers</Link>
          <span>Direct invoice register · separately reviewed in Accounting</span>
        </div>
        <Direct targetRecordId={targetRecordId ?? params.get('record') ?? undefined} />
      </>
    );
  if (route.kind === 'unavailable')
    return (
      <p role="alert">
        This view is unavailable. <Link href="/invoice-desk">Open Invoice Desk</Link>
      </p>
    );
  const section = invoiceSections.find(
    (s) =>
      s.id ===
      (route.kind === 'supplier'
        ? 'suppliers'
        : ['purchase', 'print'].includes(route.kind)
          ? 'purchases'
          : ['draft', 'draftPrint'].includes(route.kind)
            ? 'drafts'
            : route.kind),
  );
  if (
    section &&
    !hasPermission(
      route.kind === 'invoices' && params.get('businessRecord')
        ? 'supplier_invoices.view'
        : section.permission,
    )
  )
    return (
      <PermissionDeniedState description="Your role does not have access to this purchasing workflow." />
    );
  if (route.kind === 'draftPrint') return <DraftPrint />;
  if (route.kind === 'print') return <PurchasePrint />;
  return (
    <div className="invoice-desk">
      <aside className="desk-rail">
        <Link href="/invoice-desk" className="desk-identity">
          <AppGlyph app={getApp('invoice-desk')!} size="small" />
          <div>
            <strong>Invoice Desk</strong>
            <span>Purchasing, connected.</span>
          </div>
        </Link>
        <nav aria-label="Invoice Desk workflows">
          <Link href="/invoice-desk" aria-current={route.kind === 'overview' ? 'page' : undefined}>
            Overview
          </Link>
          {invoiceSections
            .filter((s) => hasPermission(s.permission))
            .map((s) => (
              <Link
                key={s.id}
                href={s.href}
                aria-current={section?.id === s.id ? 'page' : undefined}
              >
                {s.label}
              </Link>
            ))}
        </nav>
        <div className="desk-rail-note">
          <strong>Purchase to payment.</strong>
          <p>Orders, stock receipts, invoices and supplier balances share the same records.</p>
          {hasPermission('payables.view') && <Link href="/cash-desk/payables">Pay suppliers</Link>}
          {hasPermission('invoice_desk.view') && (
            <Link href="/invoice-desk?source=direct&view=overview">Direct invoice register</Link>
          )}
        </div>
      </aside>
      <main className="desk-main" aria-label="Invoice Desk content">
        {route.kind === 'overview' ? (
          <>
            <header className="desk-header">
              <div>
                <p className="desk-eyebrow">ITEMBA OS · PURCHASING</p>
                <h1>Every purchase, connected.</h1>
                <p>
                  Start with a supplier and purchase order, receive stock, review its invoice, then
                  pay the balance.
                </p>
              </div>
            </header>
            <div className="grid gap-4 sm:grid-cols-2">
              {invoiceSections
                .filter((s) => hasPermission(s.permission))
                .map((s) => (
                  <Link className="rounded-xl border p-5" key={s.id} href={s.href}>
                    <strong>{s.label}</strong>
                    <p>{s.description}</p>
                  </Link>
                ))}
            </div>
            <InvoiceSupplierReconciliation />
          </>
        ) : route.kind === 'suppliers' ? (
          <>
            <TradingPartnerWorkspace kind="suppliers" workspace="invoice-desk" embedded />
            <InvoiceSupplierReconciliation />
          </>
        ) : route.kind === 'supplier' ? (
          <Supplier key={route.id} supplierId={route.id} backHref="/invoice-desk?view=suppliers" />
        ) : route.kind === 'invoices' ? (
          params.get('businessRecord') ? (
            <BusinessInvoiceDetail id={params.get('businessRecord')!} />
          ) : (
            <Invoices />
          )
        ) : route.kind === 'purchases' ? (
          <Purchases />
        ) : route.kind === 'drafts' ? (
          <Drafts />
        ) : route.kind === 'draft' ? (
          <Draft />
        ) : route.kind === 'purchase' ? (
          <Purchase />
        ) : route.kind === 'receiving' ? (
          <Receiving />
        ) : (
          <Matching />
        )}
      </main>
    </div>
  );
}
