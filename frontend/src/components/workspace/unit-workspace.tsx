'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn, FormSelect, PageHeader, PageToolbar, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';
import { backendAllPages } from '@/lib/backend-all-pages';
import { rowsToCsv, cellToString, downloadTextFile } from '@/lib/report-export';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { RecordBrowser } from './record-browser';
import { UnitDelete } from './unit-editors';
import {
  UNIT_TYPES,
  unitTypeLabel,
  conversionName,
  conversionEquation,
  type Unit,
  type UnitConversion,
  type UnitCompany,
} from './unit-types';
import { useWorkspaceState } from './workspace-session';
import {
  useInventoryDefinitionEditor,
  useInventoryStateKey,
} from '@/features/inventory/inventory-drafts';
import './workspace.css';
import './unit-workspace.css';
type Kind = 'units' | 'unit-conversions';
export function UnitWorkspace() {
  const workspace = useInventoryWorkspace();
  return (
    <UnitRegister
      companyId={workspace?.scope.companyId || ''}
      initialSearch={workspace?.searchQuery || ''}
      embedded={!!workspace?.embedded}
    />
  );
}
function UnitRegister({
  companyId: initialCompanyId,
  initialSearch,
  embedded,
}: {
  companyId: string;
  initialSearch: string;
  embedded: boolean;
}) {
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission('units.view'),
    canManage = hasPermission('units.manage'),
    canChoose = hasPermission('companies.read');
  const externalKey = JSON.stringify([initialCompanyId, initialSearch, embedded]);
  const stateKey = useInventoryStateKey('units.' + externalKey);
  const [kind, setKind] = useWorkspaceState<Kind>(stateKey + '.kind', 'units');
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', initialSearch);
  const [query, setQuery] = useState(search.trim());
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [localCompanyId, setCompanyId] = useWorkspaceState(stateKey + '.company', initialCompanyId);
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const [unitType, setUnitType] = useWorkspaceState(stateKey + '.type', '');
  const companyId = embedded ? initialCompanyId : localCompanyId;
  const previousExternal = useRef(externalKey);
  useEffect(() => {
    if (previousExternal.current === externalKey) return;
    previousExternal.current = externalKey;
    setSearch(initialSearch);
    setQuery(initialSearch.trim());
    setPage(1);
  }, [externalKey, initialSearch, setSearch, setPage]);
  const [deletion, setDeletion] = useState<{ kind: Kind; record: Unit | UnitConversion } | null>(
    null,
  );
  const [notice, setNotice] = useState(''),
    [exportError, setExportError] = useState(''),
    [exportBusy, setExportBusy] = useState(false);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const scope = { companyId, search: query, status, ...(kind === 'units' ? { unitType } : {}) };
  const scopeKey = JSON.stringify([kind, scope]);
  useEffect(() => {
    exportController.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => exportController.current?.abort();
  }, [scopeKey, canRead]);
  const result = useWorkspaceResource<{ data: Array<Unit | UnitConversion>; total: number }>(
    `/${kind}`,
    { ...scope, page, limit: 20 },
    canRead,
  );
  const companies = useWorkspaceChoices<UnitCompany>('/companies', {}, canRead && canChoose);
  const scopeName = (record: { companyId?: string | null }) =>
    record.companyId
      ? companies.rows.find((c) => c.id === record.companyId)?.name || record.companyId
      : 'Shared';
  const unitScope = (record: Unit) => (record.isSystemUnit ? 'System' : scopeName(record));
  useEffect(() => {
    if (result.data && !result.data.data.length && page > 1) setPage((p) => p - 1);
  }, [page, result.data, setPage]);
  const refresh = () => result.reload();
  const saved = (message: string) => {
    setDeletion(null);
    setNotice(message);
    refresh();
  };
  const entry = useInventoryDefinitionEditor(['unit', 'conversion'], saved, kind);
  const exportRows = async (format: 'csv' | 'pdf') => {
    if (exportBusy || !canRead || result.loading || result.error || search.trim() !== query) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const data = await backendAllPages<Unit | UnitConversion>(
        `/${kind}`,
        scope,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const rows: Record<string, unknown>[] =
        kind === 'units'
          ? (data as Unit[]).map((u) => ({
              Name: u.name,
              Symbol: u.symbol,
              Type: u.unitType,
              Scope: unitScope(u),
              Base: u.isBaseUnit ? 'Yes' : 'No',
              Status: u.status,
            }))
          : (data as UnitConversion[]).map((c) => ({
              From: `${c.fromUnit?.name || c.fromUnitId} (${c.fromUnit?.symbol || ''})`,
              To: `${c.toUnit?.name || c.toUnitId} (${c.toUnit?.symbol || ''})`,
              Factor: c.conversionFactor,
              Description: c.description || '',
              Status: c.isActive ? 'ACTIVE' : 'INACTIVE',
              Scope: scopeName(c),
            }));
      if (!rows.length) throw new Error('No matching records remain to export. Refresh this view.');
      if (format === 'csv') downloadTextFile(`${kind}.csv`, 'text/csv', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            `PDF supports up to ${TABLE_PDF_MAX_ROWS.toLocaleString()} records. Narrow the filters or use CSV for all ${rows.length.toLocaleString()} records.`,
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: kind === 'units' ? 'Units of measure' : 'Unit conversions',
          subtitle: [
            companyId
              ? `Company: ${scopeName({ companyId })} (including shared)`
              : 'All accessible scopes',
            query && `Search: ${query}`,
            status,
            kind === 'units' && unitType,
          ]
            .filter(Boolean)
            .join(' · '),
          columns,
          rows: rows.map((r) => columns.map((c) => cellToString(r[c]))),
          numericColumns: kind === 'unit-conversions' ? [2] : undefined,
          baseName: kind,
        });
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setExportError(err instanceof Error ? err.message : 'Unable to export records.');
    } finally {
      if (!controller.signal.aborted) setExportBusy(false);
    }
  };
  if (authLoading)
    return (
      <p role="status" className="workspace-notice">
        Loading workspace…
      </p>
    );
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view units and conversions." />;
  const records = result.data?.data || [];
  const active = records.filter((r) => ('status' in r ? r.status === 'ACTIVE' : r.isActive)).length;
  const stat = (value: number) => (result.loading ? '…' : result.error ? 'Unavailable' : value);
  const common = {
    loading: result.loading,
    error: result.error,
    onRetry: refresh,
    page,
    total: result.data?.total || 0,
    pageSize: 20,
    onPage: setPage,
  };
  return (
    <div className="business-workspace record-workspace unit-workspace">
      <PageHeader
        title="Units & conversions"
        subtitle="A shared language for quantities, stock and prices."
        breadcrumbs={[{ label: 'Operations', href: '/operations' }, { label: 'Units' }]}
        actions={
          canManage &&
          !embedded && (
            <Btn
              onClick={() =>
                entry.open(
                  kind === 'units'
                    ? { kind: 'unit', companyId }
                    : { kind: 'conversion', companyId },
                )
              }
            >
              New {kind === 'units' ? 'unit' : 'conversion'}
            </Btn>
          )
        }
      />
      <nav aria-label="Measurement registers" className="unit-sections">
        {(['units', 'unit-conversions'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setPage(1);
              setNotice('');
            }}
          >
            {k === 'units' ? 'Units' : 'Conversions'}
          </button>
        ))}
      </nav>
      <div className="workspace-summary">
        <div>
          <span>Matching {kind === 'units' ? 'units' : 'conversions'}</span>
          <strong>{stat(result.data?.total || 0)}</strong>
        </div>
        <div>
          <span>Active on this page</span>
          <strong>{stat(active)}</strong>
        </div>
        <div>
          <span>Scope</span>
          <strong>{companyId ? scopeName({ companyId }) : 'All accessible'}</strong>
        </div>
      </div>
      <p className="unit-help">
        {companyId
          ? 'This company’s records and shared records.'
          : 'Records available to your account.'}{' '}
        CSV includes every matching page. PDF supports up to 5,000 records.
      </p>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {companies.error && (
        <p role="alert" className="workspace-notice">
          Company choices unavailable. {companies.error}{' '}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry company choices
          </Btn>
        </p>
      )}
      {exportError && (
        <p role="alert" className="workspace-notice">
          {exportError} Retry with an export button below.
        </p>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={
          kind === 'units'
            ? 'Search units by name or symbol…'
            : 'Search conversions by unit or description…'
        }
        collapsibleFilters
        activeFilterCount={[companyId, status, kind === 'units' && unitType].filter(Boolean).length}
        filters={
          <>
            {canChoose && !embedded && (
              <FormSelect
                label="Company filter"
                value={companyId}
                disabled={companies.loading || !!companies.error}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setPage(1);
                }}
                placeholder="All accessible companies"
                options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </FormSelect>
            {kind === 'units' && (
              <FormSelect
                label="Type filter"
                value={unitType}
                onChange={(e) => {
                  setUnitType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All types</option>
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {unitTypeLabel(t)}
                  </option>
                ))}
              </FormSelect>
            )}
            <Btn
              variant="ghost"
              onClick={() => {
                setCompanyId(initialCompanyId);
                setStatus('');
                setUnitType('');
                setSearch('');
                setPage(1);
              }}
            >
              Clear filters
            </Btn>
          </>
        }
        actions={
          <>
            {embedded && canManage && (
              <Btn
                onClick={() =>
                  entry.open(
                    kind === 'units'
                      ? { kind: 'unit', companyId }
                      : { kind: 'conversion', companyId },
                  )
                }
              >
                New {kind === 'units' ? 'unit' : 'conversion'}
              </Btn>
            )}
            <Btn variant="secondary" disabled={result.loading} onClick={refresh}>
              Refresh
            </Btn>
            <Btn
              variant="secondary"
              disabled={!records.length || exportBusy || search.trim() !== query}
              onClick={() => void exportRows('csv')}
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              disabled={!records.length || exportBusy || search.trim() !== query}
              onClick={() => void exportRows('pdf')}
            >
              Export PDF
            </Btn>
          </>
        }
      />
      {exportBusy && (
        <p role="status" className="unit-help">
          Preparing the full filtered export…
        </p>
      )}
      {entry.drafts}
      {kind === 'units' ? (
        <RecordBrowser<Unit>
          key={scopeKey}
          stateKey={stateKey + '.' + kind + '.record'}
          selectionScope={scopeKey}
          title="Units"
          records={records as Unit[]}
          name={(r) => r.name}
          reference={(r) => `${r.symbol} · ${unitTypeLabel(r.unitType)}`}
          status={(r) => r.status}
          fields={[{ label: 'Scope', value: unitScope }]}
          details={[
            { label: 'Symbol', value: (r) => r.symbol },
            { label: 'Type', value: (r) => unitTypeLabel(r.unitType) },
            { label: 'Base unit', value: (r) => (r.isBaseUnit ? 'Yes' : 'No') },
            { label: 'System unit', value: (r) => (r.isSystemUnit ? 'Yes — protected' : 'No') },
          ]}
          actions={(r) =>
            r.isSystemUnit ? (
              <p className="unit-help">System units are read-only.</p>
            ) : canManage ? (
              <>
                <Btn variant="secondary" onClick={() => entry.open({ kind: 'unit', record: r })}>
                  Edit unit
                </Btn>
                <Btn variant="ghost" onClick={() => setDeletion({ kind: 'units', record: r })}>
                  Delete unit
                </Btn>
              </>
            ) : null
          }
          empty="No units match this view."
          {...common}
        />
      ) : (
        <RecordBrowser<UnitConversion>
          key={scopeKey}
          stateKey={stateKey + '.' + kind + '.record'}
          selectionScope={scopeKey}
          title="Conversions"
          records={records as UnitConversion[]}
          name={conversionName}
          reference={conversionEquation}
          status={(r) => (r.isActive ? 'ACTIVE' : 'INACTIVE')}
          fields={[{ label: 'Scope', value: scopeName }]}
          details={[
            {
              label: 'From',
              value: (r) => `${r.fromUnit?.name || r.fromUnitId} (${r.fromUnit?.symbol || '—'})`,
            },
            {
              label: 'To',
              value: (r) => `${r.toUnit?.name || r.toUnitId} (${r.toUnit?.symbol || '—'})`,
            },
            { label: 'Factor', value: (r) => String(r.conversionFactor) },
            { label: 'Description', value: (r) => r.description || '—' },
          ]}
          actions={(r) =>
            canManage ? (
              <>
                <Btn
                  variant="secondary"
                  onClick={() => entry.open({ kind: 'conversion', record: r })}
                >
                  Edit conversion
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={() => setDeletion({ kind: 'unit-conversions', record: r })}
                >
                  Delete conversion
                </Btn>
              </>
            ) : null
          }
          empty="No conversions match this view."
          {...common}
        />
      )}
      {deletion && (
        <UnitDelete
          {...deletion}
          onClose={() => setDeletion(null)}
          onDeleted={() =>
            saved(deletion.kind === 'units' ? 'Unit deleted.' : 'Conversion deleted.')
          }
        />
      )}
    </div>
  );
}
