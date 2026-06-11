'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Card, PageHeader, StatCard, showToast } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

type QueryMode = 'range' | 'daily-close';

interface ReportDef {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  category: string;
  queryMode?: QueryMode;
  columns?: string[];
}

interface NormalizedReport {
  rows: Record<string, unknown>[];
  raw: unknown;
  summary?: Record<string, unknown>;
  generatedAt?: string;
}

const REPORTS: ReportDef[] = [
  {
    key: 'sales-report',
    title: 'Sales Report',
    description: 'Every sale line with customer, product, unit, quantity, and amount.',
    endpoint: '/api/backend/westsides/reports/sales-report',
    category: 'Sales',
    columns: [
      'date',
      'salesOrderNumber',
      'customer',
      'productCode',
      'product',
      'quantity',
      'unit',
      'unitPrice',
      'discountAmount',
      'taxAmount',
      'amount',
      'paymentMethod',
      'paymentStatus',
      'salesperson',
    ],
  },
  {
    key: 'sales-by-customer',
    title: 'Sales by Customer',
    description: 'Customer totals, paid amount, and outstanding balance.',
    endpoint: '/api/backend/westsides/reports/sales-by-customer',
    category: 'Sales',
    columns: [
      'customerCode',
      'customer',
      'orders',
      'totalAmount',
      'paidAmount',
      'outstandingAmount',
    ],
  },
  {
    key: 'sales-by-product',
    title: 'Sales by Product',
    description: 'Product quantities, revenue, and average selling price.',
    endpoint: '/api/backend/westsides/reports/sales-by-product',
    category: 'Sales',
    columns: [
      'productCode',
      'sku',
      'productName',
      'quantity',
      'totalAmount',
      'averageSellingPrice',
    ],
  },
  {
    key: 'daily-sales-summary',
    title: 'Daily Sales Summary',
    description: 'Sales totals by day.',
    endpoint: '/api/backend/westsides/reports/daily-sales-summary',
    category: 'Sales',
    columns: ['date', 'count', 'total', 'averageOrderValue'],
  },
  {
    key: 'sales-by-channel',
    title: 'Sales by Channel',
    description: 'Cash, credit, wholesale, retail, and other sales channels.',
    endpoint: '/api/backend/westsides/reports/sales-by-channel',
    category: 'Sales',
    columns: ['channel', 'orderCount', 'totalAmount'],
  },
  {
    key: 'sales-by-cashier',
    title: 'Sales by Salesperson',
    description: 'Sales totals by assigned salesperson.',
    endpoint: '/api/backend/westsides/reports/sales-by-cashier',
    category: 'Sales',
    columns: ['salesperson', 'orderCount', 'totalAmount'],
  },
  {
    key: 'purchase-report',
    title: 'Purchase Report',
    description: 'Every purchase line with supplier, product, unit, quantity, and amount.',
    endpoint: '/api/backend/westsides/reports/purchase-report',
    category: 'Purchases',
    columns: [
      'date',
      'purchaseOrderNumber',
      'supplier',
      'productCode',
      'product',
      'quantity',
      'unit',
      'unitCost',
      'discountAmount',
      'taxAmount',
      'amount',
      'purchaseType',
      'status',
      'paymentStatus',
    ],
  },
  {
    key: 'purchases-by-supplier',
    title: 'Purchases by Supplier',
    description: 'Supplier purchase totals, paid amount, and outstanding balance.',
    endpoint: '/api/backend/westsides/reports/purchases-by-supplier',
    category: 'Purchases',
    columns: [
      'supplierCode',
      'supplier',
      'purchaseOrders',
      'totalAmount',
      'paidAmount',
      'outstandingAmount',
    ],
  },
  {
    key: 'customers-report',
    title: 'Customers Report',
    description: 'Customer contacts, balances, and sales totals.',
    endpoint: '/api/backend/westsides/reports/customers-report',
    category: 'Customers',
    columns: [
      'customerCode',
      'customer',
      'phone',
      'email',
      'status',
      'creditLimit',
      'currentBalance',
      'orders',
      'totalSales',
      'outstandingSales',
    ],
  },
  {
    key: 'credit-customers',
    title: 'Credit Customers',
    description: 'Customers with receivable exposure.',
    endpoint: '/api/backend/westsides/reports/credit-customers-report',
    category: 'Customers',
    columns: [
      'customerCode',
      'customerName',
      'invoiceCount',
      'invoicedAmount',
      'outstandingAmount',
    ],
  },
  {
    key: 'suppliers-report',
    title: 'Suppliers Report',
    description: 'Supplier contacts, balances, and purchase totals.',
    endpoint: '/api/backend/westsides/reports/suppliers-report',
    category: 'Suppliers',
    columns: [
      'supplierCode',
      'supplier',
      'phone',
      'email',
      'status',
      'creditLimit',
      'currentBalance',
      'purchaseOrders',
      'totalPurchases',
      'outstandingPurchases',
    ],
  },
  {
    key: 'daily-close',
    title: 'Daily Close / Z-Report',
    description: 'Payment method reconciliation and compact sales-order evidence.',
    endpoint: '/api/backend/westsides/reports/daily-close',
    category: 'Controls',
    queryMode: 'daily-close',
    columns: [
      'section',
      'paymentMethod',
      'salesOrderNumber',
      'customerName',
      'salesperson',
      'count',
      'expected',
      'paid',
      'totalAmount',
      'amount',
    ],
  },
  {
    key: 'batch-status',
    title: 'Batch Status',
    description: 'Batch stock, expiry, and remaining quantity.',
    endpoint: '/api/backend/westsides/reports/batch-status',
    category: 'Inventory',
    columns: [
      'batchNumber',
      'productName',
      'sku',
      'remainingQuantity',
      'unitCost',
      'expiryDate',
      'status',
    ],
  },
  {
    key: 'fast-moving-items',
    title: 'Fast Moving Items',
    description: 'Top selling products by quantity.',
    endpoint: '/api/backend/westsides/reports/fast-moving-items',
    category: 'Inventory',
    columns: [
      'rank',
      'productCode',
      'sku',
      'productName',
      'quantity',
      'totalAmount',
      'velocitySignal',
    ],
  },
  {
    key: 'slow-moving-items',
    title: 'Slow Moving Items',
    description: 'Stock on hand with no recent sales movement.',
    endpoint: '/api/backend/westsides/reports/slow-moving-items',
    category: 'Inventory',
    columns: [
      'productCode',
      'sku',
      'productName',
      'branch',
      'quantityOnHand',
      'totalValue',
      'daysSinceMovement',
    ],
  },
  {
    key: 'stock-damage-report',
    title: 'Stock Damage',
    description: 'Damage and breakage by type and status.',
    endpoint: '/api/backend/westsides/reports/stock-damage-report',
    category: 'Inventory',
    columns: ['damageType', 'status', 'reportCount', 'quantity', 'estimatedValue'],
  },
  {
    key: 'delivery-performance',
    title: 'Delivery Performance',
    description: 'Delivery notes by status and fulfillment value.',
    endpoint: '/api/backend/westsides/reports/delivery-performance',
    category: 'Fulfillment',
    columns: ['status', 'deliveryCount'],
  },
  {
    key: 'price-list-report',
    title: 'Price Lists',
    description: 'Active price lists, item counts, and effective dates.',
    endpoint: '/api/backend/westsides/reports/price-list-report',
    category: 'Pricing',
    columns: [
      'name',
      'priceListType',
      'currency',
      'itemCount',
      'effectiveFrom',
      'effectiveTo',
      'status',
    ],
  },
  {
    key: 'quotation-conversion',
    title: 'Quotation Conversion',
    description: 'Quotation status and conversion totals.',
    endpoint: '/api/backend/westsides/reports/quotation-conversion',
    category: 'Sales',
    columns: [
      'status',
      'quotationCount',
      'totalQuotations',
      'convertedQuotations',
      'conversionRate',
    ],
  },
  {
    key: 'package-balance-report',
    title: 'Package Balances',
    description: 'Customer returnable package exposure.',
    endpoint: '/api/backend/westsides/reports/package-balance-report',
    category: 'Controls',
    columns: [
      'customerCode',
      'customerName',
      'packageCode',
      'packageName',
      'packageType',
      'quantityOwedByCustomer',
      'quantityOwedToCustomer',
      'depositBalance',
      'netPackageExposure',
    ],
  },
];

const SETTINGS_KEY = 'itemba.westsides.readable-reports.v1';
const META_KEY = '_reportMeta';
const MONEY_RE =
  /(amount|total|paid|outstanding|balance|value|cost|price|revenue|profit|subtotal|tax|discount|limit)$/i;
const DATE_RE = /(date|createdAt|updatedAt|expiryDate|effectiveFrom|effectiveTo)$/i;

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

function normalizePayload(payload: unknown, report: ReportDef): NormalizedReport {
  const raw = unwrapPayload(payload);

  if (report.key === 'daily-close' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const close = raw as Record<string, unknown>;
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
    return {
      rows,
      raw,
      summary: close.totals as Record<string, unknown> | undefined,
      generatedAt: close.generatedAt as string | undefined,
    };
  }

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
        (key) =>
          !key.startsWith('_') &&
          key !== META_KEY &&
          key !== 'readinessStatus' &&
          !key.endsWith('Id'),
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

function formatNumber(value: unknown) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 4 }).format(toNumber(value));
}

function formatDate(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}

function formatValue(column: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (DATE_RE.test(column)) return formatDate(value);
  if (MONEY_RE.test(column)) return formatMoney(value);
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

function buildAutoSummary(rows: Record<string, unknown>[]) {
  const amountKey = ['amount', 'totalAmount', 'total', 'totalValue'].find((key) =>
    rows.some((row) => row[key] !== undefined),
  );
  const quantityKey = ['quantity', 'quantityOnHand', 'remainingQuantity'].find((key) =>
    rows.some((row) => row[key] !== undefined),
  );
  return {
    rows: rows.length,
    ...(quantityKey && {
      quantity: rows.reduce((sum, row) => sum + toNumber(row[quantityKey]), 0),
    }),
    ...(amountKey && {
      totalAmount: rows.reduce((sum, row) => sum + toNumber(row[amountKey]), 0),
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
  return `westsides-${report.key}-${new Date().toISOString().slice(0, 10)}`;
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

export default function WestsideReportsPage() {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
          activeKey?: string;
        };
        if (settings.companyId) setCompanyId(settings.companyId);
        if (settings.branchId) setBranchId(settings.branchId);
        if (settings.dateFrom) setDateFrom(settings.dateFrom);
        if (settings.dateTo) setDateTo(settings.dateTo);
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
        JSON.stringify({ companyId, branchId, dateFrom, dateTo, activeKey }),
      );
    } catch {
      /* ignore storage failures */
    }
  }, [activeKey, branchId, companyId, dateFrom, dateTo, hydrated]);

  const loadReport = useCallback(async () => {
    setReportResult({ rows: [], raw: null });
    if (!companyId) {
      const message = 'Select a company before loading a report.';
      setError(message);
      showToast('warning', 'Company required', message);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (branchId) params.set('branchId', branchId);
      if (activeReport.queryMode === 'daily-close') {
        params.set('date', dateTo || dateFrom || new Date().toISOString().slice(0, 10));
      } else {
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
      }
      const response = await fetch(`${activeReport.endpoint}?${params.toString()}`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, `HTTP ${response.status}`));
      setReportResult(normalizePayload(json, activeReport));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error loading report';
      setError(message);
      showToast('error', 'Westsides report unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [activeReport, branchId, companyId, dateFrom, dateTo]);

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
          title="Westsides Reports"
          subtitle="Readable operational reports for sales, purchases, customers, suppliers, inventory, pricing, delivery, and controls."
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

        <div className="mt-3 grid gap-3 md:grid-cols-2">
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
      </Card>

      {error && (
        <div className="no-print rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      <Card className="print-area overflow-hidden" padding="none">
        <div className="print-letterhead px-5 pt-5">
          <Image
            src="/brand/itemba-group-logo.png"
            alt="ITEMBA Group logo"
            width={72}
            height={72}
            className="object-contain"
            unoptimized
          />
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
                  value={MONEY_RE.test(key) ? formatMoney(value) : formatValue(key, value)}
                  variant={MONEY_RE.test(key) ? 'green' : 'blue'}
                />
              ))}
            </div>
            <div className="print-summary">
              {summary.map(([key, value]) => (
                <div key={key}>
                  <span>{formatHeading(key)}</span>
                  <strong>
                    {MONEY_RE.test(key) ? formatMoney(value) : formatValue(key, value)}
                  </strong>
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
