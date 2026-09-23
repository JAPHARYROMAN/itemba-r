'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import { Btn, ErrorState, FormDateField, FormInput, FormSelect, PageHeader, PageSpinner, PageToolbar, PermissionDeniedState, ProductPicker, type ScopeValue } from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { productLabel, productQuantity } from '@/components/workspace/product-form';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendAllPages } from '@/lib/backend-all-pages';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { InventoryScope } from './inventory-scope';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { inventoryProductHref } from './inventory-search';
import './inventory-workspace.css';

const inbound = new Set([
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALES_RETURN',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'PRODUCTION_IN',
]);
const outbound = new Set([
  'SALE_ISSUE',
  'PURCHASE_RETURN',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_OUT',
]);
const movementTypes = [
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALE_ISSUE',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'WASTAGE',
  'INTERNAL_USE',
  'PRODUCTION_IN',
  'PRODUCTION_OUT',
  'OTHER',
];
type Amount = number | string | null;
export interface InventoryMovement {
  id: string;
  movementNumber?: string | null;
  movementDate: string;
  movementType: string;
  quantity: Amount;
  unitCost: Amount;
  totalCost: Amount;
  productId: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  unitId?: string | null;
  referenceNumber?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  product?: { name: string; productCode?: string | null; sku?: string | null } | null;
  branch?: { name: string; code?: string | null } | null;
  company?: { name: string; code?: string | null } | null;
  division?: { name: string; code?: string | null } | null;
  unit?: { name: string; symbol: string } | null;
  createdBy?: { fullName: string } | null;
}
interface Summary {
  totalMovements: number;
  totalCost: Amount;
  byType: { movementType: string; count: number }[];
}
const number = (value: Amount | undefined) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function movementDirection(type: string) {
  return inbound.has(type) ? 'Inbound' : outbound.has(type) ? 'Outbound' : 'Unclassified';
}
export function signedMovementQuantity(row: Pick<InventoryMovement, 'quantity' | 'movementType'>) {
  const n = number(row.quantity);
  if (n == null) return '—';
  const direction = movementDirection(row.movementType);
  return (direction === 'Inbound' ? '+' : direction === 'Outbound' ? '−' : '') + productQuantity(n);
}
const date = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';
const organisation = (value: InventoryMovement['company'], fallback: string) =>
  value ? [value.code, value.name].filter(Boolean).join(' · ') : fallback;
const sourceType = (value?: string | null) =>
  value ? value.replace(/([a-z])([A-Z])/g, '$1 $2') : '—';
function exportRows(rows: InventoryMovement[]) {
  return rows.map((r) => ({
    'Movement number': r.movementNumber || r.id,
    'Movement date (UTC)': date(r.movementDate),
    'Product code': r.product?.productCode || '',
    Product: r.product?.name || r.productId,
    SKU: r.product?.sku || '',
    Type: productLabel(r.movementType),
    Direction: movementDirection(r.movementType),
    Quantity: number(r.quantity),
    'Unit ID': r.unitId || '',
    Unit: r.unit?.name || '',
    'Unit symbol': r.unit?.symbol || '',
    'Unit cost': number(r.unitCost),
    'Total cost': number(r.totalCost),
    Branch: organisation(r.branch, r.branchId || ''),
    'Division ID': r.divisionId || '',
    Division: organisation(r.division, ''),
    Company: organisation(r.company, r.companyId),
    'Reference number': r.referenceNumber || '',
    'Reference type': r.referenceType || '',
    'Reference ID': r.referenceId || '',
    'Created by': r.createdBy?.fullName || '',
    Notes: r.notes || '',
    Batch: r.batchNumber || '',
    Expiry: date(r.expiryDate),
  }));
}
const emptyFilters = {
  productId: '',
  movementType: '',
  referenceType: '',
  referenceId: '',
  dateFrom: '',
  dateTo: '',
};

function Movements() {
  const params = useSearchParams();
  const workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission('inventory.movements.view');
  const externalScope = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || params.get('locationId') || '',
  };
  const externalScopeKey = JSON.stringify(externalScope);
  const [localScope, setLocalScope] = useState({ key: externalScopeKey, value: externalScope });
  const scope =
    workspace?.scope || (localScope.key === externalScopeKey ? localScope.value : externalScope);
  const externalFilters = {
    productId: params.get('productId') || '',
    movementType: params.get('movementType') || '',
    referenceType: params.get('referenceType') || '',
    referenceId: params.get('referenceId') || '',
    dateFrom: params.get('dateFrom') || '',
    dateTo: params.get('dateTo') || '',
  };
  // URL changes are authoritative even when the surrounding Inventory view stays mounted.
  const externalKey = JSON.stringify([scope, externalFilters]);
  const [localFilters, setLocalFilters] = useState({ key: externalKey, value: externalFilters });
  const selected = localFilters.key === externalKey ? localFilters.value : externalFilters;
  const select = (changes: Partial<typeof selected>) =>
    setLocalFilters({ key: externalKey, value: { ...selected, ...changes } });
  const filters = { ...scope, ...selected };
  const filterKey = JSON.stringify(filters);
  const invalidDates = !!(
    selected.dateFrom &&
    selected.dateTo &&
    selected.dateFrom > selected.dateTo
  );
  const [pagination, setPagination] = useState({ key: filterKey, page: 1 });
  const page = pagination.key === filterKey ? pagination.page : 1;
  const records = useWorkspaceResource<{ data: InventoryMovement[]; total: number }>(
    '/inventory-movements',
    { ...filters, page, limit: 20 },
    canRead && !invalidDates,
  );
  const summary = useWorkspaceResource<Summary>(
    '/inventory-movements/summary',
    filters,
    canRead && !invalidDates,
  );
  const canProducts = [
    'products.view',
    'pos.create',
    'sales.create',
    'purchases.create',
    'inventory.view',
    'inventory.adjustments.create',
    'operations.dashboard.view',
  ].some((permission) => hasPermission(permission));
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportRef = useRef<AbortController | null>(null);
  useEffect(() => {
    exportRef.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => exportRef.current?.abort();
  }, [filterKey, canRead]);
  const exportAll = async (format: 'csv' | 'pdf') => {
    if (!canRead || invalidDates || records.loading || records.error || exportBusy) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const rows = exportRows(
        await backendAllPages<InventoryMovement>(
          '/inventory-movements',
          filters,
          controller.signal,
        ),
      );
      if (controller.signal.aborted) return;
      if (!rows.length) throw new Error('No matching movements remain. Refresh this view.');
      if (format === 'csv')
        downloadTextFile('inventory-movements.csv', 'text/csv;charset=utf-8', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            'PDF supports up to 5,000 records. Narrow the filters or use CSV for the complete register.',
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: 'Inventory movements',
          companyId: scope.companyId || undefined,
          subtitle:
            Object.entries(filters)
              .filter(([, value]) => value)
              .map(([key, value]) => productLabel(key.replace(/([A-Z])/g, '_$1')) + ': ' + value)
              .join(' · ') || 'All accessible movements',
          columns,
          rows: rows.map((r) => columns.map((c) => cellToString(r[c as keyof typeof r]))),
          numericColumns: [7, 11, 12],
          baseName: 'inventory-movements',
        });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setExportError(error instanceof Error ? error.message : 'Unable to export movements.');
    } finally {
      if (!controller.signal.aborted) setExportBusy(false);
    }
  };
  if (authLoading) return <PageSpinner />;
  if (!canRead)
    return (
      <PermissionDeniedState description="Your current role does not allow viewing inventory movements." />
    );
  const exportDisabled =
    invalidDates || exportBusy || records.loading || !!records.error || !records.data?.data.length;
  const rowScope = (r: InventoryMovement): ScopeValue => ({
    companyId: r.companyId,
    divisionId: r.divisionId || '',
    branchId: r.branchId || '',
  });
  return (
    <div className="business-workspace inventory-movements inventory-overview">
      <PageHeader
        title="Stock movements"
        subtitle="Follow every receipt, issue and adjustment, with its recorded cost and source."
      />
      {!workspace && (
        <InventoryScope
          value={scope}
          onChange={(value) => {
            setLocalScope({ key: externalScopeKey, value });
            setLocalFilters({
              key: JSON.stringify([value, externalFilters]),
              value: { ...selected, productId: '', referenceType: '', referenceId: '' },
            });
          }}
        />
      )}
      {summary.loading ? (
        <PageSpinner label="Loading movement summary" />
      ) : summary.error ? (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      ) : (
        summary.data && (
          <div
            className="workspace-summary inventory-health-summary"
            aria-label="Filtered movement summary"
          >
            {[
              ['Movements', productQuantity(summary.data.totalMovements)],
              [
                'Purchase receipts',
                productQuantity(
                  summary.data.byType.find((r) => r.movementType === 'PURCHASE_RECEIPT')?.count ??
                    0,
                ),
              ],
              [
                'Sales issues',
                productQuantity(
                  summary.data.byType.find((r) => r.movementType === 'SALE_ISSUE')?.count ?? 0,
                ),
              ],
              ['Recorded cost', catalogueMoney(summary.data.totalCost)],
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
        Totals cover all matching movements. Recorded cost sums movement costs; it is not the
        current stock value. Dates use UTC. CSV includes every matching page; PDF supports up to
        5,000 records.
      </p>
      <PageToolbar
        collapsibleFilters
        activeFilterCount={Object.values(selected).filter(Boolean).length}
        filters={
          <>
            {canProducts ? (
              <div>
                <span className="inventory-filter-label">Product</span>
                <ProductPicker
                  key={JSON.stringify(scope)}
                  value={selected.productId}
                  onChange={(productId) => select({ productId })}
                  companyId={scope.companyId}
                  divisionId={scope.divisionId}
                  branchId={scope.branchId}
                  ariaLabel="Filter by product"
                />
              </div>
            ) : (
              <p className="inventory-register-note">
                Product search requires product read access.
              </p>
            )}
            <FormSelect
              label="Movement type"
              value={selected.movementType}
              onChange={(e) => select({ movementType: e.target.value })}
              placeholder="All movements"
            >
              {movementTypes.map((type) => (
                <option key={type} value={type}>
                  {productLabel(type)}
                </option>
              ))}
            </FormSelect>
            <FormDateField
              label="From date"
              value={selected.dateFrom}
              onChange={(value) => select({ dateFrom: value })}
            />
            <FormDateField
              label="To date"
              value={selected.dateTo}
              onChange={(value) => select({ dateTo: value })}
            />
            <FormInput
              label="Source type"
              value={selected.referenceType}
              onChange={(e) => select({ referenceType: e.target.value })}
              placeholder="For example, SalesOrder"
            />
            <FormInput
              label="Source ID"
              value={selected.referenceId}
              onChange={(e) => select({ referenceId: e.target.value })}
              placeholder="Exact document ID"
            />
            <Btn
              variant="ghost"
              onClick={() => setLocalFilters({ key: externalKey, value: emptyFilters })}
            >
              Reset filters
            </Btn>
          </>
        }
        actions={
          <div className="inventory-actions">
            <Btn
              variant="secondary"
              disabled={invalidDates || records.loading || summary.loading}
              onClick={() => {
                records.reload();
                summary.reload();
              }}
            >
              Refresh movements
            </Btn>
            <Btn
              variant="secondary"
              disabled={exportDisabled}
              onClick={() => void exportAll('csv')}
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              disabled={exportDisabled}
              onClick={() => void exportAll('pdf')}
            >
              Export PDF
            </Btn>
          </div>
        }
      />
      {selected.productId && (
        <p className="inventory-register-note">
          Showing movements for the selected product.{' '}
          <Btn variant="ghost" onClick={() => select({ productId: '' })}>
            Clear product filter
          </Btn>
        </p>
      )}
      {invalidDates && (
        <p role="alert" className="workspace-notice">
          From date must be on or before To date.
        </p>
      )}
      {exportBusy && (
        <p role="status" className="inventory-register-note">
          Preparing all matching movements…
        </p>
      )}
      {exportError && (
        <p role="alert" className="workspace-notice">
          {exportError}
        </p>
      )}
      {!invalidDates && (
        <RecordBrowser<InventoryMovement>
          title="Movement ledger"
          records={records.data?.data || []}
          total={records.data?.total || 0}
          loading={records.loading}
          error={records.error}
          onRetry={records.reload}
          page={page}
          pageSize={20}
          onPage={(p) => setPagination({ key: filterKey, page: p })}
          name={(r) => r.product?.name || 'Product unavailable'}
          reference={(r) => [r.movementNumber || r.id, date(r.movementDate)].join(' · ')}
          status={(r) => productLabel(r.movementType)}
          fields={[
            { label: 'Quantity', value: signedMovementQuantity },
            { label: 'Recorded cost', value: (r) => catalogueMoney(r.totalCost) },
          ]}
          details={[
            { label: 'Direction', value: (r) => movementDirection(r.movementType) },
            { label: 'Unit cost', value: (r) => catalogueMoney(r.unitCost) },
            {
              label: 'Unit',
              value: (r) => (r.unit ? r.unit.name + ' (' + r.unit.symbol + ')' : 'Unavailable'),
            },
            {
              label: 'Product code',
              value: (r) => r.product?.productCode || r.product?.sku || r.productId,
            },
            { label: 'Branch', value: (r) => organisation(r.branch, r.branchId || 'No branch') },
            {
              label: 'Division',
              value: (r) => organisation(r.division, r.divisionId ? 'Unavailable' : 'Company-wide'),
            },
            { label: 'Company', value: (r) => organisation(r.company, r.companyId) },
            { label: 'Reference number', value: (r) => r.referenceNumber || '—' },
            { label: 'Source type', value: (r) => sourceType(r.referenceType) },
            { label: 'Source ID', value: (r) => r.referenceId || '—' },
            { label: 'Created by', value: (r) => r.createdBy?.fullName || '—' },
            { label: 'Batch', value: (r) => r.batchNumber || '—' },
            { label: 'Expiry', value: (r) => date(r.expiryDate) },
            { label: 'Notes', value: (r) => r.notes || 'No notes recorded' },
          ]}
          actions={(r) => (
            <>
              {hasPermission('products.view') && (
                <Link
                  className="workspace-secondary-link"
                  href={inventoryProductHref(
                    rowScope(r),
                    r.productId,
                    workspace?.searchQuery || '',
                  )}
                >
                  Open product
                </Link>
              )}
              {r.referenceType === 'SalesOrder' && r.referenceId && hasPermission('sales.view') && (
                <Link
                  className="workspace-secondary-link"
                  href={'/operations/sales-orders/' + encodeURIComponent(r.referenceId)}
                >
                  Open sales order
                </Link>
              )}
              {r.referenceId && (
                <Btn
                  variant="secondary"
                  onClick={() =>
                    select({ referenceType: r.referenceType || '', referenceId: r.referenceId! })
                  }
                >
                  Same source
                </Btn>
              )}
            </>
          )}
          empty="No movements match this view. Change the scope or filters to see other activity."
        />
      )}
    </div>
  );
}
export default function InventoryMovements() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Movements />
    </Suspense>
  );
}
