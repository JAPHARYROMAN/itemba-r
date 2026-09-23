'use client';

import { Suspense, useEffect, useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import {
  Btn,
  ErrorState,
  FormInput,
  FormSelect,
  PageHeader,
  PageSpinner,
  PageToolbar,
  PermissionDeniedState,
  type ScopeValue,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { productQuantity } from '@/components/workspace/product-form';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { InventoryScope } from './inventory-scope';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { inventoryProductHref, inventoryViewHref } from './inventory-search';
import './inventory-workspace.css';

type Amount = number | string | null;
export interface LiveStockItem {
  id: string;
  productId: string;
  companyId?: string;
  divisionId?: string | null;
  branchId?: string | null;
  product: {
    id: string;
    name: string;
    productCode?: string | null;
    sku?: string | null;
    barcode?: string | null;
  };
  location?: { id: string; name: string; code?: string | null } | null;
  quantityOnHand: Amount;
  quantityReserved: Amount;
  quantityAvailable: Amount;
  averageCost: Amount;
  totalValue: Amount;
  lastMovementAt?: string | null;
  daysSinceMovement?: number | null;
  lowThreshold?: Amount;
  riskScore?: number;
  status: 'OUT' | 'LOW' | 'OK';
}
export interface LiveStockLocation {
  locationId: string;
  locationName: string;
  locationCode: string;
  branchId: string | null;
  itemCount: number;
  out: number;
  low: number;
  ok: number;
  totalValue: Amount;
  riskValue?: Amount;
  items: LiveStockItem[];
}
export interface LiveStockResponse {
  lowThreshold: number;
  totals: {
    totalSkus: number;
    out: number;
    low: number;
    ok: number;
    totalValue: Amount;
    riskValue: Amount;
    negative: number;
    oversold: number;
    reservedSkus: number;
  };
  locations: LiveStockLocation[];
}
type StockRow = LiveStockItem & { locationId: string; locationName: string; locationCode: string };
const amount = (n: Amount | undefined) =>
  n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n);
const positive = (n: Amount) => (amount(n) ?? 0) > 0;
const negative = (n: Amount) => (amount(n) ?? 0) < 0;
const slow = (r: LiveStockItem) => (r.daysSinceMovement ?? -1) >= 30 && positive(r.quantityOnHand);
const noHistory = (r: LiveStockItem) => !r.lastMovementAt && positive(r.quantityOnHand);
export function stockReservationShare(
  r: Pick<LiveStockItem, 'quantityOnHand' | 'quantityReserved'>,
) {
  const onHand = amount(r.quantityOnHand),
    reserved = amount(r.quantityReserved);
  return onHand == null || reserved == null || onHand <= 0
    ? '—'
    : ((reserved / onHand) * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + '%';
}
const stockStatus = (r: LiveStockItem) =>
  negative(r.quantityOnHand)
    ? 'Negative on hand'
    : negative(r.quantityAvailable)
      ? 'Over-reserved'
      : r.status === 'OUT'
        ? 'Out of stock'
        : r.status === 'LOW'
          ? 'Low stock'
          : r.status === 'OK'
            ? 'In stock'
            : 'Unknown';
const lastMovement = (r: LiveStockItem) =>
  !r.lastMovementAt
    ? 'No movement recorded'
    : Number.isFinite(Date.parse(r.lastMovementAt))
      ? new Date(r.lastMovementAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '—';
type View = 'all' | 'attention' | 'reserved' | 'oversold' | 'negative' | 'slow' | 'unmoved';
const views: { value: View; label: string }[] = [
  { value: 'all', label: 'All stock' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'reserved', label: 'With reservations' },
  { value: 'oversold', label: 'Over-reserved' },
  { value: 'negative', label: 'Negative on hand' },
  { value: 'slow', label: 'No movement for 30+ days' },
  { value: 'unmoved', label: 'No movement history' },
];
function matchesView(r: LiveStockItem, view: View) {
  switch (view) {
    case 'attention':
      return r.status === 'OUT' || r.status === 'LOW' || negative(r.quantityOnHand);
    case 'reserved':
      return positive(r.quantityReserved);
    case 'oversold':
      return negative(r.quantityAvailable);
    case 'negative':
      return negative(r.quantityOnHand);
    case 'slow':
      return slow(r);
    case 'unmoved':
      return noHistory(r);
    default:
      return true;
  }
}
function LiveStock() {
  const params = useSearchParams();
  const workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission('inventory.view');
  const externalScope = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || '',
  };
  const externalScopeKey = JSON.stringify(externalScope);
  const [localScope, setLocalScope] = useState({ key: externalScopeKey, value: externalScope });
  const scope =
    workspace?.scope || (localScope.key === externalScopeKey ? localScope.value : externalScope);
  const externalSearch = workspace?.searchQuery ?? params.get('q') ?? params.get('search') ?? '';
  const [localSearch, setLocalSearch] = useState({ key: externalSearch, value: externalSearch });
  const search = localSearch.key === externalSearch ? localSearch.value : externalSearch;
  const setSearch = (value: string) => setLocalSearch({ key: externalSearch, value });
  const [debounced, setDebounced] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const externalThreshold = params.get('lowThreshold') ?? '10';
  const [localThreshold, setLocalThreshold] = useState({
    key: externalThreshold,
    value: externalThreshold,
  });
  const threshold =
    localThreshold.key === externalThreshold ? localThreshold.value : externalThreshold;
  const setThreshold = (value: string) => setLocalThreshold({ key: externalThreshold, value });
  const invalidThreshold =
    threshold.trim() === '' || !Number.isFinite(Number(threshold)) || Number(threshold) < 0;
  const searchPending = search.trim() !== debounced;
  const query = {
    ...scope,
    search: debounced,
    lowThreshold: invalidThreshold ? '' : Number(threshold),
  };
  const queryKey = JSON.stringify(query);
  const enabled = canRead && !!scope.companyId && !invalidThreshold && !searchPending;
  const result = useWorkspaceResource<LiveStockResponse>(
    '/inventory-balances/live',
    query,
    enabled,
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  useEffect(() => {
    if (!autoRefresh || !enabled || result.loading) return;
    const timer = setInterval(result.reload, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, enabled, result.loading, result.reload, queryKey]);
  const [freshness, setFreshness] = useState<{ key: string; time: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!result.data) return;
    const time = Date.now();
    setFreshness({ key: queryKey, time });
    setNow(time);
  }, [result.data, queryKey]);
  const loadedAt = freshness?.key === queryKey ? freshness.time : null;
  useEffect(() => {
    if (!loadedAt || !enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [loadedAt, enabled]);
  const [selection, setSelection] = useState<{ key: string; locationId: string; view: View }>({
    key: queryKey,
    locationId: '',
    view: 'all',
  });
  const locationId = selection.key === queryKey ? selection.locationId : '';
  const view = selection.key === queryKey ? selection.view : 'all';
  const select = (changes: Partial<Pick<typeof selection, 'locationId' | 'view'>>) =>
    setSelection({ key: queryKey, locationId, view, ...changes });
  const data = result.data;
  const locations = data?.locations || [];
  const allRows: StockRow[] = locations.flatMap((location) =>
    location.items.map((item) => ({
      ...item,
      locationId: location.locationId,
      locationName: location.locationName,
      locationCode: location.locationCode,
      branchId: item.branchId === undefined ? location.branchId : item.branchId,
    })),
  );
  const rows = allRows
    .filter((r) => (!locationId || r.locationId === locationId) && matchesView(r, view))
    .sort((a, b) => {
      if (view === 'slow') return (b.daysSinceMovement ?? -1) - (a.daysSinceMovement ?? -1);
      return (
        (b.riskScore ?? 0) - (a.riskScore ?? 0) || a.product.name.localeCompare(b.product.name)
      );
    });
  const listKey = JSON.stringify([queryKey, locationId, view]);
  const [pagination, setPagination] = useState({ key: listKey, page: 1 });
  const lastPage = Math.max(1, Math.ceil(rows.length / 20));
  const page = pagination.key === listKey ? Math.min(pagination.page, lastPage) : 1;
  const [locationPagination, setLocationPagination] = useState({ key: queryKey, page: 1 });
  const locationPages = Math.max(1, Math.ceil(locations.length / 6));
  const locationPage =
    locationPagination.key === queryKey ? Math.min(locationPagination.page, locationPages) : 1;
  const scopeFor = (r: StockRow): ScopeValue => ({
    companyId: r.companyId || scope.companyId,
    divisionId: r.divisionId === undefined ? scope.divisionId : r.divisionId || '',
    branchId: r.branchId || '',
  });
  const canReports =
    hasPermission('operations.reports.view') || hasPermission('westsides.reports.view');
  const reset = () => {
    setSearch('');
    setThreshold('10');
    select({ locationId: '', view: 'all' });
  };
  if (authLoading) return <PageSpinner />;
  if (!canRead)
    return (
      <PermissionDeniedState description="Your current role does not allow viewing live stock." />
    );
  return (
    <div className="business-workspace inventory-overview inventory-live">
      <PageHeader
        title="Live stock"
        subtitle="Stock availability and value, organised by location."
      />
      {!workspace && (
        <InventoryScope
          value={scope}
          onChange={(value) => setLocalScope({ key: externalScopeKey, value })}
        />
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search product, code, SKU or barcode…"
        collapsibleFilters
        activeFilterCount={
          [threshold !== '10', !!locationId, view !== 'all'].filter(Boolean).length
        }
        filters={
          <>
            <FormInput
              label="Fallback low-stock threshold"
              type="number"
              step="any"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              hint="Reorder level takes precedence over minimum level; non-positive values use this fallback."
            />
            <FormSelect
              label="Show stock"
              value={view}
              onChange={(e) => select({ view: e.target.value as View })}
            >
              {views.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Location in this view"
              value={locationId}
              onChange={(e) => select({ locationId: e.target.value })}
              placeholder="All locations"
              disabled={!data}
            >
              {locationId && !locations.some((l) => l.locationId === locationId) && (
                <option value={locationId}>Selected location</option>
              )}
              {locations.map((l) => (
                <option key={l.locationId} value={l.locationId}>
                  {l.locationName}
                </option>
              ))}
            </FormSelect>
            <Btn variant="ghost" onClick={reset}>
              Reset filters
            </Btn>
          </>
        }
        actions={
          <div className="inventory-actions">
            <label className="inventory-live-auto">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh every 30s
            </label>
            <Btn variant="secondary" onClick={result.reload} disabled={!enabled || result.loading}>
              Refresh stock
            </Btn>
          </div>
        }
      />
      {invalidThreshold && (
        <p role="alert" className="workspace-notice">
          Enter a finite, non-negative fallback threshold.
        </p>
      )}
      {!scope.companyId ? (
        <div className="inventory-attention">
          <div>
            <h2>Select a company to start</h2>
            <p>Choose a company above, then narrow the view to a division or branch.</p>
          </div>
        </div>
      ) : (
        <>
          {loadedAt && !searchPending && (
            <p className="inventory-register-note" role="status">
              Last successful update {new Date(loadedAt).toLocaleTimeString('en-GB')}.{' '}
              {now - loadedAt > 300000
                ? 'More than five minutes old — refresh before acting.'
                : autoRefresh
                  ? 'Automatic refresh is on.'
                  : 'Refresh when you need the latest stock.'}
            </p>
          )}
          {(result.loading || searchPending) && !invalidThreshold ? (
            <PageSpinner label="Loading live stock" />
          ) : result.error ? (
            <ErrorState message={result.error} onRetry={result.reload} />
          ) : (
            data && (
              <>
                <div
                  className="workspace-summary inventory-health-summary"
                  aria-label="Scope stock summary"
                >
                  {[
                    ['Stock positions', productQuantity(data.totals.totalSkus)],
                    ['Out of stock', productQuantity(data.totals.out)],
                    ['Low stock', productQuantity(data.totals.low)],
                    ['Over-reserved', productQuantity(data.totals.oversold)],
                    ['Stock value', catalogueMoney(data.totals.totalValue)],
                    ['Value in low/out stock', catalogueMoney(data.totals.riskValue)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="inventory-live-attention" aria-label="Stock review shortcuts">
                  <Btn
                    variant="ghost"
                    onClick={() => select({ view: 'all' })}
                    aria-pressed={view === 'all'}
                  >
                    All stock
                  </Btn>
                  <Btn
                    variant="ghost"
                    onClick={() => select({ view: 'attention' })}
                    aria-pressed={view === 'attention'}
                  >
                    Needs attention ({allRows.filter((r) => matchesView(r, 'attention')).length})
                  </Btn>
                  <Btn
                    variant="ghost"
                    onClick={() => select({ view: 'slow' })}
                    aria-pressed={view === 'slow'}
                  >
                    30+ days without movement ({allRows.filter(slow).length})
                  </Btn>
                </div>
                <p className="inventory-register-note">
                  Summary covers the selected scope and search. Stock positions are product/location
                  pairs. {productQuantity(data.totals.reservedSkus)} have reservations;{' '}
                  {productQuantity(data.totals.negative)} have negative stock on hand. Quantities
                  stay with each product so different units are not combined.
                </p>
                <details className="inventory-live-locations" open>
                  <summary>Stock by location · {locations.length}</summary>
                  <div className="inventory-location-grid">
                    {locations.slice((locationPage - 1) * 6, locationPage * 6).map((location) => (
                      <button
                        key={location.locationId}
                        aria-pressed={locationId === location.locationId}
                        onClick={() =>
                          select({
                            locationId:
                              locationId === location.locationId ? '' : location.locationId,
                          })
                        }
                      >
                        <strong>{location.locationName}</strong>
                        <span>
                          {location.locationCode || 'No location code'} ·{' '}
                          {productQuantity(location.itemCount)} positions
                        </span>
                        <span>
                          {location.out} out · {location.low} low · {location.ok} in stock
                        </span>
                        <b>{catalogueMoney(location.totalValue)}</b>
                      </button>
                    ))}
                  </div>
                  {!locations.length && (
                    <p className="inventory-register-note">
                      No stock positions match this scope and search.
                    </p>
                  )}
                  {locationPages > 1 && (
                    <nav className="inventory-actions" aria-label="Location pages">
                      <Btn
                        variant="ghost"
                        disabled={locationPage <= 1}
                        onClick={() =>
                          setLocationPagination({ key: queryKey, page: locationPage - 1 })
                        }
                      >
                        Previous locations
                      </Btn>
                      <span>
                        {locationPage} of {locationPages}
                      </span>
                      <Btn
                        variant="ghost"
                        disabled={locationPage >= locationPages}
                        onClick={() =>
                          setLocationPagination({ key: queryKey, page: locationPage + 1 })
                        }
                      >
                        Next locations
                      </Btn>
                    </nav>
                  )}
                </details>
                <div className="inventory-section-heading">
                  <div>
                    <h2>{views.find((v) => v.value === view)?.label}</h2>
                    <p>
                      {locationId
                        ? locations.find((l) => l.locationId === locationId)?.locationName ||
                          'Selected location'
                        : 'All locations'}{' '}
                      · {rows.length} matching stock positions
                    </p>
                  </div>
                  {locationId && (
                    <Btn variant="ghost" onClick={() => select({ locationId: '' })}>
                      Show all locations
                    </Btn>
                  )}
                </div>
                <RecordBrowser<StockRow>
                  title="Stock positions"
                  records={rows.slice((page - 1) * 20, page * 20)}
                  total={rows.length}
                  page={page}
                  pageSize={20}
                  onPage={(p) => setPagination({ key: listKey, page: p })}
                  name={(r) => r.product.name}
                  reference={(r) =>
                    [r.product.productCode || r.product.sku || r.productId, r.locationName].join(
                      ' · ',
                    )
                  }
                  status={stockStatus}
                  fields={[
                    { label: 'Available', value: (r) => productQuantity(r.quantityAvailable) },
                    { label: 'Stock value', value: (r) => catalogueMoney(r.totalValue) },
                  ]}
                  details={[
                    { label: 'On hand', value: (r) => productQuantity(r.quantityOnHand) },
                    { label: 'Reserved', value: (r) => productQuantity(r.quantityReserved) },
                    { label: 'Reservation share', value: stockReservationShare },
                    { label: 'Average cost', value: (r) => catalogueMoney(r.averageCost) },
                    { label: 'Low threshold', value: (r) => productQuantity(r.lowThreshold) },
                    { label: 'Location', value: (r) => r.locationName },
                    { label: 'SKU', value: (r) => r.product.sku || '—' },
                    { label: 'Barcode', value: (r) => r.product.barcode || '—' },
                    { label: 'Last movement', value: lastMovement },
                    {
                      label: 'Movement age',
                      value: (r) =>
                        r.daysSinceMovement == null ? 'Unknown' : r.daysSinceMovement + ' days',
                    },
                  ]}
                  actions={(r) => (
                    <>
                      {hasPermission('products.view') && (
                        <Link
                          className="workspace-secondary-link"
                          href={inventoryProductHref(scopeFor(r), r.productId, search)}
                        >
                          Open product
                        </Link>
                      )}
                      {hasPermission('inventory.movements.view') && (
                        <Link
                          className="workspace-secondary-link"
                          href={inventoryViewHref(scopeFor(r), 'stock', 'movements', {
                            productId: r.productId,
                          })}
                        >
                          Movements
                        </Link>
                      )}
                      {hasPermission('product_batches.view') && (
                        <Link
                          className="workspace-secondary-link"
                          href={inventoryViewHref(scopeFor(r), 'stock', 'batches', {
                            productId: r.productId,
                          })}
                        >
                          Batches
                        </Link>
                      )}
                      {hasPermission('stock_damage.view') && (
                        <Link
                          className="workspace-secondary-link"
                          href={inventoryViewHref(scopeFor(r), 'controls', 'damage')}
                        >
                          Damage register
                        </Link>
                      )}
                      {canReports && (
                        <Link
                          className="workspace-secondary-link"
                          href={inventoryViewHref(scopeFor(r), 'reports', 'inventory-reports')}
                        >
                          Stock reports
                        </Link>
                      )}
                    </>
                  )}
                  empty="No stock positions match this view. Change the location, review filter or search."
                />
                <div className="inventory-actions" aria-label="Inventory workspaces">
                  {hasPermission('product_batches.view') && (
                    <Link
                      className="workspace-secondary-link"
                      href={inventoryViewHref(scope, 'stock', 'batches')}
                    >
                      Open batches
                    </Link>
                  )}
                  {hasPermission('stock_damage.view') && (
                    <Link
                      className="workspace-secondary-link"
                      href={inventoryViewHref(scope, 'controls', 'damage')}
                    >
                      Open damage register
                    </Link>
                  )}
                  {canReports && (
                    <Link
                      className="workspace-secondary-link"
                      href={inventoryViewHref(scope, 'reports', 'inventory-reports')}
                    >
                      Open stock reports
                    </Link>
                  )}
                </div>
                <p className="inventory-register-note">
                  Out of stock means on hand is zero or below. Low stock means available quantity is
                  at or below the product’s threshold; the fallback is{' '}
                  {productQuantity(data.lowThreshold)}. Over-reserved means available quantity is
                  negative. The 30-day review includes stocked products with recorded movement
                  dates; use No movement history for undated stock.
                </p>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
export default function InventoryLive() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <LiveStock />
    </Suspense>
  );
}
