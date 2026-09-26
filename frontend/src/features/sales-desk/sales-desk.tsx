'use client';

import dynamic from 'next/dynamic';
import { ChevronRight, LayoutDashboard, Receipt, Users } from 'lucide-react';
import { AppGlyph } from '@/components/os/app-glyph';
import { PageSpinner, PermissionDeniedState } from '@/components/ui';
import {
  WorkspaceLink as Link,
  useWorkspacePathname,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { getApp } from '@/lib/apps';
import { SALES_DESK_PERMISSIONS, salesDeskRoute } from './sales-desk-routes';
import { SalesDeskOverview } from './sales-desk-overview';
import '../invoice-desk/invoice-desk.css';
import './sales-desk.css';

const loading = () => <PageSpinner label="Opening Sales Desk" />;
const Sales = dynamic(() => import('./business-sales').then((m) => m.BusinessSales), { loading });
const Sale = dynamic(() => import('./business-sale-detail').then((m) => m.BusinessSaleDetail), {
  loading,
});
const Customer = dynamic(() => import('./customer-profile').then((m) => m.CustomerProfile), {
  loading,
});
const Print = dynamic(() => import('./business-sale-print').then((m) => m.BusinessSalePrint), {
  loading,
});
const Customers = dynamic(
  () =>
    import('@/components/workspace/trading-partner-workspace').then(
      (m) => m.TradingPartnerWorkspace,
    ),
  { loading },
);
const Direct = dynamic(() => import('./direct-sales-desk').then((m) => m.DirectSalesDesk), {
  loading,
});

export function SalesDesk({ targetRecordId }: { targetRecordId?: string } = {}) {
  const { hasPermission, loading: authLoading } = useAuth();
  const params = useWorkspaceSearchParams();
  const path = useWorkspacePathname();
  const route = salesDeskRoute(path, params);
  if (authLoading) return loading();
  if (!SALES_DESK_PERMISSIONS.some((permission) => hasPermission(permission)))
    return (
      <PermissionDeniedState description="Ask your administrator for sales or customer access to open Sales Desk." />
    );

  if (route.kind === 'print') return <Print key={route.id} saleId={route.id} />;

  if (route.kind === 'direct' || targetRecordId)
    return (
      <div className="sales-desk-direct">
        <div className="sales-desk-source-bar">
          <Link href="/sales-desk">Back to business sales & customers</Link>
          <span>Direct entries · Separate register</span>
        </div>
        <Direct targetRecordId={targetRecordId ?? params.get('record') ?? undefined} />
      </div>
    );

  const active =
    route.kind === 'customer' ? 'customers' : route.kind === 'sale' ? 'sales' : route.kind;
  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      href: '/sales-desk',
      visible: true,
    },
    {
      id: 'sales',
      label: 'Sales',
      icon: Receipt,
      href: '/sales-desk/sales',
      visible: hasPermission('sales.view'),
    },
    {
      id: 'customers',
      label: 'Customers',
      icon: Users,
      href: '/sales-desk/customers',
      visible: hasPermission('customers.view'),
    },
  ];
  return (
    <div className="invoice-desk sales-desk sales-desk-business">
      <aside className="desk-rail">
        <Link href="/sales-desk" className="desk-identity" aria-label="Sales Desk home">
          <AppGlyph app={getApp('sales-desk')!} size="medium" />
          <div>
            <strong>Sales Desk</strong>
            <span>Your customers. Every sale.</span>
          </div>
        </Link>
        <nav aria-label="Sales Desk">
          {tabs
            .filter((tab) => tab.visible)
            .map((tab) => (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={active === tab.id ? 'page' : undefined}
              >
                <tab.icon size={17} />
                <span>{tab.label}</span>
                <ChevronRight size={13} />
              </Link>
            ))}
        </nav>
        <div className="desk-rail-note">
          <strong>Connected from sale to settlement.</strong>
          <p>Customer history, counter sales, orders and payments together in one workspace.</p>
          {hasPermission('sales_desk.view') && (
            <Link href="/sales-desk?source=direct&view=overview">
              Direct entries <ChevronRight size={14} />
            </Link>
          )}
        </div>
        <span className="desk-os-label">ITEMBA OS</span>
      </aside>
      <main className="desk-main sales-business-content" aria-label="Sales Desk content">
        {route.kind === 'overview' ? (
          <SalesDeskOverview />
        ) : route.kind === 'sales' ? (
          <Sales />
        ) : route.kind === 'customers' ? (
          <Customers kind="customers" workspace="sales-desk" />
        ) : route.kind === 'sale' ? (
          <Sale key={route.id} saleId={route.id} />
        ) : route.kind === 'customer' ? (
          <Customer key={route.id} customerId={route.id} />
        ) : (
          <p role="alert">
            This Sales Desk view is unavailable. <Link href="/sales-desk">Open home</Link>
          </p>
        )}
      </main>
    </div>
  );
}
