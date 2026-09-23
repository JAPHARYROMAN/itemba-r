'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import {
  Btn,
  ErrorState,
  FormSelect,
  PageHeader,
  PageSpinner,
  PageToolbar,
  PermissionDeniedState,
  type ScopeValue,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { CatalogueChoiceError } from '@/components/workspace/catalogue-editors';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { productLabel, productQuantity } from '@/components/workspace/product-form';
import { backendAllPages } from '@/lib/backend-all-pages';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { InventoryScope } from './inventory-scope';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { inventoryProductHref, inventoryViewHref } from './inventory-search';
import './inventory-workspace.css';

interface Choice {
  id: string;
  name: string;
  code?: string | null;
  brand?: string | null;
}
type Amount = number | string | null;
export interface InventoryBalance {
  id: string;
  productId: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  quantityOnHand: Amount;
  quantityReserved: Amount;
  quantityAvailable?: Amount;
  reorderLevel?: Amount;
  averageCost: Amount;
  totalValue: Amount;
  lastMovementAt?: string | null;
  daysSinceMovement?: number | null;
  isStale?: boolean;
  stockStatus?: string;
  costStatus?: string;
  product?: {
    id: string;
    name: string;
    productCode?: string | null;
    sku?: string | null;
    barcode?: string | null;
    reorderLevel?: Amount;
    minimumStockLevel?: Amount;
    category?: Choice | null;
    productFamily?: Choice | null;
  } | null;
  company?: Choice | null;
  division?: Choice | null;
  branch?: Choice | null;
}
interface Summary {
  totalSkus: number;
  totalValue: number;
  outOfStock: number;
  lowStock: number;
  oversold: number;
  missingCost: number;
  staleStock: number;
}
const quantity = (value: Amount | undefined) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function balanceAvailable(row: InventoryBalance) {
  if (row.quantityAvailable != null && row.quantityAvailable !== '')
    return quantity(row.quantityAvailable);
  const onHand = quantity(row.quantityOnHand),
    reserved = quantity(row.quantityReserved);
  return onHand == null || reserved == null ? null : onHand - reserved;
}
const reorder = (r: InventoryBalance) =>
  r.reorderLevel ?? r.product?.reorderLevel ?? r.product?.minimumStockLevel ?? 10;
function stockStatus(r: InventoryBalance) {
  if (r.stockStatus) return r.stockStatus;
  const available = balanceAvailable(r),
    onHand = quantity(r.quantityOnHand),
    level = quantity(reorder(r));
  if (available == null || onHand == null || level == null) return 'UNKNOWN';
  return available < 0
    ? 'OVERSOLD'
    : onHand <= 0
      ? 'OUT_OF_STOCK'
      : onHand <= level
        ? 'LOW_STOCK'
        : 'IN_STOCK';
}
function costStatus(r: InventoryBalance) {
  if (r.costStatus) return productLabel(r.costStatus);
  const cost = quantity(r.averageCost);
  return cost == null ? 'Unknown' : cost > 0 ? 'Has cost' : 'Missing cost';
}
const lastMovement = (r: InventoryBalance) =>
  !r.lastMovementAt
    ? 'No movement recorded'
    : Number.isFinite(Date.parse(r.lastMovementAt))
      ? new Date(r.lastMovementAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '—';
const locationLabel = (choice: Choice | null | undefined, fallback: string) =>
  choice ? [choice.code, choice.name].filter(Boolean).join(' · ') : fallback;
function exportRows(rows: InventoryBalance[]) {
  return rows.map((r) => ({
    'Product code': r.product?.productCode || '',
    Product: r.product?.name || r.productId,
    SKU: r.product?.sku || '',
    Barcode: r.product?.barcode || '',
    Category: r.product?.category?.name || '',
    Family: r.product?.productFamily?.name || '',
    Branch: locationLabel(r.branch, r.branchId || ''),
    Division: locationLabel(r.division, r.divisionId || ''),
    Company: locationLabel(r.company, r.companyId),
    'Stock status': productLabel(stockStatus(r)),
    'Cost status': costStatus(r),
    'On hand': quantity(r.quantityOnHand),
    Reserved: quantity(r.quantityReserved),
    Available: balanceAvailable(r),
    'Reorder level': quantity(reorder(r)),
    'Average cost': quantity(r.averageCost),
    'Stock value': quantity(r.totalValue),
    'Last movement': lastMovement(r),
    'Days since movement': r.daysSinceMovement ?? '',
  }));
}

function Balances() {
  const params = useSearchParams();
  const { hasPermission, loading: authLoading } = useAuth();
  const workspace = useInventoryWorkspace();
  const canRead = !authLoading && hasPermission('inventory.view');
  const [local, setLocal] = useState<ScopeValue>(() => ({
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || params.get('locationId') || '',
  }));
  const scope = workspace?.scope || local;
  const scopeKey = JSON.stringify(scope);
  const [selection, setSelection] = useState({
    scope: scopeKey,
    categoryId: '',
    productFamilyId: '',
    productId: params.get('productId') || '',
  });
  const { categoryId, productFamilyId, productId } =
    selection.scope === scopeKey
      ? selection
      : { categoryId: '', productFamilyId: '', productId: '' };
  const select = (values: Partial<typeof selection>) =>
    setSelection({ scope: scopeKey, categoryId, productFamilyId, productId, ...values });
  const externalSearch = workspace?.searchQuery ?? params.get('q') ?? '';
  const [searchState, setSearchState] = useState({
    external: externalSearch,
    value: externalSearch,
  });
  const search = searchState.external === externalSearch ? searchState.value : externalSearch;
  const setSearch = (value: string) => setSearchState({ external: externalSearch, value });
  const [debounced, setDebounced] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [stock, setStock] = useState(
    params.get('stockStatus') ||
      (params.get('lowStock') === '1' || params.get('stock') === 'low' ? 'LOW_STOCK' : ''),
  );
  const [cost, setCost] = useState(''),
    [stale, setStale] = useState('');
  const filters = {
    ...scope,
    categoryId,
    productFamilyId,
    productId,
    search: debounced,
    stockStatus: stock,
    costStatus: cost,
    staleDays: stale,
  };
  const filterKey = JSON.stringify(filters);
  const [pagination, setPagination] = useState({ key: filterKey, page: 1 });
  const page = pagination.key === filterKey ? pagination.page : 1;
  const result = useWorkspaceResource<{ data: InventoryBalance[]; total: number }>(
    '/inventory-balances',
    { ...filters, page, limit: 25 },
    canRead,
  );
  const summary = useWorkspaceResource<Summary>('/inventory-balances/summary', filters, canRead);
  const categories = useWorkspaceChoices<Choice>(
    '/product-categories',
    { companyId: scope.companyId || undefined },
    canRead && hasPermission('product_categories.view'),
  );
  const canFamilies = hasPermission('products.view') || hasPermission('operations.dashboard.view');
  const families = useWorkspaceChoices<Choice>(
    '/products/families',
    {
      companyId: scope.companyId || undefined,
      divisionId: scope.divisionId || undefined,
      categoryId: categoryId || undefined,
    },
    canRead && canFamilies,
  );
  const [exportBusy, setExportBusy] = useState(false),
    [exportError, setExportError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    controllerRef.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => controllerRef.current?.abort();
  }, [filterKey, search, canRead]);
  const exportAll = async (format: 'csv' | 'pdf') => {
    if (!canRead || result.loading || result.error || exportBusy || search.trim() !== debounced)
      return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const rows = exportRows(
        await backendAllPages<InventoryBalance>('/inventory-balances', filters, controller.signal),
      );
      if (controller.signal.aborted) return;
      if (!rows.length) throw new Error('No matching balances remain. Refresh this view.');
      if (format === 'csv')
        downloadTextFile('inventory-balances.csv', 'text/csv;charset=utf-8', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            'PDF supports up to 5,000 records. Narrow the filters or use CSV for the complete register.',
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: 'Inventory balances',
          companyId: scope.companyId || undefined,
          subtitle:
            Object.entries(filters)
              .filter(([, v]) => v)
              .map(([k, v]) => `${productLabel(k.replace(/([A-Z])/g, '_$1'))}: ${v}`)
              .join(' · ') || 'All accessible stock balances',
          columns,
          rows: rows.map((r) => columns.map((c) => cellToString(r[c as keyof typeof r]))),
          numericColumns: [11, 12, 13, 14, 15, 16, 18],
          baseName: 'inventory-balances',
        });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setExportError(error instanceof Error ? error.message : 'Unable to export balances.');
    } finally {
      if (!controller.signal.aborted) setExportBusy(false);
    }
  };
  if (authLoading) return <PageSpinner />;
  if (!canRead)
    return (
      <PermissionDeniedState description="Your current role does not allow viewing inventory balances." />
    );
  const busy =
    result.loading ||
    exportBusy ||
    !!result.error ||
    !result.data?.data.length ||
    search.trim() !== debounced;
  const selectedOptions = (rows: Choice[], value: string) => (
    <>
      {value && !rows.some((r) => r.id === value) && <option value={value}>{value}</option>}
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {[r.brand, r.name].filter(Boolean).join(' · ')}
        </option>
      ))}
    </>
  );
  const reset = () => {
    setSearch('');
    setStock('');
    setCost('');
    setStale('');
    select({ categoryId: '', productFamilyId: '', productId: '' });
  };
  const rowScope = (r: InventoryBalance): ScopeValue => ({
    companyId: r.companyId,
    divisionId: r.divisionId || '',
    branchId: r.branchId || '',
  });
  return (
    <div className="business-workspace inventory-balances inventory-overview">
      <PageHeader
        title="Inventory balances"
        subtitle="Availability, cost and movement age for every stock position."
      />
      {!workspace && <InventoryScope value={local} onChange={setLocal} />}
      {summary.loading ? (
        <PageSpinner label="Loading balance summary" />
      ) : summary.error ? (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      ) : (
        summary.data && (
          <div
            className="workspace-summary inventory-health-summary"
            aria-label="Filtered balance summary"
          >
            {[
              ['Stock positions', productQuantity(summary.data.totalSkus)],
              ['Stock value', catalogueMoney(summary.data.totalValue)],
              ['Out of stock', productQuantity(summary.data.outOfStock)],
              ['Low stock', productQuantity(summary.data.lowStock)],
              ['Oversold', productQuantity(summary.data.oversold)],
              ['Missing cost', productQuantity(summary.data.missingCost)],
              ['Stale stock', stale ? productQuantity(summary.data.staleStock) : 'Choose an age'],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )
      )}
      <p className="inventory-register-note">
        Totals cover all matching product and branch pairs. Oversold means reserved stock exceeds
        stock on hand. CSV includes every matching page; PDF supports up to 5,000 records.
      </p>
      <PageToolbar
        collapsibleFilters
        activeFilterCount={
          [categoryId, productFamilyId, productId, stock, cost, stale].filter(Boolean).length
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search product name, code, SKU, barcode…"
        filters={
          <>
            <FormSelect
              label="Category"
              value={categoryId}
              onChange={(e) => select({ categoryId: e.target.value, productFamilyId: '' })}
              disabled={!hasPermission('product_categories.view') || categories.loading}
              placeholder="All categories"
            >
              {selectedOptions(categories.rows, categoryId)}
            </FormSelect>
            <FormSelect
              label="Product family"
              value={productFamilyId}
              onChange={(e) => select({ productFamilyId: e.target.value })}
              disabled={!canFamilies || families.loading}
              placeholder="All families"
            >
              {selectedOptions(families.rows, productFamilyId)}
            </FormSelect>
            <FormSelect
              label="Stock status"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              placeholder="All stock"
            >
              {['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'OVERSOLD'].map((v) => (
                <option key={v} value={v}>
                  {productLabel(v)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Cost status"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="All costs"
            >
              <option value="HAS_COST">Has cost</option>
              <option value="MISSING_COST">Missing cost</option>
            </FormSelect>
            <FormSelect
              label="Movement age"
              value={stale}
              onChange={(e) => setStale(e.target.value)}
              placeholder="Any age"
            >
              {[30, 60, 90, 180].map((v) => (
                <option key={v} value={v}>
                  {v}+ days or never moved
                </option>
              ))}
            </FormSelect>
            {productId && <p className="inventory-register-note">Selected product: {productId}</p>}
            <Btn variant="ghost" onClick={reset}>
              Reset filters
            </Btn>
          </>
        }
        actions={
          <div className="inventory-actions">
            <Btn
              variant="secondary"
              onClick={() => {
                result.reload();
                summary.reload();
              }}
              disabled={result.loading || summary.loading}
            >
              Refresh balances
            </Btn>
            <Btn variant="secondary" disabled={busy} onClick={() => void exportAll('csv')}>
              Export CSV
            </Btn>
            <Btn variant="secondary" disabled={busy} onClick={() => void exportAll('pdf')}>
              Export PDF
            </Btn>
          </div>
        }
      />
      <CatalogueChoiceError label="Category" source={categories} />
      <CatalogueChoiceError label="Family" source={families} />
      {exportError && (
        <p role="alert" className="workspace-notice">
          {exportError}
        </p>
      )}
      <RecordBrowser<InventoryBalance>
        title="Stock balances"
        records={result.data?.data || []}
        total={result.data?.total || 0}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        page={page}
        pageSize={25}
        onPage={(p) => setPagination({ key: filterKey, page: p })}
        name={(r) => r.product?.name || 'Product unavailable'}
        reference={(r) =>
          [
            r.product?.productCode || r.product?.sku || r.productId,
            locationLabel(r.branch, 'No branch'),
          ].join(' · ')
        }
        status={(r) => productLabel(stockStatus(r))}
        fields={[
          { label: 'Available', value: (r) => productQuantity(balanceAvailable(r)) },
          { label: 'Stock value', value: (r) => catalogueMoney(r.totalValue) },
        ]}
        details={[
          { label: 'On hand', value: (r) => productQuantity(r.quantityOnHand) },
          { label: 'Reserved', value: (r) => productQuantity(r.quantityReserved) },
          { label: 'Reorder level', value: (r) => productQuantity(reorder(r)) },
          { label: 'Average cost', value: (r) => catalogueMoney(r.averageCost) },
          { label: 'Cost status', value: costStatus },
          { label: 'Category', value: (r) => r.product?.category?.name || 'Uncategorised' },
          { label: 'Family', value: (r) => r.product?.productFamily?.name || 'No family' },
          { label: 'SKU', value: (r) => r.product?.sku || '—' },
          { label: 'Barcode', value: (r) => r.product?.barcode || '—' },
          { label: 'Company', value: (r) => locationLabel(r.company, r.companyId) },
          {
            label: 'Division',
            value: (r) => locationLabel(r.division, r.divisionId || 'Company-wide'),
          },
          { label: 'Branch', value: (r) => locationLabel(r.branch, r.branchId || 'No branch') },
          { label: 'Last movement', value: lastMovement },
          {
            label: 'Movement age',
            value: (r) =>
              r.daysSinceMovement == null
                ? 'No movement history'
                : `${r.daysSinceMovement} ${r.daysSinceMovement === 1 ? 'day' : 'days'}`,
          },
        ]}
        actions={(r) => (
          <>
            {hasPermission('inventory.movements.view') && (
              <Link
                className="workspace-secondary-link"
                href={inventoryViewHref(rowScope(r), 'stock', 'movements', {
                  productId: r.productId,
                })}
              >
                View movements
              </Link>
            )}
            {hasPermission('products.view') && (
              <Link
                className="workspace-secondary-link"
                href={inventoryProductHref(rowScope(r), r.productId, search)}
              >
                Open product
              </Link>
            )}
            {r.product?.category?.id && (
              <Btn
                variant="secondary"
                onClick={() =>
                  select({
                    categoryId: r.product!.category!.id,
                    productFamilyId: '',
                    productId: '',
                  })
                }
              >
                Same category
              </Btn>
            )}
            {r.product?.productFamily?.id && (
              <Btn
                variant="secondary"
                onClick={() =>
                  select({
                    categoryId: r.product?.category?.id || '',
                    productFamilyId: r.product!.productFamily!.id,
                    productId: '',
                  })
                }
              >
                Same family
              </Btn>
            )}
          </>
        )}
        empty="No balances match this view. Change the scope or filters to see other stock."
      />
    </div>
  );
}
export default function InventoryBalances() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Balances />
    </Suspense>
  );
}
