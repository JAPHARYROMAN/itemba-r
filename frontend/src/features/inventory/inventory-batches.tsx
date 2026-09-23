'use client';
import { Suspense, useEffect, useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import {
  Btn,
  FormSelect,
  PageHeader,
  PageSpinner,
  PageToolbar,
  PermissionDeniedState,
  ProductPicker,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { productLabel, productQuantity } from '@/components/workspace/product-form';
import { InventoryScope } from './inventory-scope';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { inventoryProductHref, inventoryViewHref } from './inventory-search';
import { useInventoryDraftEditor, useInventoryStateKey } from './inventory-drafts';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import './inventory-workspace.css';

type Choice = { id: string; name: string };
export interface ProductBatch {
  id: string;
  batchNumber: string;
  companyId: string;
  productId: string;
  unitId: string;
  status: string;
  branchId?: string | null;
  supplierId?: string | null;
  purchaseOrderId?: string | null;
  initialQuantity?: string | number | null;
  remainingQuantity?: string | number | null;
  unitCost?: string | number | null;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  receivedDate?: string | null;
  createdAt?: string | null;
  notes?: string | null;
  product?: Choice & { productCode?: string | null; sku?: string | null; barcode?: string | null };
  company?: Choice | null;
  branch?: (Choice & { divisionId?: string | null; division?: Choice | null }) | null;
  supplier?: Choice | null;
  unit?: (Choice & { symbol?: string | null }) | null;
}
export const BATCH_STATUSES = [
  'ACTIVE',
  'EXPIRED',
  'SOLD_OUT',
  'QUARANTINED',
  'DAMAGED',
  'DISPOSED',
];
const reviews = [
  { value: 'all', label: 'All batches' },
  { value: 'expiring', label: 'Expiring within 30 days' },
  { value: 'expired', label: 'Expired' },
];
export function batchDate(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';
}
const amount = (value: ProductBatch['remainingQuantity']) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function batchConsumed(row: ProductBatch) {
  const initial = amount(row.initialQuantity),
    remaining = amount(row.remainingQuantity);
  return initial == null || remaining == null ? null : initial - remaining;
}
const quantity = (row: ProductBatch, value: ProductBatch['remainingQuantity']) => {
  const formatted = productQuantity(value);
  return formatted === '—'
    ? formatted
    : `${formatted}${row.unit?.symbol ? ` ${row.unit.symbol}` : ''}`;
};
function Batches() {
  const params = useSearchParams(),
    workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed = !authLoading && hasPermission('product_batches.view');
  const external = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || '',
    productId: params.get('productId') || '',
    search: workspace?.searchQuery ?? params.get('q') ?? params.get('search') ?? '',
  };
  const externalKey = JSON.stringify([external, workspace?.scope]);
  const stateKey = useInventoryStateKey('batches');
  const [local, setLocal] = useWorkspaceState(`${stateKey}.filters`, {
    key: externalKey,
    value: external,
  });
  const state = local.key === externalKey ? local.value : external;
  const scope = workspace?.scope || {
    companyId: state.companyId,
    divisionId: state.divisionId,
    branchId: state.branchId,
  };
  const scopeKey = JSON.stringify(scope);
  const change = (values: Partial<typeof external>) =>
    setLocal({ key: externalKey, value: { ...state, ...values } });
  const [reviewState, setReview] = useWorkspaceState(`${stateKey}.review`, {
    key: scopeKey,
    review: 'all',
    status: '',
  });
  const review = reviewState.key === scopeKey ? reviewState.review : 'all',
    status = reviewState.key === scopeKey ? reviewState.status : '';
  const [debounced, setDebounced] = useState(state.search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(state.search.trim()), 250);
    return () => clearTimeout(timer);
  }, [state.search]);
  const pendingSearch = state.search.trim() !== debounced;
  const query = { ...scope, productId: state.productId, search: debounced, review, status },
    key = JSON.stringify(query);
  const [paging, setPaging] = useWorkspaceState(`${stateKey}.page`, { key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const result = useWorkspaceResource<{ data: ProductBatch[]; total: number }>(
    '/westsides/product-batches',
    { ...query, page, limit: 20 },
    allowed && !pendingSearch,
  );
  useEffect(() => {
    if (result.data && page > 1) {
      const last = Math.max(1, Math.ceil(result.data.total / 20));
      if (page > last) setPaging({ key, page: last });
    }
  }, [result.data, page, key, setPaging]);
  const draftEditor = useInventoryDraftEditor('batch', scope, state.productId, result.reload);
  const canProduct = hasPermission('products.view');
  if (authLoading) return <PageSpinner />;
  if (!allowed) return <PermissionDeniedState />;
  const create = hasPermission('product_batches.manage') && (
    <Btn onClick={draftEditor.open}>New batch</Btn>
  );
  return (
    <div className="business-workspace inventory-batches">
      {draftEditor.drafts}
      <PageHeader
        title="Batches & expiry"
        subtitle="Trace each batch from receipt to remaining stock."
        actions={!workspace && create}
      />
      {!workspace && (
        <InventoryScope value={scope} onChange={(value) => change({ ...value, productId: '' })} />
      )}
      <div className="inventory-live-attention" aria-label="Batch review">
        {reviews.map((item) => (
          <Btn
            key={item.value}
            variant="ghost"
            aria-pressed={review === item.value}
            onClick={() => setReview({ key: scopeKey, review: item.value, status })}
          >
            {item.label}
          </Btn>
        ))}
      </div>
      <PageToolbar
        collapsibleFilters
        search={state.search}
        onSearch={(search) => change({ search })}
        searchPlaceholder="Search batch, product or supplier…"
        activeFilterCount={Number(!!state.productId) + Number(!!status)}
        filters={
          <>
            {canProduct ? (
              <div>
                <span className="inventory-filter-label">Product</span>
                <ProductPicker
                  key={scopeKey}
                  ariaLabel="Filter batches by product"
                  value={state.productId}
                  companyId={scope.companyId}
                  divisionId={scope.divisionId}
                  branchId={scope.branchId}
                  onChange={(productId) => change({ productId })}
                />
              </div>
            ) : (
              <p className="inventory-register-note">
                Product search requires product read access.
              </p>
            )}
            <FormSelect
              label="Batch status"
              value={status}
              placeholder="All statuses"
              onChange={(e) => setReview({ key: scopeKey, review, status: e.target.value })}
            >
              {BATCH_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {productLabel(value)}
                </option>
              ))}
            </FormSelect>
            <Btn
              variant="ghost"
              onClick={() => {
                change({ search: '', productId: '' });
                setReview({ key: scopeKey, review: 'all', status: '' });
              }}
            >
              Reset filters
            </Btn>
          </>
        }
        actions={
          <div className="inventory-actions">
            {workspace && create}
            <Btn
              variant="secondary"
              disabled={result.loading || pendingSearch}
              onClick={result.reload}
            >
              Refresh batches
            </Btn>
          </div>
        }
      />
      {state.productId && (
        <p className="inventory-register-note">
          Review is restricted to the selected product.{' '}
          <Btn variant="ghost" onClick={() => change({ productId: '' })}>
            Clear product filter
          </Btn>
        </p>
      )}
      <p className="inventory-register-note">
        {review === 'all'
          ? 'All batch statuses and dates. Select an expiry review to focus the register.'
          : review === 'expiring'
            ? 'Active batches expiring from now through the next 30 days, inclusive. Company, branch, product, search and status filters still apply.'
            : 'Past-expiry batches with Active or Expired status. Quarantined, disposed, damaged and sold-out batches remain in All batches.'}{' '}
        Dates are displayed in UTC; expiry reviews use the recorded expiry instant. Quantities are
        shown in each batch’s unit.
      </p>
      <RecordBrowser
        stateKey={`${stateKey}.selection`}
        selectionScope={JSON.stringify([key, state.search, page])}
        key={key}
        title="Batch register"
        records={result.data?.data || []}
        total={result.data?.total || 0}
        page={page}
        pageSize={20}
        onPage={(next) => setPaging({ key, page: next })}
        loading={result.loading || pendingSearch}
        error={result.error}
        onRetry={result.reload}
        empty="No batches match this review. Change the scope, product or filters."
        name={(r) => r.batchNumber}
        reference={(r) =>
          [r.product?.name || r.productId, r.branch?.name || 'No branch'].join(' · ')
        }
        status={(r) => r.status}
        fields={[
          { label: 'Expiry date', value: (r) => batchDate(r.expiryDate) },
          { label: 'Remaining', value: (r) => quantity(r, r.remainingQuantity) },
        ]}
        details={[
          { label: 'Product', value: (r) => r.product?.name || r.productId },
          { label: 'Product code', value: (r) => r.product?.productCode || '—' },
          { label: 'SKU', value: (r) => r.product?.sku || '—' },
          { label: 'Barcode', value: (r) => r.product?.barcode || '—' },
          { label: 'Initial quantity', value: (r) => quantity(r, r.initialQuantity) },
          { label: 'Quantity used', value: (r) => quantity(r, batchConsumed(r)) },
          { label: 'Unit', value: (r) => r.unit?.name || r.unitId },
          { label: 'Unit cost', value: (r) => catalogueMoney(r.unitCost) },
          { label: 'Manufactured', value: (r) => batchDate(r.manufactureDate) },
          { label: 'Received', value: (r) => batchDate(r.receivedDate) },
          { label: 'Supplier', value: (r) => r.supplier?.name || r.supplierId || '—' },
          { label: 'Company', value: (r) => r.company?.name || r.companyId },
          {
            label: 'Division',
            value: (r) => r.branch?.division?.name || r.branch?.divisionId || '—',
          },
          { label: 'Branch', value: (r) => r.branch?.name || r.branchId || 'No branch' },
          { label: 'Purchase order ID', value: (r) => r.purchaseOrderId || '—' },
          { label: 'Created', value: (r) => batchDate(r.createdAt) },
          { label: 'Notes', value: (r) => r.notes || '—' },
        ]}
        actions={(r) => {
          const rowScope = {
            companyId: r.companyId,
            divisionId: r.branch?.divisionId || '',
            branchId: r.branchId || '',
          };
          return (
            <>
              {canProduct && (
                <Link
                  className="record-primary-action"
                  href={inventoryProductHref(rowScope, r.productId)}
                >
                  Open product
                </Link>
              )}
              {hasPermission('inventory.movements.view') && (
                <Link
                  href={inventoryViewHref(rowScope, 'stock', 'movements', {
                    productId: r.productId,
                  })}
                >
                  Product movements
                </Link>
              )}
              {hasPermission('suppliers.view') && r.supplierId && (
                <Link href={`/operations/suppliers/${encodeURIComponent(r.supplierId)}`}>
                  Open supplier
                </Link>
              )}
              {hasPermission('purchases.view') && r.purchaseOrderId && (
                <Link href={`/operations/purchase-orders/${encodeURIComponent(r.purchaseOrderId)}`}>
                  Purchase order
                </Link>
              )}
              {hasPermission('stock_damage.view') && (
                <Link href={inventoryViewHref(rowScope, 'controls', 'damage')}>
                  Damage register
                </Link>
              )}
            </>
          );
        }}
      />
    </div>
  );
}
export default function InventoryBatches() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Batches />
    </Suspense>
  );
}
