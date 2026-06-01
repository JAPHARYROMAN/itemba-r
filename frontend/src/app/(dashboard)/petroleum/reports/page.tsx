'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, StatCard } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

interface ReportDef {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  category: string;
  columns: string[];
}

interface NormalizedReport {
  rows: Record<string, unknown>[];
  raw: unknown;
  summary?: Record<string, unknown>;
  generatedAt?: string;
}

const REPORTS: ReportDef[] = [
  {
    key: 'fuel-stock',
    title: 'Fuel Stock',
    description: 'Tank balances, capacity, ullage, dip variance, and stock status.',
    endpoint: '/api/backend/petroleum/reports/fuel-stock',
    category: 'Stock',
    columns: [
      'branch',
      'tankCode',
      'tankName',
      'productCode',
      'product',
      'capacityLitres',
      'bookBalanceLitres',
      'lastDipBalanceLitres',
      'varianceFromLastDipLitres',
      'ullageLitres',
      'fillPercent',
      'status',
    ],
  },
  {
    key: 'shift-summary',
    title: 'Shift Summary',
    description: 'Sales, collections, credit sales, and shift cash variance.',
    endpoint: '/api/backend/petroleum/reports/shift-summary',
    category: 'Shifts',
    columns: [
      'branch',
      'shiftNumber',
      'shiftDate',
      'shiftType',
      'status',
      'openedBy',
      'readingCount',
      'totalLitresSold',
      'totalExpectedSales',
      'totalCollections',
      'totalCreditSales',
      'totalAccounted',
      'varianceAmount',
    ],
  },
  {
    key: 'nozzle-readings',
    title: 'Nozzle Readings',
    description: 'Opening and closing meter readings with litres and expected sales.',
    endpoint: '/api/backend/petroleum/reports/nozzle-readings',
    category: 'Shifts',
    columns: [
      'branch',
      'shiftNumber',
      'shiftDate',
      'shiftType',
      'nozzle',
      'pump',
      'tank',
      'productCode',
      'product',
      'attendant',
      'openingMeter',
      'closingMeter',
      'litresSold',
      'pricePerLitre',
      'expectedAmount',
      'status',
    ],
  },
  {
    key: 'collections',
    title: 'Collections',
    description: 'Cash, bank, card, and mobile money collections by shift.',
    endpoint: '/api/backend/petroleum/reports/collections',
    category: 'Cash Control',
    columns: [
      'branch',
      'shiftNumber',
      'shiftDate',
      'shiftStatus',
      'collectionType',
      'amount',
      'reference',
      'cashAccount',
      'notes',
      'createdAt',
    ],
  },
  {
    key: 'deliveries-summary',
    title: 'Fuel Deliveries',
    description: 'Supplier deliveries, accepted litres, rejected litres, and landed cost.',
    endpoint: '/api/backend/petroleum/reports/deliveries-summary',
    category: 'Purchases',
    columns: [
      'branch',
      'deliveryNumber',
      'deliveryDate',
      'supplierCode',
      'supplier',
      'productCode',
      'product',
      'tank',
      'deliveryNoteNumber',
      'invoiceNumber',
      'orderedLitres',
      'deliveredLitres',
      'acceptedLitres',
      'rejectedLitres',
      'unitCost',
      'totalCost',
      'driverName',
      'truckNumber',
      'status',
    ],
  },
  {
    key: 'credit-sales',
    title: 'Credit Sales',
    description: 'Customer fuel credit sales with vehicle, litres, and receivable status.',
    endpoint: '/api/backend/petroleum/reports/credit-sales',
    category: 'Sales',
    columns: [
      'branch',
      'creditSaleNumber',
      'saleDate',
      'shiftNumber',
      'customerCode',
      'customer',
      'productCode',
      'product',
      'vehicleNumber',
      'driverName',
      'litres',
      'pricePerLitre',
      'totalAmount',
      'status',
    ],
  },
  {
    key: 'tank-dips',
    title: 'Tank Dips',
    description: 'Physical dip readings, book balance, litre variance, and value variance.',
    endpoint: '/api/backend/petroleum/reports/tank-dips',
    category: 'Stock',
    columns: [
      'branch',
      'dipNumber',
      'dipDate',
      'dipTime',
      'tank',
      'productCode',
      'product',
      'bookBalance',
      'physicalDipLitres',
      'varianceLitres',
      'varianceValue',
      'measuredBy',
      'status',
    ],
  },
  {
    key: 'reconciliation-history',
    title: 'Daily Reconciliation',
    description: 'Daily fuel sales, collections, shortages, excesses, and tank variance.',
    endpoint: '/api/backend/petroleum/reports/reconciliation-history',
    category: 'Cash Control',
    columns: [
      'branch',
      'reconciliationNumber',
      'reconciliationDate',
      'totalLitresSold',
      'totalExpectedSales',
      'totalCashCollected',
      'totalMobileMoneyCollected',
      'totalBankCardCollected',
      'totalCreditSales',
      'totalCollections',
      'cashShortage',
      'cashExcess',
      'totalTankVarianceLitres',
      'totalTankVarianceValue',
      'status',
    ],
  },
  {
    key: 'fuel-prices',
    title: 'Fuel Prices',
    description: 'Current and historical fuel prices by branch and product.',
    endpoint: '/api/backend/petroleum/reports/fuel-prices',
    category: 'Pricing',
    columns: [
      'branch',
      'productCode',
      'product',
      'pricePerLitre',
      'currency',
      'effectiveFrom',
      'effectiveTo',
      'status',
      'approvedBy',
      'approvedAt',
    ],
  },
];

const SETTINGS_KEY = 'itemba.petroleum.readable-reports.v1';
const META_KEY = '_reportMeta';
const MONEY_RE =
  /(amount|total|cost|price|sales|collections|accounted|shortage|excess|value|varianceValue)$/i;
const LITRES_RE = /(litres|balance|ullage|meter)$/i;
const PERCENT_RE = /(percent|rate)$/i;
const DATE_RE = /(date|createdAt|updatedAt|effectiveFrom|effectiveTo|approvedAt)$/i;
const TIME_RE = /(time)$/i;

const controlStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
  colorScheme: 'dark',
} as const;

const inputClass =
  'h-10 rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/40';

function unwrapPayload(payload: unknown): unknown {
  const data = (payload as { data?: unknown })?.data;
  const nested = (data as { data?: unknown })?.data;
  return nested ?? data ?? payload;
}

function normalizePayload(payload: unknown): NormalizedReport {
  const raw = unwrapPayload(payload);

  if (Array.isArray(raw)) return { rows: raw as Record<string, unknown>[], raw };

  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    if (Array.isArray(object.rows)) {
      return {
        rows: object.rows as Record<string, unknown>[],
        raw,
        summary: object.summary as Record<string, unknown> | undefined,
        generatedAt: object.generatedAt as string | undefined,
      };
    }
    const arrayEntry = Object.entries(object).find(([, value]) => Array.isArray(value));
    if (arrayEntry) {
      return {
        rows: arrayEntry[1] as Record<string, unknown>[],
        raw,
        summary: object.summary as Record<string, unknown> | undefined,
        generatedAt: object.generatedAt as string | undefined,
      };
    }
    return { rows: [object], raw };
  }

  return { rows: [], raw };
}

function visibleColumns(rows: Record<string, unknown>[], report?: ReportDef) {
  const available = new Set(
    rows.flatMap((row) =>
      Object.keys(row).filter(
        (key) => !key.startsWith('_') && key !== META_KEY && !key.endsWith('Id'),
      ),
    ),
  );
  const preferred = report?.columns?.filter((column) => available.has(column)) ?? [];
  const rest = Array.from(available).filter((column) => !preferred.includes(column));
  return [...preferred, ...rest];
}

function formatHeading(value: string) {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: unknown) {
  return `TZS ${new Intl.NumberFormat('en-TZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value))}`;
}

function formatNumber(value: unknown, maximumFractionDigits = 3) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits }).format(toNumber(value));
}

function formatDate(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}

function formatTime(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' }).format(date);
}

function formatValue(column: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (TIME_RE.test(column) && !DATE_RE.test(column)) return formatTime(value);
  if (DATE_RE.test(column)) return formatDate(value);
  if (PERCENT_RE.test(column)) return `${formatNumber(value, 2)}%`;
  if (MONEY_RE.test(column)) return formatMoney(value);
  if (LITRES_RE.test(column)) return `${formatNumber(value, 3)} L`;
  if (typeof value === 'number' || typeof value === 'bigint') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return '';
  return String(value).replace(/_/g, ' ');
}

function rawExportValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function csvEscape(value: unknown) {
  const text = rawExportValue(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: unknown) {
  return rawExportValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function errorMessage(payload: unknown, fallback: string) {
  const body = payload as { message?: unknown; error?: unknown };
  const message = body?.message ?? body?.error;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

function firstPresentKey(rows: Record<string, unknown>[], keys: string[]) {
  return keys.find((key) => rows.some((row) => row[key] !== undefined));
}

function buildAutoSummary(rows: Record<string, unknown>[]) {
  const litresKey = firstPresentKey(rows, [
    'totalLitresSold',
    'litresSold',
    'acceptedLitres',
    'deliveredLitres',
    'litres',
    'bookBalanceLitres',
    'physicalDipLitres',
  ]);
  const amountKey = firstPresentKey(rows, [
    'totalExpectedSales',
    'totalCollections',
    'totalAmount',
    'amount',
    'totalCost',
    'totalAccounted',
    'pricePerLitre',
  ]);
  const varianceKey = firstPresentKey(rows, [
    'varianceAmount',
    'varianceValue',
    'cashShortage',
    'cashExcess',
    'varianceLitres',
    'totalTankVarianceValue',
  ]);

  return {
    rows: rows.length,
    ...(litresKey && {
      litres: rows.reduce((sum, row) => sum + toNumber(row[litresKey]), 0),
    }),
    ...(amountKey && {
      amount: rows.reduce((sum, row) => sum + toNumber(row[amountKey]), 0),
    }),
    ...(varianceKey && {
      variance: rows.reduce((sum, row) => sum + toNumber(row[varianceKey]), 0),
    }),
  };
}

function summaryEntries(
  summary: Record<string, unknown> | undefined,
  rows: Record<string, unknown>[],
) {
  const source = summary && Object.keys(summary).length > 0 ? summary : buildAutoSummary(rows);
  return Object.entries(source)
    .filter(([, value]) => typeof value !== 'object' || value === null)
    .slice(0, 6);
}

function reportFilename(report: ReportDef) {
  return `petroleum-${report.key}-${new Date().toISOString().slice(0, 10)}`;
}

function summaryValue(key: string, value: unknown) {
  if (/litres/i.test(key)) return `${formatNumber(value, 3)} L`;
  if (MONEY_RE.test(key) || /amount|variance/i.test(key)) return formatMoney(value);
  return formatValue(key, value);
}

function ReportTable({ rows, report }: { rows: Record<string, unknown>[]; report: ReportDef }) {
  const columns = visibleColumns(rows, report);
  return (
    <div className="overflow-x-auto print-table-wrap">
      <table className="w-full min-w-[980px] text-sm print-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left text-xs font-semibold uppercase">
                {formatHeading(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column} className="px-3 py-2 align-top">
                  {formatValue(column, row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrintStyles() {
  return (
    <style jsx global>{`
      .print-letterhead {
        display: none;
      }
      .print-summary {
        display: none;
      }
      @media print {
        @page {
          size: A4 landscape;
          margin: 10mm;
        }
        html,
        body {
          margin: 0 !important;
          width: 100% !important;
        }
        body {
          background: #ffffff !important;
          color: #111827 !important;
        }
        body * {
          color: #111827 !important;
          visibility: hidden !important;
        }
        .no-print {
          display: none !important;
        }
        .print-area {
          background: #ffffff !important;
          border: 0 !important;
          box-shadow: none !important;
          left: 0 !important;
          margin: 0 !important;
          max-width: none !important;
          overflow: visible !important;
          padding: 0 !important;
          position: absolute !important;
          top: 0 !important;
          width: 100% !important;
        }
        .print-area,
        .print-area * {
          background-color: #ffffff !important;
          visibility: visible !important;
        }
        .print-letterhead {
          display: flex !important;
          align-items: center;
          gap: 16px;
          border-bottom: 2px solid #111827;
          padding-bottom: 12px;
          margin-bottom: 14px;
        }
        .print-letterhead img {
          width: 78px;
          height: 78px;
          object-fit: contain;
        }
        .print-summary {
          display: grid !important;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
          padding: 0 20px;
        }
        .print-summary div {
          border: 1px solid #d1d5db;
          padding: 6px 8px;
        }
        .print-summary span {
          display: block;
          font-size: 8px;
          text-transform: uppercase;
        }
        .print-summary strong {
          display: block;
          margin-top: 2px;
          font-size: 11px;
        }
        .print-table-wrap {
          overflow: visible !important;
          width: 100% !important;
        }
        .print-table {
          border-collapse: collapse !important;
          max-width: 100% !important;
          min-width: 0 !important;
          table-layout: fixed !important;
          width: 100% !important;
          font-size: 8px !important;
          line-height: 1.2 !important;
        }
        .print-table th,
        .print-table td {
          border: 1px solid #d1d5db !important;
          overflow-wrap: anywhere !important;
          padding: 3px 4px !important;
          vertical-align: top !important;
          white-space: normal !important;
          word-break: break-word !important;
        }
        .print-table th {
          background: #f3f4f6 !important;
          font-size: 7px !important;
          line-height: 1.15 !important;
        }
      }
    `}</style>
  );
}

export default function PetroleumReportsPage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeKey, setActiveKey] = useState(REPORTS[0].key);
  const [hydrated, setHydrated] = useState(false);
  const [reportResult, setReportResult] = useState<NormalizedReport>({ rows: [], raw: null });
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

  const activeReport = REPORTS.find((report) => report.key === activeKey) ?? REPORTS[0];
  const categories = useMemo(
    () => Array.from(new Set(REPORTS.map((report) => report.category))),
    [],
  );
  const currentCompanyLabel = companyOptions.find((option) => option.value === companyId)?.label;
  const currentBranchLabel = branchOptions.find((option) => option.value === branchId)?.label;
  const columns = useMemo(
    () => visibleColumns(reportResult.rows, activeReport),
    [activeReport, reportResult.rows],
  );
  const summary = useMemo(
    () => summaryEntries(reportResult.summary, reportResult.rows),
    [reportResult.rows, reportResult.summary],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const settings = JSON.parse(raw) as {
          companyId?: string;
          branchId?: string;
          dateFrom?: string;
          dateTo?: string;
          statusFilter?: string;
          activeKey?: string;
        };
        if (settings.companyId) setCompanyId(settings.companyId);
        if (settings.branchId) setBranchId(settings.branchId);
        if (settings.dateFrom) setDateFrom(settings.dateFrom);
        if (settings.dateTo) setDateTo(settings.dateTo);
        if (settings.statusFilter) setStatusFilter(settings.statusFilter);
        if (settings.activeKey && REPORTS.some((report) => report.key === settings.activeKey)) {
          setActiveKey(settings.activeKey);
        }
      }
    } catch {
      /* ignore corrupt settings */
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (companyOptions.length === 0 || !hydrated) return;
    if (companyId && companyOptions.some((option) => option.value === companyId)) return;
    const preferred =
      companyOptions.find((option) => /itemba|fuel|petrol|mpemba|uzunguni/i.test(option.label)) ??
      companyOptions[0];
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
        JSON.stringify({ companyId, branchId, dateFrom, dateTo, statusFilter, activeKey }),
      );
    } catch {
      /* ignore storage failures */
    }
  }, [activeKey, branchId, companyId, dateFrom, dateTo, hydrated, statusFilter]);

  const loadReport = useCallback(async () => {
    setReportResult({ rows: [], raw: null });
    if (!companyId) {
      setError('Select a company before loading a report.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (branchId) params.set('branchId', branchId);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (statusFilter) params.set('status', statusFilter.trim().toUpperCase());

      const response = await fetch(`${activeReport.endpoint}?${params.toString()}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, `HTTP ${response.status}`));
      setReportResult(normalizePayload(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading report');
    } finally {
      setLoading(false);
    }
  }, [activeReport, branchId, companyId, dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    if (!companyId || !hydrated) return;
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, hydrated]);

  function exportCsv() {
    if (reportResult.rows.length === 0) return;
    const lines = [
      columns.map(csvEscape).join(','),
      ...reportResult.rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
    ];
    downloadText(`${reportFilename(activeReport)}.csv`, 'text/csv;charset=utf-8', lines.join('\n'));
  }

  function exportJson() {
    downloadText(
      `${reportFilename(activeReport)}.json`,
      'application/json;charset=utf-8',
      JSON.stringify(reportResult.raw ?? reportResult.rows, null, 2),
    );
  }

  function exportExcel() {
    if (reportResult.rows.length === 0) return;
    const header = columns
      .map((column) => `<th>${escapeHtml(formatHeading(column))}</th>`)
      .join('');
    const body = reportResult.rows
      .map(
        (row) =>
          `<tr>${columns
            .map((column) => `<td>${escapeHtml(formatValue(column, row[column]))}</td>`)
            .join('')}</tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body>
      <h2>${escapeHtml(currentCompanyLabel ?? 'ITEMBA Group')}</h2>
      <h3>${escapeHtml(activeReport.title)}</h3>
      <p>${escapeHtml(currentBranchLabel ?? 'All branches')} | ${escapeHtml(dateFrom || 'Open')} to ${escapeHtml(dateTo || 'Open')}</p>
      <table border="1"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
    downloadText(`${reportFilename(activeReport)}.xls`, 'application/vnd.ms-excel', html);
  }

  return (
    <div className="space-y-6 p-6">
      <PrintStyles />
      <div className="no-print">
        <PageHeader
          title="Petroleum Reports"
          subtitle="Readable fuel-station reports for stock, shifts, nozzle readings, collections, deliveries, credit sales, dips, reconciliation, and pricing."
        />
      </div>

      <Card className="no-print">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block xl:col-span-2">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Report
            </span>
            <select
              value={activeKey}
              onChange={(event) => {
                setActiveKey(event.target.value);
                setReportResult({ rows: [], raw: null });
              }}
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
            >
              {categories.map((category) => (
                <optgroup key={category} label={category}>
                  {REPORTS.filter((report) => report.category === category).map((report) => (
                    <option key={report.key} value={report.key}>
                      {report.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

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

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void loadReport()}
              disabled={loading || !companyId}
              className="h-10 w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load Report'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
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
          <label className="block">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Status
            </span>
            <input
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              placeholder="Optional, e.g. POSTED"
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
            />
          </label>
        </div>
      </Card>

      {error && (
        <div className="no-print rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      <Card className="print-area overflow-hidden" padding="none">
        <div className="print-letterhead px-5 pt-5">
          <img src="/brand/itemba-group-logo.png" alt="ITEMBA Group logo" />
          <div>
            <div className="text-xl font-bold">{currentCompanyLabel ?? 'ITEMBA Group'}</div>
            <div className="text-sm">{activeReport.title}</div>
            <div className="text-xs">
              {currentBranchLabel ?? 'All branches'} | {dateFrom || 'Open'} to {dateTo || 'Open'}
            </div>
            <div className="text-xs">Generated {new Date().toLocaleString('en-GB')}</div>
          </div>
        </div>

        <div
          className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {activeReport.title}
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              {activeReport.description}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {currentCompanyLabel ?? 'No company selected'} |{' '}
              {currentBranchLabel ?? 'All branches'}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
              disabled={reportResult.rows.length === 0}
            >
              Print / PDF
            </button>
            <button
              type="button"
              onClick={exportExcel}
              className="rounded-lg border px-3 py-2 text-xs font-semibold"
              style={controlStyle}
              disabled={reportResult.rows.length === 0}
            >
              Excel
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-lg border px-3 py-2 text-xs font-semibold"
              style={controlStyle}
              disabled={reportResult.rows.length === 0}
            >
              CSV
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="rounded-lg border px-3 py-2 text-xs font-semibold"
              style={controlStyle}
              disabled={!reportResult.raw}
            >
              JSON
            </button>
          </div>
        </div>

        {loading ? (
          <div
            className="px-5 py-12 text-center text-sm"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Loading report...
          </div>
        ) : reportResult.rows.length === 0 ? (
          <div
            className="px-5 py-12 text-center text-sm"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Select filters and load a report. If no rows appear, widen the date range or choose all
            branches.
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 no-print">
              {summary.map(([key, value]) => (
                <StatCard
                  key={key}
                  label={formatHeading(key)}
                  value={summaryValue(key, value)}
                  variant={/variance|shortage|excess/i.test(key) ? 'amber' : 'blue'}
                />
              ))}
            </div>
            <div className="print-summary">
              {summary.map(([key, value]) => (
                <div key={key}>
                  <span>{formatHeading(key)}</span>
                  <strong>{summaryValue(key, value)}</strong>
                </div>
              ))}
            </div>
            <ReportTable rows={reportResult.rows} report={activeReport} />
          </>
        )}
      </Card>
    </div>
  );
}
