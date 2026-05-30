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

interface LineageStep {
  stage: string;
  detail: string;
  reference: string;
}

interface DrillTarget {
  label: string;
  href: string;
  target: string;
  evidenceType?: string;
}

interface LineageResponse {
  lineage: LineageStep[];
  drillThrough: DrillTarget[];
  semanticModel?: {
    dataset: string;
    measures: string[];
    dimensions: string[];
    basis: string;
    grain: string;
  };
  sourceSystems?: { name: string; module: string; sourcePath: string }[];
  drillGraph?: { id: string; label: string; type: string; href: string }[];
  securityTrace?: {
    requiredPermission: string;
    scope: string[];
    accessLevel: string;
    rowLevelFilter: string;
    exportControl: string;
  };
  operationalBridge?: {
    upstream: string[];
    downstream: string[];
    closeImpact: string;
  };
}

interface QualityWarning {
  severity?: string;
  title: string;
  description?: string | null;
  source?: string;
  issueNumber?: string;
  status?: string;
  detectedAt?: string;
}

interface QualitySurface {
  readinessScore: number;
  trustStatus: string;
  severityCounts: Record<string, number>;
  affectedDimensions: string[];
  displayMode: string;
  remediationActions: string[];
  officialUse: string;
}

interface ExplainResponse {
  summary: string;
  basis: string;
  drivers: { label: string; value: string; interpretation: string }[];
  recommendedDrillDowns: DrillTarget[];
  explainThisNumber?: {
    mode: string;
    confidence: string;
    semanticDataset: string;
    formulaTrace: string[];
    sourceSystems: string[];
    groundingSignals: string[];
    generatedNarrative: string;
    nextBestActions: string[];
  };
  promptTemplates?: { prompt: string; reportId: string; reportName: string; semanticDataset: string; href: string }[];
  caveats: string[];
}

interface ReportResultMetrics {
  rowCount: number;
  columnCount: number;
  scalarCount: number;
  objectSectionCount: number;
  primarySection: string;
  dataHash: string;
}

interface ViewerRunManifest {
  runId: string;
  reportId: string;
  reportName: string;
  generatedAt: string;
  sourcePath: string;
  sourceUrl?: string;
  lifecycleStatus: string;
  securityClassification: string;
  metrics: ReportResultMetrics & { clientDataHash?: string };
  controls: {
    dataQualityAttached: boolean;
    lineageAttached: boolean;
    exportAuditRequired: boolean;
    snapshotEligible: boolean;
  };
  manifestHash: string;
  status: string;
}

interface ExportHistoryItem {
  id: string;
  exportNumber: string;
  format: string;
  status: string;
  fileName?: string | null;
  createdAt: string;
  completedAt?: string | null;
  auditHash?: string | null;
  runId?: string | null;
  metrics?: Partial<ReportResultMetrics>;
  exportedBy?: { fullName?: string | null; email?: string | null } | null;
}

interface ExportAuditHistory {
  total: number;
  exports: ExportHistoryItem[];
}

interface ExportAuditResponse {
  exportRecord?: { exportNumber: string; completedAt?: string; fileName?: string | null };
  audit?: {
    auditHash: string;
    runId?: string | null;
    dataHash?: string | null;
    exportedAt?: string;
    metrics?: Partial<ReportResultMetrics>;
  };
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

function formatDateTime(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stableClientHash(value: unknown): string {
  const json = JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = (v as Record<string, unknown>)[key];
            return acc;
          },
          {} as Record<string, unknown>,
        );
    }
    return v;
  });
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function summarizeResult(data: unknown): ReportResultMetrics {
  const primary = pickPrimaryTable(data);
  const columns = primary.rows.length ? flattenForCsv(primary.rows).columns : [];
  const scalars =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.entries(data as Record<string, unknown>).filter(([, v]) => isPrimitiveOrDate(v))
      : [];
  const objectSections =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.entries(data as Record<string, unknown>).filter(
          ([k, v]) =>
            !isPrimitiveOrDate(v) &&
            v !== null &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            k !== primary.key,
        )
      : [];
  return {
    rowCount: primary.rows.length,
    columnCount: columns.length,
    scalarCount: scalars.length,
    objectSectionCount: objectSections.length,
    primarySection: primary.key ?? 'Rows',
    dataHash: stableClientHash({
      primarySection: primary.key ?? 'Rows',
      rowCount: primary.rows.length,
      columnCount: columns.length,
      scalarCount: scalars.length,
      objectSectionCount: objectSections.length,
      firstRow: primary.rows[0] ?? null,
      lastRow: primary.rows[primary.rows.length - 1] ?? null,
      scalars,
    }),
  };
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
  const [lineage, setLineage] = useState<LineageResponse | null>(null);
  const [qualityWarnings, setQualityWarnings] = useState<QualityWarning[]>([]);
  const [qualitySurface, setQualitySurface] = useState<QualitySurface | null>(null);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);
  const [exporting, setExporting] = useState('');
  const [runManifest, setRunManifest] = useState<ViewerRunManifest | null>(null);
  const [exportHistory, setExportHistory] = useState<ExportHistoryItem[]>([]);
  const [lastExportAudit, setLastExportAudit] = useState<ExportAuditResponse['audit'] | null>(null);

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

  useEffect(() => {
    if (!entry || !reportId) return;
    const qs = new URLSearchParams();
    if (companyId) qs.set('companyId', companyId);
    if (divisionId) qs.set('divisionId', divisionId);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    if (asOf) qs.set('asOf', asOf);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    let cancelled = false;

    Promise.all([
      fetch(`/api/backend/reports/lineage/${encodeURIComponent(reportId)}${suffix}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/backend/reports/data-quality-warnings/${encodeURIComponent(reportId)}${suffix}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/backend/reports/explain/${encodeURIComponent(reportId)}${suffix}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([lineagePayload, warningPayload, explainPayload]) => {
      if (cancelled) return;
      setLineage((lineagePayload?.data ?? lineagePayload) as LineageResponse | null);
      const warnings = warningPayload?.data?.warnings ?? warningPayload?.warnings ?? [];
      setQualityWarnings(Array.isArray(warnings) ? warnings : []);
      setQualitySurface((warningPayload?.data?.surface ?? warningPayload?.surface ?? null) as QualitySurface | null);
      setExplanation((explainPayload?.data ?? explainPayload) as ExplainResponse | null);
    });

    return () => {
      cancelled = true;
    };
  }, [asOf, companyId, dateFrom, dateTo, divisionId, entry, reportId]);

  const loadExportHistory = useCallback(async () => {
    if (!entry || !reportId) return;
    const qs = new URLSearchParams();
    if (companyId) qs.set('companyId', companyId);
    qs.set('limit', '8');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    try {
      const response = await fetch(`/api/backend/reports/export-audit/${encodeURIComponent(reportId)}${suffix}`);
      if (!response.ok) return;
      const payload = await response.json();
      const history = (payload.data ?? payload) as ExportAuditHistory;
      setExportHistory(Array.isArray(history.exports) ? history.exports : []);
    } catch {
      setExportHistory([]);
    }
  }, [companyId, entry, reportId]);

  useEffect(() => {
    void loadExportHistory();
  }, [loadExportHistory]);

  const run = useCallback(async () => {
    if (!builtUrl) return;
    setLoading(true);
    setError('');
    setData(null);
    setRunManifest(null);
    setLastExportAudit(null);
    try {
      const res = await fetch(builtUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result = json.data ?? json;
      const metrics = summarizeResult(result);
      setData(result);
      try {
        const manifestRes = await fetch(`/api/backend/reports/viewer/${encodeURIComponent(reportId)}/run-manifest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: companyId || undefined,
            sourceUrl: builtUrl,
            parameters: {
              divisionId: divisionId || undefined,
              dateFrom: dateFrom || undefined,
              dateTo: dateTo || undefined,
              asOf: asOf || undefined,
            },
            metrics,
            dataQualityAttached: true,
            lineageAttached: true,
          }),
        });
        if (manifestRes.ok) {
          const manifestPayload = await manifestRes.json();
          setRunManifest((manifestPayload.data ?? manifestPayload) as ViewerRunManifest);
        }
      } catch {
        // Report rendering remains available if manifest logging is temporarily unavailable.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run report');
    } finally {
      setLoading(false);
    }
  }, [asOf, builtUrl, companyId, dateFrom, dateTo, divisionId, reportId]);

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

  const recordExport = async (format: string) => {
    if (!entry) return;
    setExporting(format);
    try {
      const metrics = data ? summarizeResult(data) : summarizeResult(primary.rows);
      const response = await fetch('/api/backend/reports/export-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: entry.id,
          companyId: companyId || undefined,
          format,
          runId: runManifest?.runId,
          sourceUrl: builtUrl,
          dataHash: runManifest?.manifestHash ?? metrics.dataHash,
          rowCount: metrics.rowCount,
          columnCount: metrics.columnCount,
          scalarCount: metrics.scalarCount,
          objectSectionCount: metrics.objectSectionCount,
          sectionCount: metrics.objectSectionCount + (metrics.rowCount > 0 ? 1 : 0) + (metrics.scalarCount > 0 ? 1 : 0),
          parameters: {
            divisionId: divisionId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            asOf: asOf || undefined,
          },
        }),
      });
      if (response.ok) {
        const payload = await response.json();
        const audit = (payload.data ?? payload) as ExportAuditResponse;
        setLastExportAudit(audit.audit ?? null);
        void loadExportHistory();
      }
    } catch {
      // Keep client-side export usable if the audit write is temporarily unavailable.
    } finally {
      setExporting('');
    }
  };

  const downloadCsv = async () => {
    if (!primary.rows.length) return;
    await recordExport('CSV');
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

  const printPage = async () => {
    await recordExport('PDF');
    window.print();
  };

  const copyJson = async () => {
    if (!data) return;
    await recordExport('JSON');
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
              disabled={!primary.rows.length || exporting === 'CSV'}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting === 'CSV' ? 'Auditing...' : 'Export CSV'}
            </button>
            <button
              onClick={printPage}
              disabled={!data || exporting === 'PDF'}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting === 'PDF' ? 'Auditing...' : 'Print / PDF'}
            </button>
            <button
              onClick={copyJson}
              disabled={!data || exporting === 'JSON'}
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting === 'JSON' ? 'Auditing...' : 'Copy JSON'}
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
              {(lineage?.drillThrough?.map((target) => target.label) ?? entry.drillPaths ?? ['Summary', 'Record', 'Source']).map((step) => metaBadge(step, 'blue'))}
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

      {data !== null && (
        <Card className="p-4 print:hidden">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Run status
              </div>
              <div className="mt-2 flex items-center gap-2">
                {metaBadge(runManifest?.status ?? 'MANIFEST PENDING', runManifest ? 'green' : 'amber')}
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {runManifest?.runId ?? 'Awaiting server manifest'}
              </div>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Result shape
              </div>
              <div className="mt-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {runManifest?.metrics?.rowCount ?? primary.rows.length} rows / {runManifest?.metrics?.columnCount ?? flattenForCsv(primary.rows).columns.length} cols
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {runManifest?.metrics?.primarySection ?? primary.key ?? 'Rows'}
              </div>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Manifest hash
              </div>
              <div className="mt-2 break-all font-mono text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                {runManifest?.manifestHash ?? summarizeResult(data).dataHash}
              </div>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Export audit
              </div>
              <div className="mt-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {exportHistory.length} recent record{exportHistory.length === 1 ? '' : 's'}
              </div>
              <div className="mt-1 break-all font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {lastExportAudit?.auditHash ?? exportHistory[0]?.auditHash ?? 'No export in this view'}
              </div>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Snapshot eligible
              </div>
              <div className="mt-2">
                {metaBadge(runManifest?.controls?.snapshotEligible ? 'YES' : 'LIVE VIEW', runManifest?.controls?.snapshotEligible ? 'green' : 'blue')}
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                {formatDateTime(runManifest?.generatedAt)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {(qualitySurface || qualityWarnings.length > 0) && (
        <Card className="p-4 print:hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Data-quality warning surface
              </div>
              {qualitySurface && (
                <div className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                  {qualitySurface.officialUse}
                </div>
              )}
            </div>
            {qualitySurface && metaBadge(`${qualitySurface.readinessScore}% ${qualitySurface.trustStatus}`, qualitySurface.readinessScore >= 90 ? 'green' : 'amber')}
          </div>
          {qualitySurface && (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                  Affected dimensions
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {qualitySurface.affectedDimensions.map((dimension) => (
                    <span key={dimension}>{metaBadge(dimension, 'blue')}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border p-3 md:col-span-2" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                  Remediation actions
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {qualitySurface.remediationActions.map((action) => (
                    <div key={action} className="text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                      {action}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {qualityWarnings.slice(0, 6).map((warning) => (
              <div
                key={`${warning.issueNumber ?? warning.title}-${warning.source ?? 'computed'}`}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--aurora-warning)',
                  background: 'var(--aurora-warning-bg)',
                  color: 'var(--aurora-warning-text)',
                }}
              >
                <div className="font-semibold">
                  {warning.severity ? `${warning.severity}: ` : ''}
                  {warning.title}
                </div>
                {warning.description && <div className="mt-1 text-xs leading-5">{warning.description}</div>}
              </div>
            ))}
            {qualityWarnings.length === 0 && (
              <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
                No blocking warning records were returned for this report and scope.
              </div>
            )}
          </div>
        </Card>
      )}

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
              {explanation ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {explanation.summary}
                  </p>
                  <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                    Basis: {explanation.basis}
                  </div>
                  {explanation.explainThisNumber && (
                    <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">Explain this number</div>
                        {metaBadge(explanation.explainThisNumber.confidence, 'blue')}
                      </div>
                      <p className="mt-2 text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                        {explanation.explainThisNumber.generatedNarrative}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {explanation.explainThisNumber.formulaTrace.slice(0, 4).map((item) => (
                          <span key={item}>{metaBadge(item, 'neutral')}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {explanation.drivers.slice(0, 4).map((driver) => (
                    <div key={driver.label} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                      <div className="font-semibold">{driver.label}</div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {driver.value}
                      </div>
                      <div className="mt-1 text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                        {driver.interpretation}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
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
              )}
            </Card>
            <Card>
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Lineage
              </div>
              {lineage?.semanticModel && (
                <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                  <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    {lineage.semanticModel.dataset}
                  </div>
                  <div className="mt-1" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {lineage.semanticModel.basis} / {lineage.semanticModel.grain}
                  </div>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {(lineage?.lineage ?? []).slice(0, 5).map((step) => (
                  <div
                    key={`${step.stage}-${step.reference}`}
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      background: 'var(--aurora-bg-subtle)',
                      color: 'var(--aurora-text-secondary)',
                    }}
                  >
                    <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                      {step.stage}
                    </div>
                    <div className="mt-1 text-xs leading-5">{step.detail}</div>
                  </div>
                ))}
                {!lineage?.lineage?.length && (
                  <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    Lineage loads after the report metadata is available.
                  </div>
                )}
              </div>
              {lineage?.sourceSystems && lineage.sourceSystems.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                    Source systems
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lineage.sourceSystems.map((source) => (
                      <a key={`${source.module}-${source.name}`} href={source.sourcePath} className="text-xs text-brand-500 hover:underline">
                        {source.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {lineage?.securityTrace && (
                <div className="mt-4 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--aurora-border)' }}>
                  <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    Security trace
                  </div>
                  <div className="mt-1 leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {lineage.securityTrace.requiredPermission} / {lineage.securityTrace.rowLevelFilter}
                  </div>
                  <div className="mt-1 leading-5" style={{ color: 'var(--aurora-text-muted)' }}>
                    {lineage.securityTrace.exportControl}
                  </div>
                </div>
              )}
              {lineage?.operationalBridge && (
                <div className="mt-4 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                  <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    Operations bridge
                  </div>
                  <div className="mt-1 leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {lineage.operationalBridge.closeImpact}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lineage.operationalBridge.downstream.slice(0, 4).map((item) => (
                      <span key={item}>{metaBadge(item, 'blue')}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Export audit trail
                </div>
                <button
                  type="button"
                  onClick={() => void loadExportHistory()}
                  className="rounded-md border px-2 py-1 text-[11px]"
                  style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
                >
                  Refresh
                </button>
              </div>
              {lastExportAudit && (
                <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--aurora-success)', background: 'var(--aurora-success-bg)', color: 'var(--aurora-success-text)' }}>
                  Last export hash: <span className="font-mono">{lastExportAudit.auditHash}</span>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {exportHistory.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {item.exportNumber}
                      </span>
                      {metaBadge(item.format, 'blue')}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {formatDateTime(item.completedAt ?? item.createdAt)} / {item.status}
                    </div>
                    {item.auditHash && (
                      <div className="mt-1 break-all font-mono text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                        {item.auditHash}
                      </div>
                    )}
                  </div>
                ))}
                {exportHistory.length === 0 && (
                  <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
                    No export audit records found for this report and scope.
                  </div>
                )}
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
