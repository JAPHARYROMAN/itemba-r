'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, StatCard } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

type MetaStatus = 'READY' | 'INFO' | 'WARNING' | 'CRITICAL' | 'BLOCKED' | 'NEEDS_REVIEW';

interface ReportCard {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  icon: string;
  category: string;
  outputFormats: string[];
  primaryAction: string;
  queryMode?: 'range' | 'daily-close';
}

interface ReportReadinessCheck {
  key?: string;
  status?: MetaStatus | string;
  label?: string;
  detail?: string;
}

interface ReportMeta {
  readiness?: {
    status?: MetaStatus | string;
    score?: number;
    target?: number;
    message?: string;
    checks?: ReportReadinessCheck[];
  };
  lineage?: {
    source?: string;
    sourceTables?: string[];
    measures?: string[];
    scope?: string;
  };
  drillThrough?: Array<{
    label: string;
    href: string;
    entityType?: string;
    entityId?: string | null;
  }>;
  actions?: Array<{
    label: string;
    href: string;
    kind?: string;
  }>;
}

interface NormalizedReport {
  rows: Record<string, unknown>[];
  raw: unknown;
  meta?: ReportMeta & {
    generatedAt?: string;
    exportOptions?: string[];
    scope?: Record<string, unknown>;
  };
}

interface ReportTableProps {
  data: Record<string, unknown>[];
}

const REPORTS: ReportCard[] = [
  {
    key: 'daily-close',
    title: 'Daily Close / Z-Report',
    description: 'Close readiness, payment reconciliation, and sales-order evidence for a day.',
    endpoint: '/api/backend/westsides/reports/daily-close',
    icon: 'Z',
    category: 'Controls',
    outputFormats: ['PRINT', 'CSV', 'JSON'],
    primaryAction: 'Open close screen',
    queryMode: 'daily-close',
  },
  {
    key: 'daily-sales-summary',
    title: 'Daily Sales Summary',
    description: 'Day-by-day sales totals, transaction counts, and source-order drill-through.',
    endpoint: '/api/backend/westsides/reports/daily-sales-summary',
    icon: 'DS',
    category: 'Sales',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review day orders',
  },
  {
    key: 'monthly-sales-summary',
    title: 'Monthly Sales Summary',
    description: 'Month-over-month sales performance with order-level drill-through hints.',
    endpoint: '/api/backend/westsides/reports/monthly-sales-summary',
    icon: 'MS',
    category: 'Sales',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review month orders',
  },
  {
    key: 'sales-by-channel',
    title: 'Sales by Channel',
    description: 'Sales breakdown by cash, credit, wholesale, retail, and other channels.',
    endpoint: '/api/backend/westsides/reports/sales-by-channel',
    icon: 'SC',
    category: 'Sales',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Open sales orders',
  },
  {
    key: 'sales-by-product',
    title: 'Sales by Product',
    description: 'Sales volume, average selling price, and revenue by product.',
    endpoint: '/api/backend/westsides/reports/sales-by-product',
    icon: 'SP',
    category: 'Sales',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review product',
  },
  {
    key: 'sales-by-cashier',
    title: 'Sales by Salesperson',
    description: 'Sales totals grouped by salesperson, including attribution warnings.',
    endpoint: '/api/backend/westsides/reports/sales-by-cashier',
    icon: 'SS',
    category: 'People',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review salesperson orders',
  },
  {
    key: 'product-profitability',
    title: 'Product Profitability',
    description: 'Revenue, estimated cost, gross profit, and margin by product.',
    endpoint: '/api/backend/westsides/reports/product-profitability',
    icon: 'GP',
    category: 'Margin',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review margin drivers',
  },
  {
    key: 'fast-moving-items',
    title: 'Fast Moving Items',
    description: 'Top selling products by quantity, with replenishment drill-through.',
    endpoint: '/api/backend/westsides/reports/fast-moving-items',
    icon: 'FM',
    category: 'Inventory',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review stock',
  },
  {
    key: 'slow-moving-items',
    title: 'Slow Moving Items',
    description: 'Products with stock on hand but no recent sales movement.',
    endpoint: '/api/backend/westsides/reports/slow-moving-items',
    icon: 'SM',
    category: 'Inventory',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review stock risk',
  },
  {
    key: 'batch-status',
    title: 'Batch Status Report',
    description: 'Batch expiry, depletion, remaining quantity, and stock action risk.',
    endpoint: '/api/backend/westsides/reports/batch-status',
    icon: 'BS',
    category: 'Inventory',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Open batches',
  },
  {
    key: 'stock-damage-report',
    title: 'Stock Damage Report',
    description: 'Damage and breakage summary by type and approval status.',
    endpoint: '/api/backend/westsides/reports/stock-damage-report',
    icon: 'SD',
    category: 'Controls',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review damage',
  },
  {
    key: 'package-balance-report',
    title: 'Package Balance Report',
    description: 'Customer returnable package exposure and reconciliation routes.',
    endpoint: '/api/backend/westsides/reports/package-balance-report',
    icon: 'PB',
    category: 'Controls',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Open customer',
  },
  {
    key: 'quotation-conversion',
    title: 'Quotation Conversion',
    description: 'Quotation status mix, conversion rate, and leakage warning signals.',
    endpoint: '/api/backend/westsides/reports/quotation-conversion',
    icon: 'QC',
    category: 'Sales',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review quotations',
  },
  {
    key: 'delivery-performance',
    title: 'Delivery Performance',
    description: 'Delivery note performance by status and open fulfillment risk.',
    endpoint: '/api/backend/westsides/reports/delivery-performance',
    icon: 'DP',
    category: 'Fulfillment',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review deliveries',
  },
  {
    key: 'price-list-report',
    title: 'Price List Report',
    description: 'Price lists with item counts, effective dates, approval, and activity status.',
    endpoint: '/api/backend/westsides/reports/price-list-report',
    icon: 'PL',
    category: 'Pricing',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review price lists',
  },
  {
    key: 'credit-customers',
    title: 'Credit Customers',
    description: 'Customers with receivable exposure and collection drill-through.',
    endpoint: '/api/backend/westsides/reports/credit-customers-report',
    icon: 'AR',
    category: 'Receivables',
    outputFormats: ['CSV', 'JSON', 'PRINT'],
    primaryAction: 'Review receivables',
  },
];

const controlStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
  colorScheme: 'dark',
} as const;

const inputClass =
  'h-10 rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/40';
const SETTINGS_KEY = 'itemba.westsides.reports.scope.v1';
const META_KEY = '_reportMeta';

function formatHeading(value: string) {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim();
}

function fmtValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
    return value;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function unwrapPayload(payload: unknown): unknown {
  const data = (payload as { data?: unknown })?.data;
  const nested = (data as { data?: unknown })?.data;
  return nested ?? data ?? payload;
}

function getRowMeta(row: Record<string, unknown>): ReportMeta | null {
  const meta = row[META_KEY];
  return meta && typeof meta === 'object' ? (meta as ReportMeta) : null;
}

function visibleColumns(data: Record<string, unknown>[]) {
  return Array.from(
    new Set(data.flatMap((row) => Object.keys(row).filter((key) => !key.startsWith('_')))),
  );
}

function normalizePayload(payload: unknown, report: ReportCard): NormalizedReport {
  const raw = unwrapPayload(payload);

  if (report.key === 'daily-close' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const close = raw as Record<string, unknown>;
    const readiness = close.readiness as ReportMeta['readiness'];
    const lineage = close.lineage as ReportMeta['lineage'];
    const actions = close.actions as ReportMeta['actions'];
    const meta = {
      readiness,
      lineage,
      actions,
      exportOptions: close.exportOptions as string[] | undefined,
      generatedAt: close.generatedAt as string | undefined,
      scope: close.scope as Record<string, unknown> | undefined,
    };
    const byMethod = Array.isArray(close.byMethod) ? close.byMethod : [];
    const mobile = Array.isArray(close.mobileMoneyReferences) ? close.mobileMoneyReferences : [];
    const orders = Array.isArray(close.orders) ? close.orders : [];
    const rows = [
      ...byMethod.map((row) => ({
        section: 'Payment Method',
        ...(row as Record<string, unknown>),
      })),
      ...mobile.map((row) => ({ section: 'Mobile Money', ...(row as Record<string, unknown>) })),
      ...orders.map((row) => ({ section: 'Sales Order', ...(row as Record<string, unknown>) })),
    ];
    return { rows, raw, meta };
  }

  if (Array.isArray(raw)) return { rows: raw as Record<string, unknown>[], raw };

  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    const arrayEntry = Object.entries(object).find(([, value]) => Array.isArray(value));
    if (arrayEntry) {
      return { rows: arrayEntry[1] as Record<string, unknown>[], raw };
    }
    return {
      rows: [object],
      raw,
      meta: {
        readiness: object.readiness as ReportMeta['readiness'],
        lineage: object.lineage as ReportMeta['lineage'],
        actions: object.actions as ReportMeta['actions'],
      },
    };
  }

  return { rows: [], raw };
}

function errorMessage(payload: unknown, fallback: string) {
  const body = payload as { message?: unknown; error?: unknown };
  const message = body?.message ?? body?.error;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

function statusStyle(status?: string) {
  const normalized = String(status ?? 'INFO').toUpperCase();
  if (normalized === 'READY') {
    return {
      background: 'rgba(16, 185, 129, 0.14)',
      borderColor: 'rgba(16, 185, 129, 0.45)',
      color: '#bbf7d0',
    };
  }
  if (normalized === 'WARNING' || normalized === 'NEEDS_REVIEW') {
    return {
      background: 'rgba(245, 158, 11, 0.16)',
      borderColor: 'rgba(245, 158, 11, 0.5)',
      color: '#fde68a',
    };
  }
  if (normalized === 'CRITICAL' || normalized === 'BLOCKED') {
    return {
      background: 'rgba(239, 68, 68, 0.16)',
      borderColor: 'rgba(239, 68, 68, 0.55)',
      color: '#fecaca',
    };
  }
  return {
    background: 'rgba(59, 130, 246, 0.14)',
    borderColor: 'rgba(59, 130, 246, 0.45)',
    color: '#bfdbfe',
  };
}

function StatusBadge({ status }: { status?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold uppercase"
      style={statusStyle(status)}
    >
      {String(status ?? 'Info').replace(/_/g, ' ')}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  );
}

function downloadText(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown) {
  const text = fmtValue(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function EmptyState({ report, onReload }: { report: ReportCard; onReload: () => void }) {
  return (
    <div className="px-5 py-12 text-center">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border text-sm font-bold"
        style={{
          borderColor: 'var(--aurora-border)',
          background: 'var(--aurora-bg-subtle)',
          color: 'var(--aurora-text)',
        }}
      >
        {report.icon}
      </div>
      <h3 className="mt-4 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
        No rows returned
      </h3>
      <p
        className="mx-auto mt-2 max-w-xl text-sm"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        The report loaded successfully, but the selected company, branch, or date filters did not
        produce reportable rows. Try a wider date range or all branches.
      </p>
      <button
        type="button"
        onClick={onReload}
        className="mt-5 rounded-lg border px-4 py-2 text-sm font-semibold transition hover:border-blue-500/70"
        style={{
          borderColor: 'var(--aurora-border)',
          background: 'var(--aurora-bg-subtle)',
          color: 'var(--aurora-text)',
        }}
      >
        Reload report
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-5 my-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-4">
      <div className="text-sm font-semibold text-red-100">Report could not be loaded</div>
      <div className="mt-1 text-sm text-red-200">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-red-300/50 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/20"
      >
        Retry
      </button>
    </div>
  );
}

function ReadinessPanel({
  rows,
  meta,
}: {
  rows: Record<string, unknown>[];
  meta?: NormalizedReport['meta'];
}) {
  const rowMetas = rows.map(getRowMeta).filter((item): item is ReportMeta => Boolean(item));
  const rowStatuses = rows
    .map((row) =>
      String(row.readinessStatus ?? getRowMeta(row)?.readiness?.status ?? '').toUpperCase(),
    )
    .filter(Boolean);
  const problemRows = rowStatuses.filter(
    (status) => status === 'WARNING' || status === 'CRITICAL' || status === 'BLOCKED',
  ).length;
  const sourceTables = Array.from(
    new Set([
      ...(meta?.lineage?.sourceTables ?? []),
      ...rowMetas.flatMap((item) => item.lineage?.sourceTables ?? []),
    ]),
  );
  const measures = Array.from(
    new Set([
      ...(meta?.lineage?.measures ?? []),
      ...rowMetas.flatMap((item) => item.lineage?.measures ?? []),
    ]),
  );
  const checks =
    meta?.readiness?.checks ?? rowMetas.flatMap((item) => item.readiness?.checks ?? []);
  const reportStatus = String(
    meta?.readiness?.status ?? (problemRows > 0 ? 'NEEDS_REVIEW' : 'READY'),
  );

  return (
    <div
      className="grid gap-3 border-b px-5 py-4 md:grid-cols-3"
      style={{ borderColor: 'var(--aurora-border)' }}
    >
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
        <div
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          Readiness
        </div>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={reportStatus} />
          {typeof meta?.readiness?.score === 'number' && (
            <span className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {meta.readiness.score}/{meta.readiness.target ?? 100}
            </span>
          )}
        </div>
        <div className="mt-2 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
          {meta?.readiness?.message ??
            (problemRows > 0
              ? `${problemRows} row${problemRows === 1 ? '' : 's'} require review.`
              : 'Rows are reportable with current metadata.')}
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
        <div
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          Lineage
        </div>
        <div className="mt-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {meta?.lineage?.source ?? 'Row-level lineage'}
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
          {sourceTables.length > 0 ? sourceTables.join(', ') : 'Source tables supplied per row'}
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
        <div
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          Evidence
        </div>
        <div className="mt-2 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {rows.length} rows, {measures.length || 'source'} measures
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
          {checks.length > 0
            ? `${checks.length} readiness check${checks.length === 1 ? '' : 's'} available`
            : 'Export includes current filters and visible columns'}
        </div>
      </div>
    </div>
  );
}

function ReportTable({ data }: ReportTableProps) {
  const columns = visibleColumns(data);
  const hasActions = data.some((row) => {
    const meta = getRowMeta(row);
    return Boolean((meta?.drillThrough?.length ?? 0) > 0 || (meta?.actions?.length ?? 0) > 0);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr style={{ background: 'var(--aurora-bg-subtle)' }}>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b px-4 py-3 text-left text-xs font-semibold uppercase"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
              >
                {formatHeading(column)}
              </th>
            ))}
            {hasActions && (
              <th
                className="border-b px-4 py-3 text-left text-xs font-semibold uppercase"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
              >
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => {
            const meta = getRowMeta(row);
            const actionLinks = [...(meta?.drillThrough ?? []), ...(meta?.actions ?? [])];
            return (
              <tr key={rowIndex} className="transition hover:bg-white/5">
                {columns.map((column) => {
                  const value = row[column];
                  return (
                    <td
                      key={column}
                      className="max-w-[340px] border-b px-4 py-3 align-top"
                      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                      title={fmtValue(value)}
                    >
                      {column.toLowerCase().includes('status') ? (
                        <StatusBadge status={fmtValue(value)} />
                      ) : (
                        <span className="line-clamp-2 break-words">{fmtValue(value)}</span>
                      )}
                    </td>
                  );
                })}
                {hasActions && (
                  <td
                    className="border-b px-4 py-3 align-top"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    {actionLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {actionLinks.slice(0, 3).map((action, index) => (
                          <a
                            key={`${action.href}-${index}`}
                            href={action.href}
                            className="rounded-md border px-2 py-1 text-xs font-semibold transition hover:border-blue-500/70"
                            style={{
                              borderColor: 'var(--aurora-border)',
                              background: 'var(--aurora-bg-subtle)',
                              color: 'var(--aurora-text)',
                            }}
                          >
                            {action.label}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        No route
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function WestsideReportsPage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [autoLoadedCompanyId, setAutoLoadedCompanyId] = useState('');
  const [activeReport, setActiveReport] = useState<ReportCard | null>(null);
  const [reportResult, setReportResult] = useState<NormalizedReport>({
    rows: [],
    raw: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const {
    companyOptions,
    branchOptions,
    loading: orgLoading,
  } = useOrgScope(companyId, {
    skipDivisions: true,
    skipEmployees: true,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const settings = JSON.parse(raw) as {
          companyId?: string;
          branchId?: string;
          dateFrom?: string;
          dateTo?: string;
        };
        if (settings.companyId) setCompanyId(settings.companyId);
        if (settings.branchId) setBranchId(settings.branchId);
        if (settings.dateFrom) setDateFrom(settings.dateFrom);
        if (settings.dateTo) setDateTo(settings.dateTo);
      }
    } catch {
      /* ignore corrupt local settings */
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (companyOptions.length === 0 || !hydrated) return;
    if (companyId && companyOptions.some((option) => option.value === companyId)) return;
    const preferred =
      companyOptions.find((option) => /westsides/i.test(option.label)) ?? companyOptions[0];
    setCompanyId(preferred.value);
  }, [companyId, companyOptions, hydrated]);

  useEffect(() => {
    if (!branchId || branchOptions.some((option) => option.value === branchId)) return;
    setBranchId('');
  }, [branchId, branchOptions]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          companyId,
          branchId,
          dateFrom,
          dateTo,
        }),
      );
    } catch {
      /* ignore storage failures */
    }
  }, [branchId, companyId, dateFrom, dateTo, hydrated]);

  const categories = useMemo(() => new Set(REPORTS.map((report) => report.category)).size, []);
  const currentCompanyLabel = companyOptions.find((option) => option.value === companyId)?.label;
  const currentBranchLabel = branchOptions.find((option) => option.value === branchId)?.label;
  const visibleColumnList = useMemo(() => visibleColumns(reportResult.rows), [reportResult.rows]);

  const loadReport = useCallback(
    async (report: ReportCard) => {
      setActiveReport(report);
      setReportResult({ rows: [], raw: null });
      if (!companyId) {
        setError('Select a company before loading a Westsides report.');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ companyId });
        if (branchId) params.set('branchId', branchId);
        if (report.queryMode === 'daily-close') {
          params.set('date', dateTo || dateFrom || new Date().toISOString().slice(0, 10));
        } else {
          if (dateFrom) params.set('dateFrom', dateFrom);
          if (dateTo) params.set('dateTo', dateTo);
        }

        const response = await fetch(`${report.endpoint}?${params.toString()}`);
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(errorMessage(json, `HTTP ${response.status}`));
        }
        setReportResult(normalizePayload(json, report));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error loading report');
      } finally {
        setLoading(false);
      }
    },
    [branchId, companyId, dateFrom, dateTo],
  );

  useEffect(() => {
    if (!companyId || activeReport || loading || autoLoadedCompanyId === companyId) return;
    setAutoLoadedCompanyId(companyId);
    void loadReport(REPORTS[0]);
  }, [activeReport, autoLoadedCompanyId, companyId, loadReport, loading]);

  const exportCsv = useCallback(() => {
    if (!activeReport || reportResult.rows.length === 0) return;
    const headers = visibleColumnList;
    const rows = reportResult.rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(','),
    );
    downloadText(
      `westsides-${activeReport.key}-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
      [headers.map(csvEscape).join(','), ...rows].join('\n'),
    );
  }, [activeReport, reportResult.rows, visibleColumnList]);

  const exportJson = useCallback(() => {
    if (!activeReport) return;
    downloadText(
      `westsides-${activeReport.key}-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json;charset=utf-8',
      JSON.stringify(reportResult.raw ?? reportResult.rows, null, 2),
    );
  }, [activeReport, reportResult.raw, reportResult.rows]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Westsides Reports"
        subtitle="Production-ready sales, inventory, pricing, customer, fulfillment, and control reports."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Reports" value={REPORTS.length} hint="Westsides coverage" variant="blue" />
        <StatCard
          label="Categories"
          value={categories}
          hint="Sales, stock, pricing, controls"
          variant="green"
        />
        <StatCard
          label="Scope"
          value={currentCompanyLabel ? currentCompanyLabel.split('(')[0].trim() : 'Not selected'}
          hint={
            activeReport
              ? `${reportResult.rows.length} rows loaded`
              : 'Auto-selects Westsides when available'
          }
          variant={companyId ? 'green' : 'amber'}
        />
      </div>

      <Card>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Company
            </span>
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setBranchId('');
              }}
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
              disabled={orgLoading}
            >
              <option value="">Select company</option>
              {companyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Branch
            </span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
              disabled={!companyId}
            >
              <option value="">All branches</option>
              {branchOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Date From
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
            />
          </label>

          <label className="block">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Date To
            </span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
            />
          </label>
        </div>

        {!orgLoading && companyOptions.length === 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            No company scope is available for this user. The reports need company access before data
            can be loaded.
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span
            className="rounded-full border px-2 py-1"
            style={{
              borderColor: 'var(--aurora-border)',
              color: 'var(--aurora-text-secondary)',
            }}
          >
            Company: {currentCompanyLabel ?? 'Not selected'}
          </span>
          <span
            className="rounded-full border px-2 py-1"
            style={{
              borderColor: 'var(--aurora-border)',
              color: 'var(--aurora-text-secondary)',
            }}
          >
            Branch: {currentBranchLabel ?? 'All branches'}
          </span>
          <span
            className="rounded-full border px-2 py-1"
            style={{
              borderColor: 'var(--aurora-border)',
              color: 'var(--aurora-text-secondary)',
            }}
          >
            Period: {dateFrom || 'Open'} to {dateTo || 'Open'}
          </span>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {REPORTS.map((report) => (
          <button
            key={report.key}
            type="button"
            onClick={() => void loadReport(report)}
            className="group rounded-lg border p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: 'var(--aurora-card)',
              borderColor:
                activeReport?.key === report.key ? 'rgb(59 130 246)' : 'var(--aurora-border)',
              color: 'var(--aurora-text)',
            }}
            disabled={!companyId && !orgLoading}
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xs font-bold"
                style={{
                  borderColor: 'var(--aurora-border)',
                  background: 'var(--aurora-bg-subtle)',
                  color: 'var(--aurora-text)',
                }}
                aria-hidden="true"
              >
                {report.icon}
              </div>
              <span
                className="rounded-full border px-2 py-1 text-[11px] font-medium"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text-secondary)',
                }}
              >
                {report.category}
              </span>
            </div>
            <div className="mt-3 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {report.title}
            </div>
            <div
              className="mt-1 text-xs leading-snug"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {report.description}
            </div>
            <div className="mt-3 text-[11px] font-semibold" style={{ color: '#bfdbfe' }}>
              {report.outputFormats.join(' / ')}
            </div>
          </button>
        ))}
      </div>

      {activeReport ? (
        <Card className="overflow-hidden" padding="none">
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg border text-xs font-bold"
                style={{
                  borderColor: 'var(--aurora-border)',
                  background: 'var(--aurora-bg-subtle)',
                  color: 'var(--aurora-text)',
                }}
              >
                {activeReport.icon}
              </div>
              <div>
                <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {activeReport.title}
                </div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                  {activeReport.description}
                </div>
                {reportResult.meta?.generatedAt && (
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                    Generated {fmtValue(reportResult.meta.generatedAt)}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadReport(activeReport)}
                className="rounded-lg border px-3 py-2 text-xs font-semibold transition hover:border-blue-500/60"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text)',
                  background: 'var(--aurora-bg-subtle)',
                }}
                disabled={loading}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={exportCsv}
                className="rounded-lg border px-3 py-2 text-xs font-semibold transition hover:border-blue-500/60 disabled:opacity-50"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text)',
                  background: 'var(--aurora-bg-subtle)',
                }}
                disabled={reportResult.rows.length === 0}
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={exportJson}
                className="rounded-lg border px-3 py-2 text-xs font-semibold transition hover:border-blue-500/60 disabled:opacity-50"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text)',
                  background: 'var(--aurora-bg-subtle)',
                }}
                disabled={!reportResult.raw}
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                Print / PDF
              </button>
            </div>
          </div>

          {!loading && !error && reportResult.rows.length > 0 && (
            <ReadinessPanel rows={reportResult.rows} meta={reportResult.meta} />
          )}

          {error && <ErrorState message={error} onRetry={() => void loadReport(activeReport)} />}

          {loading ? (
            <Spinner />
          ) : !error && reportResult.rows.length === 0 ? (
            <EmptyState report={activeReport} onReload={() => void loadReport(activeReport)} />
          ) : !error ? (
            <ReportTable data={reportResult.rows} />
          ) : null}
        </Card>
      ) : (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Select a company, then choose a report card above to load Westsides data.
        </div>
      )}
    </div>
  );
}
