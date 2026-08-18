'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppIcon, EmptyState, PageSpinner, ScopeSelector } from '@/components/ui';
import type { AppIconName, ScopeValue } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import InventorySearch from './inventory-search';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';

const InventoryOverview = dynamic(
  () => import('@/app/(dashboard)/operations/inventory/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading inventory overview" /> },
);
const InventoryLive = dynamic(
  () => import('@/app/(dashboard)/westsides/inventory/live/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading live inventory" /> },
);
const InventoryBalances = dynamic(
  () => import('@/app/(dashboard)/operations/inventory-balances/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading inventory balances" /> },
);
const InventoryMovements = dynamic(
  () => import('@/app/(dashboard)/operations/inventory-movements/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading inventory movements" /> },
);
const ProductBatches = dynamic(
  () => import('@/app/(dashboard)/westsides/product-batches/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading product batches" /> },
);
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
const StockDamage = dynamic(
  () => import('@/app/(dashboard)/westsides/stock-damage/page'),
  { ssr: false, loading: () => <PageSpinner label="Loading stock damage" /> },
);
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

function listFromResponse<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== 'object') return [];
  const response = payload as { data?: unknown };
  if (Array.isArray(response.data)) return response.data as T[];
  if (response.data && typeof response.data === 'object') {
    const nested = response.data as { data?: unknown };
    if (Array.isArray(nested.data)) return nested.data as T[];
  }
  return [];
}

export default function InventoryWorkspace() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<ScopeValue>(() => readScope(searchParams));

  useEffect(() => {
    setScope(readScope(searchParams));
  }, [searchParams]);

  useEffect(() => {
    const current = readScope(searchParams);
    // Older inventory links had a branch filter without its parent division.
    // Resolve the parent once so the new hierarchical scope is both valid and
    // visible, rather than silently dropping the branch filter on migration.
    if (!current.companyId || current.divisionId || !current.branchId) return;

    let cancelled = false;
    fetch(`/api/backend/branches?companyId=${encodeURIComponent(current.companyId)}&limit=500`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        const branch = listFromResponse<{ id: string; divisionId?: string | null }>(payload).find(
          (candidate) => candidate.id === current.branchId,
        );
        if (!branch?.divisionId) return;

        const nextScope = { ...current, divisionId: branch.divisionId };
        setScope(nextScope);
        const params = new URLSearchParams(searchParams.toString());
        params.set('divisionId', branch.divisionId);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [pathname, router, searchParams]);

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
  const selectedView = selectedTab?.views.find((view) => view.id === requestedView) ?? selectedTab?.views[0];
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
    setScope(nextScope);
    if (selectedTab && selectedView) {
      router.replace(hrefFor(selectedTab.id, selectedView.id, nextScope), { scroll: false });
    }
  };

  const onInventorySearchChange = useCallback(
    (query: string) => {
      const params = new URLSearchParams(window.location.search);
      const trimmed = query.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

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
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
        <div>
          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--aurora-accent-text)' }}>
            Operations
          </p>
          <h1 className="mt-1 text-[22px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Inventory
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            Product catalog, stock health, controls, and reporting in one workspace.
          </p>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Inventory sections" style={{ borderColor: 'var(--aurora-border)' }}>
        {visibleTabs.map((tab) => {
          const active = tab.id === selectedTab.id;
          return (
            <Link
              key={tab.id}
              href={hrefFor(tab.id, tab.views[0]?.id)}
              className="flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: active ? 'var(--aurora-primary)' : 'var(--aurora-text-secondary)',
                borderColor: active ? 'var(--aurora-primary)' : 'transparent',
              }}
              aria-current={active ? 'page' : undefined}
            >
              <AppIcon name={tab.icon} size={16} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <section className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}>
        <ScopeSelector
          value={scope}
          onChange={onScopeChange}
          autoSelectSingleCompany
          labels={{ company: 'Company', division: 'Division', branch: 'Branch' }}
        />
        {canSearchInventory && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
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
        <nav className="flex flex-wrap gap-2" aria-label={`${selectedTab.label} views`}>
          {selectedTab.views.map((view) => {
            const active = view.id === selectedView.id;
            return (
              <Link
                key={view.id}
                href={hrefFor(selectedTab.id, view.id)}
                className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  borderColor: active ? 'var(--aurora-primary)' : 'var(--aurora-border)',
                  background: active ? 'var(--aurora-primary-subtle)' : 'transparent',
                  color: active ? 'var(--aurora-primary)' : 'var(--aurora-text-secondary)',
                }}
                aria-current={active ? 'page' : undefined}
              >
                {view.label}
              </Link>
            );
          })}
        </nav>
      )}

      <InventoryWorkspaceProvider scope={scope} searchQuery={inventorySearchQuery}>
        <div data-inventory-embedded="true" key={`${selectedTab.id}:${selectedView.id}:${scopeKey(scope)}`}>
          <ActiveView />
        </div>
      </InventoryWorkspaceProvider>
    </div>
  );
}
