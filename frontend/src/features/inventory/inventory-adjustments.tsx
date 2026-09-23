'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useWorkspaceSearchParams as useSearchParams } from '@/components/workspace/workspace-navigation';
import {
  Btn,
  FormDateField,
  FormSelect,
  PageHeader,
  PageSpinner,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { productLabel } from '@/components/workspace/product-form';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendAllPages } from '@/lib/backend-all-pages';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { InventoryScope } from './inventory-scope';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { useInventoryDraftEditor, useInventoryStateKey } from './inventory-drafts';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { AdjustmentReview, adjustmentDate } from './inventory-adjustment-review';
import { adjustmentName, type StockAdjustment } from './inventory-adjustment-types';
import './inventory-workspace.css';

const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED'];
function Adjustments() {
  const params = useSearchParams(),
    workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed =
    !authLoading &&
    (hasPermission('inventory.view') || hasPermission('inventory.adjustments.create'));
  const external = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    branchId: params.get('branchId') || params.get('locationId') || '',
    search: workspace?.searchQuery ?? params.get('q') ?? params.get('search') ?? '',
    status: params.get('status') || '',
    dateFrom: params.get('dateFrom')?.slice(0, 10) || '',
    dateTo: params.get('dateTo')?.slice(0, 10) || '',
  };
  const externalKey = JSON.stringify([external, workspace?.scope]);
  const stateKey = useInventoryStateKey('adjustments');
  const [local, setLocal] = useWorkspaceState(`${stateKey}.filters`, {
    key: externalKey,
    value: external,
  });
  const state = local.key === externalKey ? local.value : external;
  const change = (value: Partial<typeof external>) =>
    setLocal({ key: externalKey, value: { ...state, ...value } });
  const scope = workspace?.scope || {
    companyId: state.companyId,
    divisionId: state.divisionId,
    branchId: state.branchId,
  };
  const [debounced, setDebounced] = useState(state.search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(state.search.trim()), 250);
    return () => clearTimeout(timer);
  }, [state.search]);
  const pending = state.search.trim() !== debounced;
  const invalidDates = !!(state.dateFrom && state.dateTo && state.dateFrom > state.dateTo);
  const query = {
    ...scope,
    search: debounced,
    status: state.status,
    dateFrom: state.dateFrom ? `${state.dateFrom}T00:00:00.000Z` : '',
    dateTo: state.dateTo ? `${state.dateTo}T23:59:59.999Z` : '',
  };
  const key = JSON.stringify(query),
    visibleKey = JSON.stringify([query, state.search]);
  const [paging, setPaging] = useWorkspaceState(`${stateKey}.page`, { key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const resource = useWorkspaceResource<{ data: StockAdjustment[]; total: number }>(
    '/stock-adjustments',
    { ...query, page, limit: 20 },
    allowed && !pending && !invalidDates,
  );
  useEffect(() => {
    if (resource.data && page > Math.max(1, Math.ceil(resource.data.total / 20)))
      setPaging({ key, page: Math.max(1, Math.ceil(resource.data.total / 20)) });
  }, [resource.data, page, key, setPaging]);
  const draftEditor = useInventoryDraftEditor('adjustment', scope, '', resource.reload);
  const [review, setReview] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false),
    [exportError, setExportError] = useState('');
  const exportRef = useRef<AbortController | null>(null);
  useEffect(() => {
    exportRef.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => exportRef.current?.abort();
  }, [visibleKey, allowed]);
  async function exportAll(format: 'csv' | 'pdf') {
    if (!allowed || invalidDates || pending || resource.loading || resource.error || exportBusy)
      return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const data = await backendAllPages<StockAdjustment>(
        '/stock-adjustments',
        query,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!data.length) throw new Error('No matching adjustments remain. Refresh the register.');
      const rows = data.map((r) => ({
        Number: adjustmentName(r),
        Company: r.company?.name || '',
        Division: r.division?.name || '',
        Branch: r.branch?.name || '',
        Reason: r.reason,
        Lines: r._count?.lines ?? r.lines?.length ?? '',
        Status: r.status,
        Created: r.createdAt || '',
      }));
      if (format === 'csv')
        downloadTextFile('stock-adjustments.csv', 'text/csv;charset=utf-8', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            'PDF supports up to 5,000 records. Narrow the filters or use CSV for the complete register.',
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: 'Stock adjustments',
          companyId: scope.companyId || undefined,
          subtitle:
            Object.entries(query)
              .filter(([, value]) => value)
              .map(([name, value]) => `${name}: ${value}`)
              .join(' · ') || 'All accessible adjustments',
          columns,
          rows: rows.map((row) => columns.map((c) => cellToString(row[c as keyof typeof row]))),
          numericColumns: [5],
          baseName: 'stock-adjustments',
        });
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setExportError(err instanceof Error ? err.message : 'Unable to export adjustments.');
    } finally {
      if (!controller.signal.aborted) setExportBusy(false);
    }
  }
  if (authLoading) return <PageSpinner />;
  if (!allowed) return <PermissionDeniedState />;
  const exportDisabled =
    invalidDates ||
    pending ||
    resource.loading ||
    !!resource.error ||
    !resource.data?.data.length ||
    exportBusy;
  return (
    <div className="business-workspace inventory-adjustments inventory-overview">
      {draftEditor.drafts}
      <PageHeader
        title="Stock adjustments"
        subtitle="Reconcile a stock count, review its differences and follow it through posting."
      />
      {!workspace && <InventoryScope value={scope} onChange={(value) => change(value)} />}
      <PageToolbar
        collapsibleFilters
        search={state.search}
        onSearch={(search) => change({ search })}
        searchPlaceholder="Search number, reason or branch…"
        activeFilterCount={
          Number(!!state.status) + Number(!!state.dateFrom) + Number(!!state.dateTo)
        }
        filters={
          <>
            <FormSelect
              label="Adjustment status"
              value={state.status}
              placeholder="All statuses"
              onChange={(e) => change({ status: e.target.value })}
            >
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {productLabel(value)}
                </option>
              ))}
            </FormSelect>
            <FormDateField
              label="Created from (UTC)"
              value={state.dateFrom}
              onChange={(value) => change({ dateFrom: value })}
            />
            <FormDateField
              label="Created through (UTC)"
              value={state.dateTo}
              onChange={(value) => change({ dateTo: value })}
            />
            <Btn
              variant="ghost"
              onClick={() => change({ search: '', status: '', dateFrom: '', dateTo: '' })}
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
            <Btn
              variant="ghost"
              onClick={resource.reload}
              disabled={resource.loading || pending || invalidDates}
            >
              Refresh
            </Btn>
            {hasPermission('inventory.adjustments.create') && (
              <Btn onClick={draftEditor.open}>New adjustment</Btn>
            )}
          </>
        }
      />
      {invalidDates && (
        <p role="alert" className="workspace-notice">
          The end date must be on or after the start date.
        </p>
      )}
      {exportBusy && (
        <p role="status" className="inventory-register-note">
          Preparing every matching adjustment…
        </p>
      )}
      {exportError && (
        <p role="alert" className="workspace-notice">
          {exportError}
        </p>
      )}
      <p className="inventory-register-note">
        Draft → Pending approval → Approved → Posted. Only posting changes stock. Exports include
        every matching record.
      </p>
      <RecordBrowser
        stateKey={`${stateKey}.selection`}
        selectionScope={JSON.stringify([visibleKey, page])}
        key={visibleKey}
        title="Stock adjustments"
        records={resource.data?.data || []}
        name={adjustmentName}
        reference={(r) => r.reason}
        status={(r) => r.status}
        fields={[
          { label: 'Branch', value: (r) => r.branch?.name || '—' },
          { label: 'Lines', value: (r) => r._count?.lines ?? r.lines?.length ?? '—' },
        ]}
        details={[
          { label: 'Company', value: (r) => r.company?.name || r.companyId },
          { label: 'Division', value: (r) => r.division?.name || r.divisionId || '—' },
          { label: 'Reason', value: (r) => r.reason || '—' },
          { label: 'Notes', value: (r) => r.notes || '—' },
          { label: 'Created', value: (r) => adjustmentDate(r.createdAt) },
          { label: 'Created by', value: (r) => r.createdBy?.fullName || '—' },
        ]}
        actions={(r) => <Btn onClick={() => setReview(r.id)}>Review lines & actions</Btn>}
        loading={resource.loading || pending}
        error={resource.error}
        onRetry={resource.reload}
        empty={
          invalidDates
            ? 'Choose a valid date range to view adjustments.'
            : 'No stock adjustments match this view.'
        }
        page={page}
        pageSize={20}
        total={resource.data?.total || 0}
        onPage={(value) => setPaging({ key, page: value })}
      />
      {review && (
        <AdjustmentReview
          id={review}
          onClose={() => setReview(null)}
          onChanged={resource.reload}
          onAction={(action) => {
            draftEditor.openAction(review, action);
            setReview(null);
          }}
        />
      )}
    </div>
  );
}
export default function InventoryAdjustments() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Adjustments />
    </Suspense>
  );
}
