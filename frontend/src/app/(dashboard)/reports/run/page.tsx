'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';

interface CatalogEntry {
  id: string;
  sector: string;
  category: string;
  name: string;
  description: string;
  scopes: string[];
  permission: string;
  apiPath: string;
  frontendPath: string;
  reportType?: string;
  lifecycleStatus?: string;
  owner?: string;
  dataFreshness?: string;
  securityClassification?: string;
  outputFormats?: string[];
  tags?: string[];
  businessQuestions?: string[];
  drillPaths?: string[];
  relatedCapabilities?: string[];
}

const fmtNumber = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) {
      return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return String(v);
};

const isPrimitive = (v: unknown): v is string | number | boolean =>
  v === null ||
  v === undefined ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean';

const isPrimitiveOrDate = (v: unknown): boolean => {
  if (isPrimitive(v)) return true;
  if (v instanceof Date) return true;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  return false;
};

const isFlatObject = (obj: unknown): obj is Record<string, unknown> => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.values(obj).every(
    (v) =>
      isPrimitiveOrDate(v) ||
      (typeof v === 'object' &&
        v !== null &&
        !Array.isArray(v) &&
        Object.values(v as Record<string, unknown>).every(isPrimitiveOrDate)),
  );
};

/**
 * Walk a response and pick the most informative table to render: the
 * top-level array field with the most rows whose elements are flat objects.
 * Falls back to the response itself if it's already an array.
 */
function pickPrimaryTable(data: unknown): { key: string | null; rows: Record<string, unknown>[] } {
  if (Array.isArray(data) && data.length > 0 && isFlatObject(data[0])) {
    return { key: null, rows: data as Record<string, unknown>[] };
  }
  if (data && typeof data === 'object') {
    let best: { key: string; rows: Record<string, unknown>[] } | null = null;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 0 && isFlatObject(v[0])) {
        if (!best || v.length > best.rows.length)
          best = { key: k, rows: v as Record<string, unknown>[] };
      }
    }
    if (best) return best;
  }
  return { key: null, rows: [] };
}

function flattenForCsv(rows: Record<string, unknown>[]): { columns: string[]; data: string[][] } {
  const columnSet = new Set<string>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (isPrimitiveOrDate(v)) {
        columnSet.add(k);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const sk of Object.keys(v as Record<string, unknown>)) {
          columnSet.add(`${k}.${sk}`);
        }
      }
    }
  }
  const columns = Array.from(columnSet);
  const data = rows.map((r) =>
    columns.map((c) => {
      const dot = c.indexOf('.');
      let val: unknown;
      if (dot === -1) {
        val = r[c];
      } else {
        const head = c.slice(0, dot);
        const tail = c.slice(dot + 1);
        const parent = r[head] as Record<string, unknown> | undefined;
        val = parent?.[tail];
      }
      if (val === null || val === undefined) return '';
      if (val instanceof Date) return val.toISOString();
      return String(val);
    }),
  );
  return { columns, data };
}

function toCsv(columns: string[], rows: string[][]): string {
  const escape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [columns, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

function metaBadge(label: string, tone: 'neutral' | 'green' | 'amber' | 'red' | 'blue' = 'neutral') {
  const styles = {
    neutral: { background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)', borderColor: 'var(--aurora-border)' },
    green: { background: 'var(--aurora-success-bg)', color: 'var(--aurora-success-text)', borderColor: 'var(--aurora-success)' },
    amber: { background: 'var(--aurora-warning-bg)', color: 'var(--aurora-warning-text)', borderColor: 'var(--aurora-warning)' },
    red: { background: 'var(--aurora-danger-bg)', color: 'var(--aurora-danger-text)', borderColor: 'var(--aurora-danger)' },
    blue: { background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary-text)', borderColor: 'var(--aurora-border)' },
  }[tone];
  return (
    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium" style={styles}>
      {label}
    </span>
  );
}

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Division {
  id: string;
  name: string;
  code: string;
  companyId: string;
}

function ReportRunContent() {
  const params = useSearchParams();
  const reportId = params.get('reportId') ?? '';
  const initialCompanyId = params.get('companyId') ?? '';
  const initialDivisionId = params.get('divisionId') ?? '';

  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [divisionId, setDivisionId] = useState(initialDivisionId);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [asOf, setAsOf] = useState('');

  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load catalog and find the entry.
  useEffect(() => {
    if (!reportId) return;
    fetch(`/api/backend/reports/catalog`)
      .then((r) => r.json())
      .then((j) => {
        const list: CatalogEntry[] = j.data?.entries ?? j.entries ?? [];
        setEntry(list.find((e) => e.id === reportId) ?? null);
      })
      .catch(() => setError('Failed to load report catalog'))
      .finally(() => setCatalogLoading(false));
  }, [reportId]);

  // Companies + divisions.
  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Company[] = Array.isArray(inner)
          ? inner
          : Array.isArray(inner?.data)
            ? inner.data
            : [];
        setCompanies(rows);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      return;
    }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=50`)
      .then((r) => r.json())
      .then((j) => {
        const inner = j.data?.data ?? j.data;
        const rows: Division[] = Array.isArray(inner)
          ? inner
          : Array.isArray(inner?.data)
            ? inner.data
            : [];
        setDivisions(rows);
      })
      .catch(() => {});
  }, [companyId]);

  // Build the URL for the chosen entry, filling :id / {companyId} placeholders
  // and appending querystring params for the rest.
  const builtUrl = useMemo(() => {
    if (!entry) return '';
    let path = entry.apiPath;
    if (path.includes('{companyId}')) {
      if (!companyId) return '';
      path = path.replace('{companyId}', companyId);
    }
    if (path.includes('{id}')) return ''; // Per-record reports — not auto-runnable.
    const qs = new URLSearchParams();
    if (companyId && !path.includes(companyId)) qs.set('companyId', companyId);
    if (divisionId) qs.set('divisionId', divisionId);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    if (asOf) qs.set('asOf', asOf);
    const s = qs.toString();
    return s ? `/api/backend${path}?${s}` : `/api/backend${path}`;
  }, [entry, companyId, divisionId, dateFrom, dateTo, asOf]);

  const run = useCallback(async () => {
    if (!builtUrl) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch(builtUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run report');
    } finally {
      setLoading(false);
    }
  }, [builtUrl]);

  // Auto-run when the URL is fully resolved.
  useEffect(() => {
    if (entry && builtUrl) run();
  }, [entry, builtUrl, run]);

  const primary = useMemo(() => pickPrimaryTable(data), [data]);
  const scalars = useMemo(() => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    return Object.entries(data as Record<string, unknown>).filter(([, v]) => isPrimitiveOrDate(v));
  }, [data]);
  const otherObjects = useMemo(() => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    return Object.entries(data as Record<string, unknown>).filter(
      ([k, v]) =>
        !isPrimitiveOrDate(v) &&
        v !== null &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        k !== primary.key,
    );
  }, [data, primary.key]);

  const downloadCsv = () => {
    if (!primary.rows.length) return;
    const { columns, data: rows } = flattenForCsv(primary.rows);
    const csv = toCsv(columns, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry?.id ?? 'report'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPage = () => window.print();

  const copyJson = () => {
    if (!data) return;
    navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
  };

  if (!reportId) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <div className="text-sm text-slate-600">
            No <code>reportId</code> in the URL. Browse the{' '}
            <a href="/reports" className="text-indigo-600 hover:underline">
              Reports catalog
            </a>{' '}
            to pick one.
          </div>
        </Card>
      </div>
    );
  }

  if (catalogLoading) {
    return (
      <div className="p-6">
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="p-6">
        <Card className="p-6">
          <div className="text-sm text-rose-700">
            Report <code>{reportId}</code> not found in the catalog.
          </div>
        </Card>
      </div>
    );
  }

  const needsCompany = entry.scopes.includes('COMPANY') || entry.apiPath.includes('{companyId}');
  const supportsDivision = entry.scopes.includes('DIVISION');
  const needsDates = [
    'Statements',
    'Sales',
    'Group Cross-sector',
    'Audit',
    'Group',
    'Inventory',
    'Procurement',
  ].includes(entry.category);
  const needsAsOf = /balance-sheet/.test(entry.id);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={entry.name}
        subtitle={entry.description}
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
          { label: entry.sector },
          { label: entry.name },
        ]}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={run}
              disabled={loading || !builtUrl}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? 'Running…' : 'Run'}
            </button>
            <button
              onClick={downloadCsv}
              disabled={!primary.rows.length}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={printPage}
              disabled={!data}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Print / PDF
            </button>
            <button
              onClick={copyJson}
              disabled={!data}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Copy JSON
            </button>
          </div>
        }
      />

      <Card className="p-4 print:hidden">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="flex flex-wrap gap-2">
              {entry.lifecycleStatus &&
                metaBadge(
                  entry.lifecycleStatus,
                  entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL'
                    ? 'green'
                    : 'blue',
                )}
              {entry.reportType && metaBadge(entry.reportType.replace(/_/g, ' '), 'neutral')}
              {entry.securityClassification &&
                metaBadge(
                  entry.securityClassification,
                  entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED'
                    ? 'red'
                    : 'blue',
                )}
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2" style={{ color: 'var(--aurora-text-secondary)' }}>
              <div>Owner: {entry.owner ?? 'Report owner not assigned'}</div>
              <div>Freshness: {entry.dataFreshness ?? 'Endpoint-defined'}</div>
              <div>Scope: {entry.scopes.join(', ')}</div>
              <div>Outputs: {(entry.outputFormats ?? ['HTML', 'CSV', 'JSON']).join(', ')}</div>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
              Drill and lineage path
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(entry.drillPaths ?? ['Summary', 'Record', 'Source']).map((step) => metaBadge(step, 'blue'))}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          {needsCompany && (
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                Company
              </div>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setDivisionId('');
                }}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">— Select Company —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {supportsDivision && companyId && (
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                Division
              </div>
              <select
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">— All Divisions —</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {needsDates && (
            <>
              <div>
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                  Date From
                </div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                  Date To
                </div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            </>
          )}
          {needsAsOf && (
            <div>
              <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                As Of
              </div>
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          )}
          <div className="text-[10px] text-slate-400 font-mono ml-auto">
            {builtUrl || '⚠ insufficient parameters'}
          </div>
        </div>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && data !== null && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
          {scalars.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                Summary
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                {scalars.map(([k, v]) => (
                  <div key={k} className="border border-slate-200 rounded-md p-3">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                      {k}
                    </div>
                    <div className="text-sm font-semibold text-slate-800 break-words">
                      {fmtNumber(v)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {primary.rows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="text-xs text-slate-500 uppercase tracking-wide">
                  {primary.key ?? 'Rows'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {primary.rows.length} row{primary.rows.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {(() => {
                        const { columns } = flattenForCsv(primary.rows);
                        return columns.map((c) => (
                          <th
                            key={c}
                            className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide"
                          >
                            {c}
                          </th>
                        ));
                      })()}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const { columns, data } = flattenForCsv(primary.rows);
                      return data.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-4 py-2 text-slate-700">
                              {cell || '—'}
                            </td>
                          ))}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {otherObjects.map(([k, v]) => (
            <Card key={k} className="overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                {k}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                {Object.entries(v as Record<string, unknown>).map(([sk, sv]) => (
                  <div key={sk} className="border border-slate-200 rounded-md p-3">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                      {sk}
                    </div>
                    <div className="text-sm font-semibold text-slate-800 break-words">
                      {fmtNumber(sv)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          </div>
          <div className="space-y-4 print:hidden">
            <Card>
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Explain this report
              </div>
              <div className="mt-3 space-y-2">
                {(entry.businessQuestions ?? [
                  'What changed?',
                  'Why did it happen?',
                  'Which source records explain this number?',
                ]).map((question) => (
                  <div
                    key={question}
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      background: 'var(--aurora-bg-subtle)',
                      color: 'var(--aurora-text-secondary)',
                    }}
                  >
                    {question}
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Related actions
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(entry.relatedCapabilities ?? ['Export', 'Schedule', 'Lineage']).map((action) =>
                  metaBadge(action, 'neutral'),
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportRunPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      }
    >
      <ReportRunContent />
    </Suspense>
  );
}
