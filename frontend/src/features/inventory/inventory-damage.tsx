'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
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
import { RecordBrowser } from '@/components/workspace/record-browser';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { productLabel } from '@/components/workspace/product-form';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendAllPages } from '@/lib/backend-all-pages';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { InventoryScope } from './inventory-scope';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { inventoryProductHref, inventoryViewHref } from './inventory-search';
import { useInventoryDraftEditor, useInventoryStateKey } from './inventory-drafts';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import {
  DAMAGE_ACTIONS,
  DAMAGE_STATUSES,
  DAMAGE_TYPES,
  damageDate,
  damageQuantity,
  damageScope,
  type DamageAction,
  type StockDamage,
} from './inventory-damage-types';
import './inventory-workspace.css';

function Damage() {
  const params = useSearchParams(),
    workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission('stock_damage.view'),
    canCreate = !authLoading && hasPermission('stock_damage.create');
  const external = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || '',
    productId: params.get('productId') || '',
    search: workspace?.searchQuery ?? params.get('q') ?? params.get('search') ?? '',
    status: params.get('status') || '',
    damageType: params.get('damageType') || '',
  };
  const externalKey = JSON.stringify([external, workspace?.scope]);
  const stateKey = useInventoryStateKey('damage');
  const [local, setLocal] = useWorkspaceState(`${stateKey}.filters`, {
    key: externalKey,
    value: external,
  });
  const state = local.key === externalKey ? local.value : external;
  const change = (patch: Partial<typeof external>) =>
    setLocal({ key: externalKey, value: { ...state, ...patch } });
  const scope = workspace?.scope || {
    companyId: state.companyId,
    divisionId: state.divisionId,
    branchId: state.branchId,
  };
  const scopeKey = JSON.stringify(scope);
  const [debounced, setDebounced] = useState(state.search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(state.search.trim()), 250);
    return () => clearTimeout(timer);
  }, [state.search]);
  const pending = state.search.trim() !== debounced;
  const query = {
      ...scope,
      productId: state.productId,
      search: debounced,
      status: state.status,
      damageType: state.damageType,
    },
    key = JSON.stringify(query),
    visibleKey = JSON.stringify([query, state.search]);
  const [paging, setPaging] = useWorkspaceState(`${stateKey}.page`, { key, page: 1 }),
    page = paging.key === key ? paging.page : 1;
  const resource = useWorkspaceResource<{ data: StockDamage[]; total: number }>(
    '/westsides/stock-damage',
    { ...query, page, limit: 20 },
    canRead && !pending,
  );
  useEffect(() => {
    if (resource.data && page > Math.max(1, Math.ceil(resource.data.total / 20)))
      setPaging({ key, page: Math.max(1, Math.ceil(resource.data.total / 20)) });
  }, [resource.data, page, key, setPaging]);
  const draftEditor = useInventoryDraftEditor('damage', scope, state.productId, resource.reload);
  const [exportBusy, setExportBusy] = useState(false),
    [exportError, setExportError] = useState('');
  const exportRef = useRef<AbortController | null>(null);
  useEffect(() => {
    exportRef.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => exportRef.current?.abort();
  }, [visibleKey, canRead]);
  async function exportAll(format: 'csv' | 'pdf') {
    if (!canRead || pending || resource.loading || resource.error || exportBusy) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const records = await backendAllPages<StockDamage>(
        '/westsides/stock-damage',
        query,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!records.length)
        throw new Error('No matching damage reports remain. Refresh the register.');
      const rows = records.map((r) => ({
        Number: r.damageNumber,
        Product: r.product?.name || r.productId,
        Company: r.company?.name || r.companyId,
        Division: r.branch?.division?.name || '',
        Branch: r.branch?.name || r.branchId || '',
        Quantity: r.quantity ?? '',
        Unit: r.unit?.symbol || r.unit?.name || r.unitId,
        'Damage type': productLabel(r.damageType),
        'Estimated value (TZS)': r.estimatedValue ?? '',
        Status: r.status,
        Batch: r.batch?.batchNumber || r.batchId || '',
        'Reported by': r.reportedBy?.fullName || r.reportedById || '',
        Created: r.createdAt || '',
        'Approved by': r.approvedBy?.fullName || r.approvedById || '',
        'Approved at': r.approvedAt || '',
        Notes: r.notes || '',
      }));
      if (format === 'csv')
        downloadTextFile('stock-damage.csv', 'text/csv;charset=utf-8', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            'PDF supports up to 5,000 reports. Narrow the filters or use CSV for the complete register.',
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: 'Stock damage',
          subtitle:
            Object.entries(query)
              .filter(([, value]) => value)
              .map(([name, value]) => `${name}: ${value}`)
              .join(' · ') || 'All accessible damage reports',
          companyId: scope.companyId || undefined,
          columns,
          rows: rows.map((row) => columns.map((c) => cellToString(row[c as keyof typeof row]))),
          numericColumns: [5, 8],
          baseName: 'stock-damage',
        });
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setExportError(err instanceof Error ? err.message : 'Unable to export damage reports.');
    } finally {
      if (!controller.signal.aborted) setExportBusy(false);
    }
  }
  if (authLoading) return <PageSpinner />;
  if (!canRead && !canCreate)
    return <PermissionDeniedState description="Damage reports require stock damage read access." />;
  const exportDisabled =
    exportBusy || pending || resource.loading || !!resource.error || !resource.data?.data.length;
  return (
    <div className="business-workspace inventory-damage inventory-overview">
      {draftEditor.drafts}
      <PageHeader
        title="Stock damage"
        subtitle="Record losses, review their impact and follow each report through posting."
      />
      {!workspace && (
        <InventoryScope value={scope} onChange={(value) => change({ ...value, productId: '' })} />
      )}
      {canRead ? (
        <PageToolbar
          collapsibleFilters
          search={state.search}
          onSearch={(search) => change({ search })}
          searchPlaceholder="Search damage, product or batch…"
          activeFilterCount={
            Number(!!state.status) + Number(!!state.damageType) + Number(!!state.productId)
          }
          filters={
            <>
              <FormSelect
                label="Damage status"
                value={state.status}
                placeholder="All statuses"
                onChange={(e) => change({ status: e.target.value })}
              >
                {DAMAGE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {productLabel(value)}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Damage type filter"
                value={state.damageType}
                placeholder="All damage types"
                onChange={(e) => change({ damageType: e.target.value })}
              >
                {DAMAGE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {productLabel(value)}
                  </option>
                ))}
              </FormSelect>
              {hasPermission('products.view') && (
                <div>
                  <span className="inventory-filter-label">Product</span>
                  <ProductPicker
                    key={scopeKey}
                    ariaLabel="Filter damage by product"
                    companyId={scope.companyId}
                    divisionId={scope.divisionId}
                    branchId={scope.branchId}
                    value={state.productId}
                    onChange={(productId) => change({ productId })}
                  />
                </div>
              )}
              <Btn
                variant="ghost"
                onClick={() => change({ search: '', productId: '', status: '', damageType: '' })}
              >
                Reset filters
              </Btn>
            </>
          }
          actions={
            <>
              <Btn variant="secondary" disabled={exportDisabled} onClick={() => exportAll('csv')}>
                Export CSV
              </Btn>
              <Btn variant="secondary" disabled={exportDisabled} onClick={() => exportAll('pdf')}>
                Export PDF
              </Btn>
              <Btn variant="ghost" disabled={resource.loading || pending} onClick={resource.reload}>
                Refresh damage
              </Btn>
              {canCreate && <Btn onClick={draftEditor.open}>Report damage</Btn>}
            </>
          }
        />
      ) : (
        <div className="inventory-damage-stack">
          <p className="workspace-notice">
            You can report damage. Viewing existing reports requires stock damage read access.
          </p>
          <div>
            <Btn onClick={draftEditor.open}>Report damage</Btn>
          </div>
        </div>
      )}
      {exportError && (
        <p role="alert" className="workspace-notice">
          {exportError}
        </p>
      )}
      {exportBusy && (
        <p role="status" className="inventory-register-note">
          Preparing every matching damage report…
        </p>
      )}
      {canRead && (
        <>
          <p className="inventory-register-note">
            Draft → Submitted → Approved → Posted. Quantities keep their own units. Estimated values
            are for review; posting uses the actual inventory value relieved.
          </p>
          <RecordBrowser
            stateKey={`${stateKey}.selection`}
            selectionScope={JSON.stringify([visibleKey, page])}
            key={visibleKey}
            title="Damage reports"
            records={resource.data?.data || []}
            name={(r) => r.damageNumber}
            reference={(r) => r.product?.name || r.productId}
            status={(r) => r.status}
            fields={[
              { label: 'Quantity', value: damageQuantity },
              { label: 'Estimated value', value: (r) => catalogueMoney(r.estimatedValue) },
            ]}
            details={[
              { label: 'Damage type', value: (r) => productLabel(r.damageType) },
              { label: 'Company', value: (r) => r.company?.name || r.companyId },
              { label: 'Division', value: (r) => r.branch?.division?.name || '—' },
              { label: 'Branch', value: (r) => r.branch?.name || r.branchId || '—' },
              { label: 'Unit', value: (r) => r.unit?.name || r.unitId },
              { label: 'Product code', value: (r) => r.product?.productCode || '—' },
              { label: 'SKU', value: (r) => r.product?.sku || '—' },
              { label: 'Barcode', value: (r) => r.product?.barcode || '—' },
              {
                label: 'Batch',
                value: (r) => r.batch?.batchNumber || r.batchId || 'No linked batch',
              },
              {
                label: 'Reported by',
                value: (r) => r.reportedBy?.fullName || r.reportedById || '—',
              },
              { label: 'Reported', value: (r) => damageDate(r.createdAt) },
              {
                label: 'Approved by',
                value: (r) => r.approvedBy?.fullName || r.approvedById || '—',
              },
              { label: 'Approved', value: (r) => damageDate(r.approvedAt) },
              { label: 'Last updated', value: (r) => damageDate(r.updatedAt) },
              {
                label: 'Notes',
                value: (r) => <span className="inventory-damage-notes">{r.notes || '—'}</span>,
              },
            ]}
            actions={(r) => (
              <>
                {(
                  Object.entries(DAMAGE_ACTIONS) as [
                    DamageAction,
                    (typeof DAMAGE_ACTIONS)[DamageAction],
                  ][]
                )
                  .filter(([, spec]) => r.status === spec.status && hasPermission(spec.permission))
                  .map(([value, spec]) => (
                    <Btn
                      key={value}
                      variant={value === 'reject' ? 'secondary' : 'primary'}
                      onClick={() => draftEditor.openAction(r.id, value)}
                    >
                      {spec.label}
                    </Btn>
                  ))}
                {hasPermission('products.view') && (
                  <Link href={inventoryProductHref(damageScope(r), r.productId)}>Open product</Link>
                )}
                {hasPermission('product_batches.view') && (
                  <Link
                    href={inventoryViewHref(damageScope(r), 'stock', 'batches', {
                      productId: r.productId,
                      q: r.batch?.batchNumber || undefined,
                    })}
                  >
                    {r.batch?.batchNumber ? 'Find linked batch' : 'Product batches'}
                  </Link>
                )}
                {r.status === 'POSTED' && hasPermission('inventory.movements.view') && (
                  <Link
                    href={inventoryViewHref(damageScope(r), 'stock', 'movements', {
                      referenceType: 'StockDamage',
                      referenceId: r.id,
                    })}
                  >
                    Posted movements
                  </Link>
                )}
              </>
            )}
            loading={resource.loading || pending}
            error={resource.error}
            onRetry={resource.reload}
            empty="No damage reports match this view."
            page={page}
            total={resource.data?.total || 0}
            pageSize={20}
            onPage={(value) => setPaging({ key, page: value })}
          />
        </>
      )}
    </div>
  );
}
export default function InventoryDamage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Damage />
    </Suspense>
  );
}
