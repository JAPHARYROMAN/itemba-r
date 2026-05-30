'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, StatCard } from '@/components/ui';

interface ReportDefinition {
  id: string;
  reportCode: string;
  name: string;
  reportCategory?: string;
  datasetKey?: string;
  isActive?: boolean;
}

interface CatalogEntry {
  id: string;
  name: string;
  sector: string;
  category: string;
  reportType?: string;
  apiPath?: string;
}

interface Company {
  id: string;
  name: string;
  code: string;
}

interface RunResult {
  id?: string;
  reportRunNumber?: string;
  status?: string;
  resultSummary?: unknown;
  rowCount?: number;
  executionTimeMs?: number;
  error?: string;
}

type SelectableReport =
  | {
      value: `definition:${string}`;
      kind: 'definition';
      id: string;
      name: string;
      code: string;
      category: string;
      detail: string;
    }
  | {
      value: `catalog:${string}`;
      kind: 'catalog';
      id: string;
      name: string;
      code: string;
      category: string;
      detail: string;
    };

const inputClass =
  'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/40';

const controlStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
};

function extractRows<T>(payload: unknown): T[] {
  const data = (payload as { data?: unknown })?.data;
  const nested = (data as { data?: unknown })?.data;
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray(data)) return data as T[];
  if (Array.isArray(nested)) return nested as T[];
  return [];
}

function extractCatalogEntries(payload: unknown): CatalogEntry[] {
  const data = (payload as { data?: unknown })?.data;
  const directEntries = (payload as { entries?: unknown })?.entries;
  const wrappedEntries = (data as { entries?: unknown })?.entries;
  if (Array.isArray(directEntries)) return directEntries as CatalogEntry[];
  if (Array.isArray(wrappedEntries)) return wrappedEntries as CatalogEntry[];
  return [];
}

function getCookie(name: string) {
  if (typeof document === 'undefined') return '';
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1];
}

function summarize(value: unknown) {
  if (!value) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ReportBuilderPage() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedReport, setSelectedReport] = useState('');
  const [form, setForm] = useState({ companyId: '', dateFrom: '', dateTo: '' });
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/backend/bi/report-definitions?limit=200&isActive=true')
        .then((response) => response.json())
        .then((json) => extractRows<ReportDefinition>(json))
        .catch(() => []),
      fetch('/api/backend/reports/catalog')
        .then((response) => response.json())
        .then((json) => extractCatalogEntries(json))
        .catch(() => []),
      fetch('/api/backend/companies?limit=100')
        .then((response) => response.json())
        .then((json) => extractRows<Company>(json))
        .catch(() => []),
    ])
      .then(([nextDefinitions, nextCatalogEntries, nextCompanies]) => {
        if (cancelled) return;
        setDefinitions(nextDefinitions);
        setCatalogEntries(nextCatalogEntries);
        setCompanies(nextCompanies);
        setForm((current) => ({
          ...current,
          companyId: current.companyId || nextCompanies[0]?.id || '',
        }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load reports');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectableReports = useMemo<SelectableReport[]>(() => {
    const definitionOptions: SelectableReport[] = definitions.map((definition) => ({
      value: `definition:${definition.id}`,
      kind: 'definition',
      id: definition.id,
      name: definition.name,
      code: definition.reportCode,
      category: definition.reportCategory ?? 'Custom BI',
      detail: definition.datasetKey ? `Dataset: ${definition.datasetKey}` : 'BI report definition',
    }));

    const catalogOptions: SelectableReport[] = catalogEntries.map((entry) => ({
      value: `catalog:${entry.id}`,
      kind: 'catalog',
      id: entry.id,
      name: entry.name,
      code: entry.id,
      category: `${entry.sector} / ${entry.category}`,
      detail: entry.reportType ?? 'Catalog report',
    }));

    return [...definitionOptions, ...catalogOptions];
  }, [catalogEntries, definitions]);

  const selected = selectableReports.find((report) => report.value === selectedReport);

  async function runReport() {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    setError('');

    try {
      if (selected.kind === 'catalog') {
        const params = new URLSearchParams({ reportId: selected.id });
        if (form.companyId) params.set('companyId', form.companyId);
        if (form.dateFrom) params.set('dateFrom', form.dateFrom);
        if (form.dateTo) params.set('dateTo', form.dateTo);
        router.push(`/reports/run?${params.toString()}`);
        return;
      }

      const csrf = getCookie('itemba_csrf');
      const response = await fetch('/api/backend/bi/report-runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify({
          reportDefinitionId: selected.id,
          companyId: form.companyId || undefined,
          filters: {
            dateFrom: form.dateFrom || undefined,
            dateTo: form.dateTo || undefined,
          },
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.message ?? json?.error ?? 'Failed to run report');
      }
      setResult((json?.data ?? json) as RunResult);
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Report Builder"
        subtitle="Select a governed BI definition or any report from the master catalog."
      />

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="BI definitions" value={definitions.length} variant="blue" />
        <StatCard label="Catalog reports" value={catalogEntries.length} variant="green" />
        <StatCard
          label="Available reports"
          value={selectableReports.length}
          hint={loading ? 'Loading...' : 'Ready to select'}
          variant={selectableReports.length > 0 ? 'green' : 'amber'}
        />
      </div>

      <Card className="max-w-3xl">
        <div className="space-y-5">
          <label className="block">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              Report
            </span>
            <select
              value={selectedReport}
              onChange={(event) => {
                setSelectedReport(event.target.value);
                setResult(null);
              }}
              className={`${inputClass} mt-2`}
              style={controlStyle}
              disabled={loading}
            >
              <option value="">{loading ? 'Loading reports...' : 'Select report'}</option>
              {definitions.length > 0 && (
                <optgroup label="BI report definitions">
                  {definitions.map((definition) => (
                    <option key={definition.id} value={`definition:${definition.id}`}>
                      {definition.name} ({definition.reportCode})
                    </option>
                  ))}
                </optgroup>
              )}
              {catalogEntries.length > 0 && (
                <optgroup label="Master reports catalog">
                  {catalogEntries.map((entry) => (
                    <option key={entry.id} value={`catalog:${entry.id}`}>
                      {entry.name} ({entry.sector})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          {selected && (
            <div
              className="rounded-lg border p-4 text-sm"
              style={{ ...controlStyle, color: 'var(--aurora-text-secondary)' }}
            >
              <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {selected.name}
              </div>
              <div className="mt-1">{selected.category}</div>
              <div className="mt-1">{selected.detail}</div>
            </div>
          )}

          <label className="block">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              Company
            </span>
            <select
              value={form.companyId}
              onChange={(event) => setForm({ ...form, companyId: event.target.value })}
              className={`${inputClass} mt-2`}
              style={controlStyle}
            >
              <option value="">Group-wide / default scope</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name} ({company.code})
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                Date From
              </span>
              <input
                type="date"
                value={form.dateFrom}
                onChange={(event) => setForm({ ...form, dateFrom: event.target.value })}
                className={`${inputClass} mt-2`}
                style={controlStyle}
              />
            </label>
            <label className="block">
              <span
                className="text-sm font-semibold"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                Date To
              </span>
              <input
                type="date"
                value={form.dateTo}
                onChange={(event) => setForm({ ...form, dateTo: event.target.value })}
                className={`${inputClass} mt-2`}
                style={controlStyle}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => void runReport()}
            disabled={running || !selectedReport}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running
              ? 'Running...'
              : selected?.kind === 'catalog'
                ? 'Open Report Viewer'
                : 'Run BI Report'}
          </button>
        </div>

        {result && (
          <div
            className={`mt-5 rounded-lg border p-4 text-sm ${
              result.error
                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            {result.error ? (
              <p>Error: {result.error}</p>
            ) : (
              <div className="space-y-2">
                <p>
                  <strong>Status:</strong> {result.status ?? 'Completed'}
                </p>
                {result.reportRunNumber && (
                  <p>
                    <strong>Run:</strong> {result.reportRunNumber}
                  </p>
                )}
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-3 text-xs">
                  {summarize(result.resultSummary)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
