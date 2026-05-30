'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, StatCard } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

interface ReportCard {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  icon: string;
  category: string;
}

interface ReportTableProps {
  data: Record<string, unknown>[];
}

const REPORTS: ReportCard[] = [
  {
    key: 'daily-sales-summary',
    title: 'Daily Sales Summary',
    description: 'Day-by-day sales totals and transaction counts.',
    endpoint: '/api/backend/westsides/reports/daily-sales-summary',
    icon: 'DS',
    category: 'Sales',
  },
  {
    key: 'monthly-sales-summary',
    title: 'Monthly Sales Summary',
    description: 'Month-over-month sales performance.',
    endpoint: '/api/backend/westsides/reports/monthly-sales-summary',
    icon: 'MS',
    category: 'Sales',
  },
  {
    key: 'sales-by-channel',
    title: 'Sales by Channel',
    description: 'Sales breakdown by cash, credit, wholesale, retail, and other channels.',
    endpoint: '/api/backend/westsides/reports/sales-by-channel',
    icon: 'SC',
    category: 'Sales',
  },
  {
    key: 'sales-by-product',
    title: 'Sales by Product',
    description: 'Sales volume and revenue by product.',
    endpoint: '/api/backend/westsides/reports/sales-by-product',
    icon: 'SP',
    category: 'Sales',
  },
  {
    key: 'sales-by-cashier',
    title: 'Sales by Salesperson',
    description: 'Sales totals grouped by salesperson.',
    endpoint: '/api/backend/westsides/reports/sales-by-cashier',
    icon: 'SS',
    category: 'People',
  },
  {
    key: 'product-profitability',
    title: 'Product Profitability',
    description: 'Revenue, estimated cost, gross profit, and margin by product.',
    endpoint: '/api/backend/westsides/reports/product-profitability',
    icon: 'GP',
    category: 'Margin',
  },
  {
    key: 'fast-moving-items',
    title: 'Fast Moving Items',
    description: 'Top selling products by quantity.',
    endpoint: '/api/backend/westsides/reports/fast-moving-items',
    icon: 'FM',
    category: 'Inventory',
  },
  {
    key: 'slow-moving-items',
    title: 'Slow Moving Items',
    description: 'Products with stock on hand but no recent sales movement.',
    endpoint: '/api/backend/westsides/reports/slow-moving-items',
    icon: 'SM',
    category: 'Inventory',
  },
  {
    key: 'batch-status',
    title: 'Batch Status Report',
    description: 'Product batch status, expiry dates, and remaining quantities.',
    endpoint: '/api/backend/westsides/reports/batch-status',
    icon: 'BS',
    category: 'Inventory',
  },
  {
    key: 'stock-damage-report',
    title: 'Stock Damage Report',
    description: 'Damage and breakage summary by type and approval status.',
    endpoint: '/api/backend/westsides/reports/stock-damage-report',
    icon: 'SD',
    category: 'Controls',
  },
  {
    key: 'package-balance-report',
    title: 'Package Balance Report',
    description: 'Customer returnable package balances.',
    endpoint: '/api/backend/westsides/reports/package-balance-report',
    icon: 'PB',
    category: 'Controls',
  },
  {
    key: 'quotation-conversion',
    title: 'Quotation Conversion',
    description: 'Quotation status mix and conversion rate.',
    endpoint: '/api/backend/westsides/reports/quotation-conversion',
    icon: 'QC',
    category: 'Sales',
  },
  {
    key: 'delivery-performance',
    title: 'Delivery Performance',
    description: 'Delivery note performance by status.',
    endpoint: '/api/backend/westsides/reports/delivery-performance',
    icon: 'DP',
    category: 'Fulfillment',
  },
  {
    key: 'price-list-report',
    title: 'Price List Report',
    description: 'Price lists with item counts and current status.',
    endpoint: '/api/backend/westsides/reports/price-list-report',
    icon: 'PL',
    category: 'Pricing',
  },
  {
    key: 'credit-customers',
    title: 'Credit Customers',
    description: 'Customers with receivable balances.',
    endpoint: '/api/backend/westsides/reports/credit-customers-report',
    icon: 'AR',
    category: 'Receivables',
  },
];

const controlStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
};

const inputClass =
  'h-10 rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/40';
const SETTINGS_KEY = 'itemba.westsides.reports.scope.v1';

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

function normalizePayload(payload: unknown): Record<string, unknown>[] {
  const data = (payload as { data?: unknown })?.data;
  const nested = (data as { data?: unknown })?.data;
  const raw = Array.isArray(nested)
    ? nested
    : Array.isArray(data)
      ? data
      : Array.isArray(payload)
        ? payload
        : (data ?? payload);
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    const arrayEntry = Object.entries(object).find(([, value]) => Array.isArray(value));
    if (arrayEntry) return arrayEntry[1] as Record<string, unknown>[];
    return [object];
  }
  return [];
}

function errorMessage(payload: unknown, fallback: string) {
  const body = payload as { message?: unknown; error?: unknown };
  const message = body?.message ?? body?.error;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  );
}

function ReportTable({ data }: ReportTableProps) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        No rows returned for the selected filters.
      </p>
    );
  }

  const columns = Array.from(new Set(data.flatMap((row) => Object.keys(row))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
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
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex} className="transition hover:bg-white/5">
              {columns.map((column) => (
                <td
                  key={column}
                  className="max-w-[320px] border-b px-4 py-3 align-top"
                  style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                  title={fmtValue(row[column])}
                >
                  <span className="line-clamp-2 break-words">{fmtValue(row[column])}</span>
                </td>
              ))}
            </tr>
          ))}
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
  const [reportData, setReportData] = useState<Record<string, unknown>[]>([]);
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

  const loadReport = useCallback(
    async (report: ReportCard) => {
      setActiveReport(report);
      setReportData([]);
      if (!companyId) {
        setError('Select a company before loading a Westsides report.');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ companyId });
        if (branchId) params.set('branchId', branchId);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);

        const response = await fetch(`${report.endpoint}?${params.toString()}`);
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(errorMessage(json, `HTTP ${response.status}`));
        }
        setReportData(normalizePayload(json));
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Westsides Reports"
        subtitle="Sales, inventory, pricing, customer, fulfillment, and profitability reports."
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
              ? `${reportData.length} rows loaded`
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

        {activeReport && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadReport(activeReport)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading || !companyId}
            >
              Reload Current Report
            </button>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Current report: {activeReport.title}
            </span>
          </div>
        )}
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
              </div>
            </div>
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
          </div>

          {error && (
            <div className="mx-5 my-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {loading ? <Spinner /> : <ReportTable data={reportData} />}
        </Card>
      ) : (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Select a company, then choose a report card above to load Westsides data.
        </div>
      )}
    </div>
  );
}
