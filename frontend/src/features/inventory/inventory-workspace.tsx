'use client';

import dynamic from 'next/dynamic';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  useWorkspacePathname as usePathname,
  useWorkspaceRouter as useRouter,
  useWorkspaceSearchParams as useSearchParams,
  useWorkspaceSearchReader,
} from '@/components/workspace/workspace-navigation';
import { AppIcon, Btn, EmptyState, PageHeader, PageSpinner } from '@/components/ui';
import type { AppIconName, ScopeValue } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import InventorySearch from './inventory-search';
import { InventoryScope } from './inventory-scope';
import '@/components/workspace/workspace.css';
import './inventory-workspace.css';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { InventoryDraftWorkspace } from './inventory-drafts';

const InventoryOverview = dynamic(() => import('@/app/(dashboard)/operations/inventory/page'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading inventory overview" />,
});
const InventoryLive = dynamic(() => import('@/app/(dashboard)/westsides/inventory/live/page'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading live inventory" />,
});
const InventoryBalances = dynamic(
  () => import('@/app/(dashboard)/operations/inventory-balances/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading inventory balances" /> },
);
const InventoryMovements = dynamic(
  () => import('@/app/(dashboard)/operations/inventory-movements/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading inventory movements" /> },
);
const ProductBatches = dynamic(() => import('@/app/(dashboard)/westsides/product-batches/page'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading product batches" />,
});
const Products = dynamic(() => import('@/app/(dashboard)/operations/products/page'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading products" />,
});
const ProductCategories = dynamic(
  () => import('@/app/(dashboard)/operations/product-categories/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading categories" /> },
);
const Units = dynamic(() => import('@/app/(dashboard)/operations/units/page'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading units" />,
});
const StockAdjustments = dynamic(
  () => import('@/app/(dashboard)/operations/stock-adjustments/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading stock adjustments" /> },
);
const StockDamage = dynamic(() => import('@/app/(dashboard)/westsides/stock-damage/page'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading stock damage" />,
});
const InventoryReports = dynamic(() => import('./inventory-reports'), {
  ssr: false,
  loading: () => <PageSpinner label="Loading inventory reports" />,
});

type WorkspaceTab = 'overview' | 'stock' | 'catalog' | 'controls' | 'reports';

type WorkspaceView = {
  id: string;
  label: string;
  permission: () => boolean;
  component: React.ComponentType;
};

type TabDefinition = {
  id: WorkspaceTab;
  label: string;
  icon: AppIconName;
  permission: () => boolean;
  views: WorkspaceView[];
};

const VALID_TABS = new Set<WorkspaceTab>(['overview', 'stock', 'catalog', 'controls', 'reports']);

function readScope(params: URLSearchParams): ScopeValue {
  return {
    companyId: params.get('companyId') ?? '',
    divisionId: params.get('divisionId') ?? '',
    branchId: params.get('branchId') ?? '',
  };
}

function scopeKey(scope: ScopeValue) {
  return [scope.companyId, scope.divisionId, scope.branchId].join(':');
}

export default function InventoryWorkspace() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const readSearch = useWorkspaceSearchReader();
  const scope = readScope(searchParams);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recordsRevision, setRecordsRevision] = useState(0);

  const tabs = useMemo<TabDefinition[]>(
    () => [
      {
        id: 'overview',
        label: 'Overview',
        icon: 'inventory',
        permission: () => hasPermission('inventory.view'),
        views: [
          {
            id: 'overview',
            label: 'Stock health',
            permission: () => hasPermission('inventory.view'),
            component: InventoryOverview,
          },
        ],
      },
      {
        id: 'stock',
        label: 'Stock',
        icon: 'inventory',
        permission: () =>
          hasPermission('inventory.view') ||
          hasPermission('inventory.movements.view') ||
          hasPermission('product_batches.view') ||
          hasPermission('product_batches.manage'),
        views: [
          {
            id: 'live',
            label: 'Live stock',
            permission: () => hasPermission('inventory.view'),
            component: InventoryLive,
          },
          {
            id: 'balances',
            label: 'Balances',
            permission: () => hasPermission('inventory.view'),
            component: InventoryBalances,
          },
          {
            id: 'movements',
            label: 'Movements',
            permission: () => hasPermission('inventory.movements.view'),
            component: InventoryMovements,
          },
          {
            id: 'batches',
            label: 'Batches & expiry',
            permission: () =>
              hasPermission('product_batches.view') || hasPermission('product_batches.manage'),
            component: ProductBatches,
          },
        ],
      },
      {
        id: 'catalog',
        label: 'Catalog',
        icon: 'product',
        permission: () =>
          hasPermission('products.view') ||
          hasPermission('product_categories.view') ||
          hasPermission('units.view'),
        views: [
          {
            id: 'products',
            label: 'Products',
            permission: () => hasPermission('products.view'),
            component: Products,
          },
          {
            id: 'categories',
            label: 'Categories & families',
            permission: () => hasPermission('product_categories.view'),
            component: ProductCategories,
          },
          {
            id: 'units',
            label: 'Units & conversions',
            permission: () => hasPermission('units.view'),
            component: Units,
          },
        ],
      },
      {
        id: 'controls',
        label: 'Controls',
        icon: 'approved',
        permission: () =>
          hasPermission('inventory.view') ||
          hasPermission('inventory.adjustments.create') ||
          hasPermission('inventory.adjustments.approve') ||
          hasPermission('inventory.adjustments.post') ||
          hasPermission('stock_damage.view') ||
          hasPermission('stock_damage.create') ||
          hasPermission('stock_damage.approve') ||
          hasPermission('stock_damage.post'),
        views: [
          {
            id: 'adjustments',
            label: 'Stock adjustments',
            permission: () =>
              hasPermission('inventory.view') ||
              hasPermission('inventory.adjustments.create') ||
              hasPermission('inventory.adjustments.approve') ||
              hasPermission('inventory.adjustments.post'),
            component: StockAdjustments,
          },
          {
            id: 'damage',
            label: 'Stock damage',
            permission: () =>
              hasPermission('stock_damage.view') ||
              hasPermission('stock_damage.create') ||
              hasPermission('stock_damage.approve') ||
              hasPermission('stock_damage.post'),
            component: StockDamage,
          },
        ],
      },
      {
        id: 'reports',
        label: 'Reports',
        icon: 'report',
        permission: () =>
          hasPermission('operations.reports.view') || hasPermission('westsides.reports.view'),
        views: [
          {
            id: 'inventory-reports',
            label: 'Inventory reports',
            permission: () =>
              hasPermission('operations.reports.view') || hasPermission('westsides.reports.view'),
            component: InventoryReports,
          },
        ],
      },
    ],
    [hasPermission],
  );

  const visibleTabs = tabs
    .filter((tab) => tab.permission())
    .map((tab) => ({ ...tab, views: tab.views.filter((view) => view.permission()) }))
    .filter((tab) => tab.views.length > 0);

  const requestedTab = searchParams.get('tab');
  const activeTab =
    requestedTab && VALID_TABS.has(requestedTab as WorkspaceTab)
      ? visibleTabs.find((tab) => tab.id === requestedTab)?.id
      : undefined;
  const selectedTab = visibleTabs.find((tab) => tab.id === activeTab) ?? visibleTabs[0];
  const requestedView = searchParams.get('view');
  const selectedView =
    selectedTab?.views.find((view) => view.id === requestedView) ?? selectedTab?.views[0];
  const inventorySearchQuery = searchParams.get('q') ?? '';

  const hrefFor = useCallback(
    (tabId: WorkspaceTab, viewId?: string, nextScope = scope) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tabId);
      if (viewId) params.set('view', viewId);
      else params.delete('view');
      for (const [key, value] of Object.entries(nextScope)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      return `${pathname}?${params.toString()}`;
    },
    [pathname, scope, searchParams],
  );

  const onScopeChange = (nextScope: ScopeValue) => {
    if (selectedTab && selectedView) {
      router.replace(hrefFor(selectedTab.id, selectedView.id, nextScope), { scroll: false });
    }
  };

  const onInventorySearchChange = useCallback(
    (query: string) => {
      const params = readSearch();
      const trimmed = query.trim();
      // Scope changes also notify the search control. Do not replace the URL
      // with its previous scope while a new scoped navigation is committing.
      if (trimmed === (params.get('q') ?? '')) return;
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, readSearch],
  );

  if (authLoading) return <PageSpinner />;
  if (!selectedTab || !selectedView) {
    return (
      <div className="p-6">
        <EmptyState
          title="Inventory access is restricted"
          description="Your role does not currently include an inventory workspace view."
        />
      </div>
    );
  }

  const ActiveView = selectedView.component;
  const canSearchInventory =
    hasPermission('products.view') ||
    hasPermission('inventory.view') ||
    hasPermission('inventory.adjustments.create') ||
    hasPermission('pos.create') ||
    hasPermission('sales.create') ||
    hasPermission('purchases.create');

  return (
    <div className="business-workspace inventory-workspace">
      <PageHeader
        title="Inventory"
        subtitle="Your products, stock and daily controls in one place."
        actions={
          canSearchInventory && (
            <Btn
              variant="secondary"
              aria-expanded={searchOpen}
              aria-controls="inventory-product-search"
              onClick={() => setSearchOpen((v) => !v)}
            >
              Find a product
            </Btn>
          )
        }
      />
      <nav className="inventory-workspace-nav" aria-label="Inventory sections">
        {visibleTabs.map((tab) => (
          <Link
            key={tab.id}
            href={hrefFor(tab.id, tab.views[0]?.id)}
            aria-current={tab.id === selectedTab.id ? 'page' : undefined}
          >
            <AppIcon name={tab.icon} size={16} />
            {tab.label}
          </Link>
        ))}
      </nav>
      <section className="inventory-scope-panel" aria-label="Inventory scope">
        <InventoryScope value={scope} onChange={onScopeChange} />
        {canSearchInventory && searchOpen && (
          <div id="inventory-product-search">
            <InventorySearch
              scope={scope}
              query={inventorySearchQuery}
              permissions={{
                balances: hasPermission('inventory.view'),
                movements: hasPermission('inventory.movements.view'),
                batches:
                  hasPermission('product_batches.view') || hasPermission('product_batches.manage'),
                catalog: hasPermission('products.view'),
              }}
              onQueryChange={onInventorySearchChange}
              onNavigate={(href) => router.push(href, { scroll: false })}
            />
          </div>
        )}
      </section>
      {selectedTab.views.length > 1 && (
        <nav className="inventory-view-nav" aria-label={`${selectedTab.label} views`}>
          {selectedTab.views.map((view) => (
            <Link
              key={view.id}
              href={hrefFor(selectedTab.id, view.id)}
              aria-current={view.id === selectedView.id ? 'page' : undefined}
            >
              {view.label}
            </Link>
          ))}
        </nav>
      )}
      <InventoryDraftWorkspace
        key={`${selectedTab.id}:${selectedView.id}:${scopeKey(scope)}`}
        onSaved={() => setRecordsRevision((value) => value + 1)}
      >
        <InventoryWorkspaceProvider scope={scope} searchQuery={inventorySearchQuery}>
          <div
            data-inventory-embedded="true"
            key={`${selectedTab.id}:${selectedView.id}:${scopeKey(scope)}:${recordsRevision}`}
          >
            <ActiveView />
          </div>
        </InventoryWorkspaceProvider>
      </InventoryDraftWorkspace>
    </div>
  );
}
