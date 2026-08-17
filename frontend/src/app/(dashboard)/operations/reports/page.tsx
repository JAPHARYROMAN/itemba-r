'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Card, PageHeader, StatCard, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useOrgScope } from '@/hooks/use-org-scope';
import { backendGet } from '@/lib/api-client';
import { ITEMBA_DOCUMENT_LETTERHEAD } from '@/lib/document-letterhead';

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
    key: 'stock-valuation',
    title: 'Stock Valuation',
    description: 'Stock on hand, available quantity, average cost, total value, and thresholds.',
    endpoint: '/operations-reports/stock-valuation',
    category: 'Inventory',
    columns: [
      'productCode',
      'sku',
      'product',
      'category',
      'branch',
      'quantityOnHand',
      'quantityReserved',
      'availableQuantity',
      'unit',
      'averageCost',
      'totalValue',
      'reorderLevel',
      'minimumStockLevel',
      'stockStatus',
      'lastMovementAt',
    ],
  },
  {
    key: 'low-stock',
    title: 'Low Stock',
    description: 'Products at or below reorder/minimum levels with shortage quantity.',
    endpoint: '/operations-reports/low-stock',
    category: 'Inventory',
    columns: [
      'productCode',
      'sku',
      'product',
      'category',
      'branch',
      'quantityOnHand',
      'availableQuantity',
      'unit',
      'reorderLevel',
      'minimumStockLevel',
      'shortageQuantity',
      'totalValue',
      'lastMovementAt',
    ],
  },
  {
    key: 'inventory-movements',
    title: 'Inventory Movements',
    description: 'Movement ledger with product, branch, quantity, cost, reference, and notes.',
    endpoint: '/operations-reports/inventory-movements',
    category: 'Inventory',
    columns: [
      'movementNumber',
      'movementDate',
      'movementType',
      'branch',
      'productCode',
      'sku',
      'product',
      'quantity',
      'unit',
      'unitCost',
      'totalCost',
      'referenceType',
      'batchNumber',
      'expiryDate',
      'notes',
    ],
  },
  {
    key: 'stock-adjustments',
    title: 'Stock Adjustments',
    description: 'Adjustment evidence by product with system, counted, and variance quantities.',
    endpoint: '/operations-reports/stock-adjustments',
    category: 'Inventory',
    columns: [
      'adjustmentNumber',
      'date',
      'branch',
      'status',
      'productCode',
      'sku',
      'product',
      'systemQuantity',
      'countedQuantity',
      'varianceQuantity',
      'unit',
      'headerReason',
      'lineReason',
    ],
  },
  {
    key: 'sales-report',
    title: 'Sales Report',
    description: 'Every sales line with customer, product, unit, quantity, amount, and status.',
    endpoint: '/operations-reports/sales-report',
    category: 'Sales',
    columns: [
      'date',
      'salesOrderNumber',
      'customerCode',
      'customer',
      'branch',
      'salesType',
      'status',
      'paymentMethod',
      'paymentStatus',
      'productCode',
      'sku',
      'product',
      'quantity',
      'unit',
      'unitPrice',
      'discountAmount',
      'taxAmount',
      'amount',
      'salesperson',
    ],
  },
  {
    key: 'sales-by-customer',
    title: 'Sales by Customer',
    description: 'Customer totals, paid amount, and outstanding exposure.',
    endpoint: '/operations-reports/sales-by-customer',
    category: 'Sales',
    columns: [
      'customerCode',
      'customer',
      'orderCount',
      'totalAmount',
      'paidAmount',
      'outstandingAmount',
    ],
  },
  {
    key: 'customer-product-sales',
    title: 'Customer Product Sales',
    description: 'What each customer bought, grouped by customer and product.',
    endpoint: '/operations-reports/customer-product-sales',
    category: 'Customers',
    columns: [
      'customerCode',
      'customer',
      'productCode',
      'sku',
      'product',
      'unit',
      'documentCount',
      'lineCount',
      'quantity',
      'totalAmount',
      'discountAmount',
      'taxAmount',
      'averageUnitPrice',
    ],
  },
  {
    key: 'sales-by-product',
    title: 'Sales by Product',
    description: 'Product sales quantity, line count, amount, discount, and tax.',
    endpoint: '/operations-reports/sales-by-product',
    category: 'Sales',
    columns: [
      'productCode',
      'sku',
      'product',
      'lineCount',
      'quantity',
      'totalAmount',
      'discountAmount',
      'taxAmount',
    ],
  },
  {
    key: 'sales-summary',
    title: 'Sales Summary',
    description: 'Sales order totals by type and payment status.',
    endpoint: '/operations-reports/sales-summary',
    category: 'Sales',
    columns: [
      'section',
      'salesType',
      'paymentStatus',
      'orderCount',
      'totalAmount',
      'paidAmount',
      'outstandingAmount',
    ],
  },
  {
    key: 'purchase-report',
    title: 'Purchase Report',
    description: 'Every purchase line with supplier, product, unit, quantity, cost, and status.',
    endpoint: '/operations-reports/purchase-report',
    category: 'Purchases',
    columns: [
      'date',
      'expectedDate',
      'purchaseOrderNumber',
      'supplierCode',
      'supplier',
      'branch',
      'purchaseType',
      'status',
      'paymentStatus',
      'productCode',
      'sku',
      'product',
      'quantity',
      'unit',
      'unitCost',
      'discountAmount',
      'taxAmount',
      'amount',
      'batchNumber',
      'expiryDate',
    ],
  },
  {
    key: 'purchases-by-supplier',
    title: 'Purchases by Supplier',
    description: 'Supplier purchase totals, paid amount, and outstanding exposure.',
    endpoint: '/operations-reports/purchases-by-supplier',
    category: 'Purchases',
    columns: [
      'supplierCode',
      'supplier',
      'purchaseOrderCount',
      'totalAmount',
      'paidAmount',
      'outstandingAmount',
    ],
  },
  {
    key: 'supplier-product-purchases',
    title: 'Supplier Product Purchases',
    description: 'What was bought from each supplier, grouped by supplier and product.',
    endpoint: '/operations-reports/supplier-product-purchases',
    category: 'Suppliers',
    columns: [
      'supplierCode',
      'supplier',
      'productCode',
      'sku',
      'product',
      'unit',
      'documentCount',
      'lineCount',
      'quantity',
      'totalAmount',
      'discountAmount',
      'taxAmount',
      'averageUnitCost',
    ],
  },
  {
    key: 'purchases-by-product',
    title: 'Purchases by Product',
    description: 'Product purchase quantity, line count, amount, discount, and tax.',
    endpoint: '/operations-reports/purchases-by-product',
    category: 'Purchases',
    columns: [
      'productCode',
      'sku',
      'product',
      'lineCount',
      'quantity',
      'totalAmount',
      'discountAmount',
      'taxAmount',
    ],
  },
  {
    key: 'purchase-summary',
    title: 'Purchase Summary',
    description: 'Purchase order totals by type and payment status.',
    endpoint: '/operations-reports/purchase-summary',
    category: 'Purchases',
    columns: [
      'section',
      'purchaseType',
      'paymentStatus',
      'orderCount',
      'totalAmount',
      'paidAmount',
      'outstandingAmount',
    ],
  },
];

const NON_INVENTORY_REPORTS = REPORTS.filter((report) => report.category !== 'Inventory');

const SETTINGS_KEY = 'itemba.operations.readable-reports.v1';
const META_KEY = '_reportMeta';
const MONEY_RE =
  /(amount|total|paid|outstanding|balance|value|cost|price|revenue|profit|subtotal|tax|discount|limit)$/i;
const QUANTITY_RE = /(quantity|count|lineCount|orderCount|reserved|level)$/i;
const DATE_RE = /(date|createdAt|updatedAt|expiryDate|lastMovementAt|expectedDate)$/i;

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

function objectSummary(object: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([key, value]) =>
        key !== 'rows' &&
        key !== 'items' &&
        key !== 'generatedAt' &&
        !Array.isArray(value) &&
        (typeof value !== 'object' || value === null),
    ),
  );
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
        summary: (object.summary as Record<string, unknown> | undefined) ?? objectSummary(object),
        generatedAt: object.generatedAt as string | undefined,
      };
    }
    if (Array.isArray(object.items)) {
      return {
        rows: object.items as Record<string, unknown>[],
        raw,
        summary: (object.summary as Record<string, unknown> | undefined) ?? objectSummary(object),
        generatedAt: object.generatedAt as string | undefined,
      };
    }
    const arrayEntry = Object.entries(object).find(([, value]) => Array.isArray(value));
    if (arrayEntry) {
      return {
        rows: arrayEntry[1] as Record<string, unknown>[],
        raw,
        summary: (object.summary as Record<string, unknown> | undefined) ?? objectSummary(object),
        generatedAt: object.generatedAt as string | undefined,
      };
    }
    return { rows: [object], raw, summary: objectSummary(object) };
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

function formatNumber(value: unknown, maximumFractionDigits = 4) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits }).format(toNumber(value));
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

function firstPresentKey(rows: Record<string, unknown>[], keys: string[]) {
  return keys.find((key) => rows.some((row) => row[key] !== undefined));
}

function buildAutoSummary(rows: Record<string, unknown>[]) {
  const amountKey = firstPresentKey(rows, [
    'amount',
    'totalAmount',
    'totalValue',
    'totalCost',
    'outstandingAmount',
  ]);
  const quantityKey = firstPresentKey(rows, [
    'quantity',
    'quantityOnHand',
    'availableQuantity',
    'varianceQuantity',
    'lineCount',
    'orderCount',
  ]);
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
  return `operations-${report.key}-${new Date().toISOString().slice(0, 10)}`;
}

function summaryValue(key: string, value: unknown) {
  if (MONEY_RE.test(key)) return formatMoney(value);
  if (QUANTITY_RE.test(key)) return formatNumber(value);
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
          size: A4 portrait;
          margin: 9mm;
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
          align-items: flex-start;
          gap: 12px;
          border-bottom: 2px solid #111827;
          padding: 0 0 8px !important;
          margin-bottom: 10px;
        }
        .print-letterhead img {
          width: 54px;
          height: 54px;
          object-fit: contain;
        }
        .print-letterhead-copy {
          min-width: 0;
          font-size: 8px;
          line-height: 1.35;
        }
        .print-letterhead-group,
        .print-letterhead-company {
          font-weight: 700;
        }
        .print-letterhead-group {
          font-size: 11px;
        }
        .print-letterhead-company {
          font-size: 10px;
        }
        .print-letterhead-report {
          margin-left: auto;
          max-width: 190px;
          text-align: right;
          font-size: 8px;
          line-height: 1.35;
        }
        .print-letterhead-report strong {
          display: block;
          font-size: 12px;
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

export default function OperationsReportsPage() {
  const { hasPermission } = useAuth();
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [activeKey, setActiveKey] = useState(NON_INVENTORY_REPORTS[0].key);
  const [hydrated, setHydrated] = useState(false);
  const [reportResult, setReportResult] = useState<NormalizedReport>({ rows: [], raw: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canView = hasPermission('operations.reports.view');
  const {
    companyOptions,
    branchOptions,
    loading: orgLoading,
  } = useOrgScope(companyId, {
    skipDivisions: true,
    skipEmployees: true,
  });

  const activeReport =
    NON_INVENTORY_REPORTS.find((report) => report.key === activeKey) ?? NON_INVENTORY_REPORTS[0];
  const categories = useMemo(
    () => Array.from(new Set(NON_INVENTORY_REPORTS.map((report) => report.category))),
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
          paymentStatus?: string;
          activeKey?: string;
        };
        if (settings.companyId) setCompanyId(settings.companyId);
        if (settings.branchId) setBranchId(settings.branchId);
        if (settings.dateFrom) setDateFrom(settings.dateFrom);
        if (settings.dateTo) setDateTo(settings.dateTo);
        if (settings.statusFilter) setStatusFilter(settings.statusFilter);
        if (settings.paymentStatus) setPaymentStatus(settings.paymentStatus);
        if (
          settings.activeKey &&
          NON_INVENTORY_REPORTS.some((report) => report.key === settings.activeKey)
        ) {
          setActiveKey(settings.activeKey);
        }
      }
      // eslint-disable-next-line no-restricted-syntax -- corrupt/blocked localStorage only affects remembered filter defaults; the report itself is unaffected
    } catch {
      /* ignore corrupt settings */
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (companyOptions.length === 0 || !hydrated) return;
    if (companyId && companyOptions.some((option) => option.value === companyId)) return;
    setCompanyId(companyOptions[0].value);
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
          statusFilter,
          paymentStatus,
          activeKey,
        }),
      );
      // eslint-disable-next-line no-restricted-syntax -- persisting filter defaults is best-effort; a quota/private-mode failure loses nothing visible
    } catch {
      /* ignore storage failures */
    }
  }, [activeKey, branchId, companyId, dateFrom, dateTo, hydrated, paymentStatus, statusFilter]);

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
      const query: Record<string, string> = { companyId, pageSize: '1000' };
      if (branchId) query.branchId = branchId;
      if (dateFrom) query.dateFrom = dateFrom;
      if (dateTo) query.dateTo = dateTo;
      if (statusFilter) query.status = statusFilter.trim().toUpperCase();
      if (paymentStatus) query.paymentStatus = paymentStatus.trim().toUpperCase();

      const payload = await backendGet<unknown>(activeReport.endpoint, { query });
      setReportResult(normalizePayload(payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error loading report';
      setError(message);
      showToast('error', 'Operations report unavailable', message);
    } finally {
      setLoading(false);
    }
  }, [activeReport, branchId, companyId, dateFrom, dateTo, paymentStatus, statusFilter]);

  useEffect(() => {
    if (!companyId || !hydrated || !canView) return;
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, hydrated, canView]);

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
      <h1>${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.groupName)}</h1>
      <h2>${escapeHtml(currentCompanyLabel ?? 'ITEMBA-R Group')}</h2>
      <p>Address: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.address)}<br />
      Tel: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.telephone)} | Phone: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.phone)}<br />
      Email: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.email)}<br />
      TIN: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.tin)} | VRN: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.vrn)} | Reg No: ${escapeHtml(ITEMBA_DOCUMENT_LETTERHEAD.registrationNumber)}</p>
      <h3>${escapeHtml(activeReport.title)}</h3>
      <p>${escapeHtml(currentBranchLabel ?? 'All branches')} | ${escapeHtml(dateFrom || 'Open')} to ${escapeHtml(dateTo || 'Open')}</p>
      <table border="1"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
    downloadText(`${reportFilename(activeReport)}.xls`, 'application/vnd.ms-excel', html);
  }

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Operations Reports" subtitle="Sales and purchase analytics" />
        <Card className="mt-8 p-10 text-center text-sm">
          <span style={{ color: 'var(--aurora-text-muted)' }}>Access Restricted</span>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PrintStyles />
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Operations Reports"
          subtitle="Readable operational reports for sales, purchases, customers, suppliers, and product performance."
        />
        <Link
          href="/operations/reports/suppliers"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border px-4 text-sm font-semibold"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
        >
          Supplier 360 Reports
        </Link>
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
                  {NON_INVENTORY_REPORTS.filter((report) => report.category === category).map((report) => (
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

        <div className="mt-3 grid gap-3 md:grid-cols-4">
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
              placeholder="Optional, e.g. CONFIRMED"
              className={`${inputClass} mt-2 w-full`}
              style={controlStyle}
            />
          </label>
          <label className="block">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Payment Status
            </span>
            <input
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value)}
              placeholder="Optional, e.g. PAID"
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
            width={54}
            height={54}
            className="object-contain"
            unoptimized
          />
          <div className="print-letterhead-copy">
            <div className="print-letterhead-group">{ITEMBA_DOCUMENT_LETTERHEAD.groupName}</div>
            <div className="print-letterhead-company">
              {currentCompanyLabel ?? 'ITEMBA-R Group'}
            </div>
            <div>Address: {ITEMBA_DOCUMENT_LETTERHEAD.address}</div>
            <div>
              Tel: {ITEMBA_DOCUMENT_LETTERHEAD.telephone} | Phone:{' '}
              {ITEMBA_DOCUMENT_LETTERHEAD.phone}
            </div>
            <div>Email: {ITEMBA_DOCUMENT_LETTERHEAD.email}</div>
            <div>
              TIN: {ITEMBA_DOCUMENT_LETTERHEAD.tin} | VRN: {ITEMBA_DOCUMENT_LETTERHEAD.vrn} | Reg
              No: {ITEMBA_DOCUMENT_LETTERHEAD.registrationNumber}
            </div>
          </div>
          <div className="print-letterhead-report">
            <strong>{activeReport.title}</strong>
            <div>{currentBranchLabel ?? 'All branches'}</div>
            <div>
              {dateFrom || 'Open'} to {dateTo || 'Open'}
            </div>
            <div>Generated {new Date().toLocaleString('en-GB')}</div>
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
                  variant={MONEY_RE.test(key) ? 'green' : 'blue'}
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
