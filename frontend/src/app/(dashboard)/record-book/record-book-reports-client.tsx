'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  FormSelect,
  PageHeader,
  SkeletonTable,
  StatCard,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  BACKEND_PROXY_URL,
  backendGet,
  backendList,
  backendPost,
  buildQuery,
} from '@/lib/api-client';
import { filenameFromDisposition } from '@/lib/export-download';
import { downloadTextFile } from '@/lib/report-export';
import { ITEMBA_DOCUMENT_LETTERHEAD } from '@/lib/document-letterhead';
import { RecordBookNav, recordBookMoney } from './record-book-ui';

export type ReportKey =
  | 'daily-sales'
  | 'receipt-methods'
  | 'expenses-by-category'
  | 'expenses-by-payee'
  | 'net-movement'
  | 'branch-comparison'
  | 'monthly-trend';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Division {
  id: string;
  companyId: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  divisionId: string;
  name: string;
  code: string;
}
interface Category {
  id: string;
  companyId: string;
  name: string;
}
interface ScopeOptions {
  companies: Company[];
  divisions: Division[];
  branches: Branch[];
}
interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'currency' | 'percent';
  align?: 'left' | 'right';
}
interface ReportRow extends Record<string, unknown> {
  currency: string;
  sourceIds: string[];
  sourceHref?: string;
}
interface ReportResult {
  key: ReportKey;
  title: string;
  description: string;
  reportStatus: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  rowCount: number;
  sourceRecordCount: number;
  generatedAt: string;
  summaryByCurrency: Array<{
    currency: string;
    recordedSales: number;
    expenses: number;
    netMovement: number;
    salesCount: number;
    expenseCount: number;
  }>;
}

const REPORTS: Array<{ key: ReportKey; label: string; description: string }> = [
  { key: 'daily-sales', label: 'Daily Sales', description: 'Day-end totals and receipt split' },
  {
    key: 'receipt-methods',
    label: 'Receipt Methods',
    description: 'Cash, mobile money, bank, card, and other',
  },
  {
    key: 'expenses-by-category',
    label: 'Expenses by Category',
    description: 'Money out grouped by category',
  },
  {
    key: 'expenses-by-payee',
    label: 'Expenses by Payee',
    description: 'Money out grouped by recipient',
  },
  { key: 'net-movement', label: 'Daily Net Movement', description: 'Sales less expenses by day' },
  {
    key: 'branch-comparison',
    label: 'Branch Comparison',
    description: 'Sales, expenses, and net by branch',
  },
  {
    key: 'monthly-trend',
    label: 'Monthly Trend',
    description: 'Monthly sales and expense movement',
  },
];

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;

function printDate(value: string) {
  if (!value) return 'All time';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function displayCell(value: unknown, column: ReportColumn, currency: string) {
  if (column.type === 'currency') return recordBookMoney(Number(value ?? 0), currency);
  if (column.type === 'percent') return `${Number(value ?? 0).toFixed(2)}%`;
  if (column.type === 'number') return Number(value ?? 0).toLocaleString();
  return value == null || value === '' ? '-' : String(value);
}

function sourceHref(sourceId: string | undefined) {
  if (!sourceId) return null;
  if (sourceId.startsWith('sale:')) return `/record-book/daily-sales/${sourceId.slice(5)}`;
  if (sourceId.startsWith('expense:')) return `/record-book/expenses/${sourceId.slice(8)}`;
  return null;
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

async function downloadBlob(path: string, fallbackName: string) {
  const response = await fetch(`${BACKEND_PROXY_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : (payload?.message ?? `Export failed (${response.status})`),
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFromDisposition(
    response.headers.get('Content-Disposition'),
    fallbackName,
  );
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function RecordBookReportsClient({
  initialReportKey = 'daily-sales',
}: {
  initialReportKey?: ReportKey;
}) {
  const { hasPermission } = useAuth();
  const canView = hasPermission('record_book.view');
  const canExport = hasPermission('record_book.export');
  const [reportKey, setReportKey] = useState<ReportKey>(initialReportKey);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState({
    companyId: '',
    divisionId: '',
    branchId: '',
    dateFrom: monthStart,
    dateTo: today,
    currency: 'TZS',
    reportStatus: 'FINALIZED',
    expenseCategoryId: '',
    receiptType: '',
    paymentMethod: '',
    search: '',
  });
  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const requestIdRef = useRef(0);
  const debouncedSearch = useDebouncedValue(filters.search);

  const scopedDivisions = useMemo(
    () =>
      divisions.filter(
        (division) => !filters.companyId || division.companyId === filters.companyId,
      ),
    [divisions, filters.companyId],
  );
  const scopedDivisionIds = useMemo(
    () => new Set(scopedDivisions.map((division) => division.id)),
    [scopedDivisions],
  );
  const scopedBranches = useMemo(
    () =>
      branches.filter((branch) =>
        filters.divisionId
          ? branch.divisionId === filters.divisionId
          : scopedDivisionIds.has(branch.divisionId),
      ),
    [branches, filters.divisionId, scopedDivisionIds],
  );
  const scopedCategories = useMemo(
    () =>
      categories.filter(
        (category) => !filters.companyId || category.companyId === filters.companyId,
      ),
    [categories, filters.companyId],
  );
  const selectedCompany = companies.find((company) => company.id === filters.companyId);
  const selectedDivision = divisions.find((division) => division.id === filters.divisionId);
  const selectedBranch = branches.find((branch) => branch.id === filters.branchId);

  useEffect(() => {
    Promise.all([
      backendGet<ScopeOptions>('/record-book/scope-options'),
      backendList<Category>('/record-book/expense-categories', { query: { limit: 500 } }),
    ])
      .then(([scope, categoryRows]) => {
        setCompanies(scope.companies);
        setDivisions(scope.divisions);
        setBranches(scope.branches);
        setCategories(categoryRows);
        setFilters((current) =>
          current.companyId || !scope.companies[0]
            ? current
            : { ...current, companyId: scope.companies[0].id },
        );
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load report filters'),
      );
  }, []);

  const query = useMemo(
    () => ({
      companyId: filters.companyId,
      divisionId: filters.divisionId,
      branchId: filters.branchId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      currency: filters.currency,
      reportStatus: filters.reportStatus,
      expenseCategoryId: filters.expenseCategoryId,
      receiptType: filters.receiptType,
      paymentMethod: filters.paymentMethod,
      search: debouncedSearch,
    }),
    [
      debouncedSearch,
      filters.branchId,
      filters.companyId,
      filters.currency,
      filters.dateFrom,
      filters.dateTo,
      filters.divisionId,
      filters.expenseCategoryId,
      filters.paymentMethod,
      filters.receiptType,
      filters.reportStatus,
    ],
  );

  const loadReport = useCallback(async () => {
    if (!canView) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await backendGet<ReportResult>(`/record-book/reports/${reportKey}`, { query });
      if (requestId !== requestIdRef.current) return;
      setReport(data);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not run report');
      setReport(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [canView, query, reportKey]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const auditClientExport = async (format: 'pdf' | 'print' | 'json') => {
    await backendPost('/record-book/export-audit', {
      scope: 'report',
      reportKey,
      format,
      rowCount: report?.rowCount ?? 0,
      companyId: filters.companyId || undefined,
      divisionId: filters.divisionId || undefined,
      branchId: filters.branchId || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    });
  };

  const handleExport = async (format: 'pdf' | 'print' | 'json' | 'csv' | 'xlsx') => {
    if (!report) return;
    setExporting(format);
    setError('');
    try {
      const baseName = `record-book-${report.key}-${today}`;
      if (format === 'print') {
        await auditClientExport('print');
        window.print();
      } else if (format === 'pdf') {
        await downloadBlob(
          `/record-book/reports/${reportKey}/export${buildQuery({ ...query, format: 'pdf' })}`,
          `${baseName}.pdf`,
        );
      } else if (format === 'json') {
        downloadTextFile(`${baseName}.json`, 'application/json', JSON.stringify(report, null, 2));
        await auditClientExport('json');
      } else {
        await downloadBlob(
          `/record-book/reports/${reportKey}/export${buildQuery({ ...query, format })}`,
          `${baseName}.${format}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting('');
    }
  };

  const chartKey = report?.columns.find((column) => column.type === 'currency')?.key;
  const chartRows = chartKey
    ? [...(report?.rows ?? [])]
        .sort((a, b) => Math.abs(Number(b[chartKey] ?? 0)) - Math.abs(Number(a[chartKey] ?? 0)))
        .slice(0, 12)
    : [];
  const chartMax = Math.max(
    ...chartRows.map((row) => Math.abs(Number(row[chartKey ?? ''] ?? 0))),
    1,
  );
  const printHiddenColumnKeys = new Set<string>();
  if (filters.companyId) printHiddenColumnKeys.add('company');
  if (filters.currency) printHiddenColumnKeys.add('currency');
  if (report && !['ACTIVE', 'ALL'].includes(report.reportStatus)) {
    printHiddenColumnKeys.add('status');
  }

  if (!canView) {
    return (
      <div className="record-book-workspace mx-auto w-full max-w-[1440px] px-4 pb-10 pt-2 sm:px-6 lg:px-8 xl:px-10">
        <PageHeader title="Records Book Reports" subtitle="Permission required" />
        <Card>
          <EmptyState
            title="Permission required"
            description="You need record_book.view to run Records Book reports."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="record-book-workspace mx-auto w-full max-w-[1440px] px-4 pb-10 pt-2 sm:px-6 lg:px-8 xl:px-10">
      <div className="record-book-no-print">
        <PageHeader
          title="Records Book Reports"
          subtitle="Independent manual sales, receipt, expense, and net-movement reporting"
        />
        <RecordBookNav />
      </div>
      <style jsx global>{`
        @media screen {
          .record-book-print-only {
            display: none !important;
          }
        }
        @media print {
          @page {
            size: A4 portrait;
            margin: 9mm 9mm 11mm;
          }
          html,
          body {
            background: #ffffff !important;
            color: #0f172a !important;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * {
            visibility: hidden !important;
          }
          .record-book-report-print,
          .record-book-report-print * {
            visibility: visible !important;
          }
          .record-book-no-print,
          aside,
          header {
            display: none !important;
          }
          .record-book-report-print {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            max-width: none !important;
            padding: 0 !important;
            color: #0f172a !important;
            background: #ffffff !important;
            font-family: Arial, Helvetica, sans-serif !important;
          }
          .record-book-print-only {
            display: block !important;
          }
          .record-book-print-letterhead {
            display: grid !important;
            grid-template-columns: 48px minmax(0, 1fr) 165px !important;
            align-items: start !important;
            gap: 10px !important;
            padding: 0 0 8px !important;
            border-bottom: 2px solid #2563eb !important;
          }
          .record-book-print-logo {
            width: 44px !important;
            height: 44px !important;
            object-fit: contain !important;
          }
          .record-book-print-company {
            font-size: 12pt !important;
            line-height: 1.2 !important;
            font-weight: 700 !important;
            color: #0f172a !important;
          }
          .record-book-print-group,
          .record-book-print-muted {
            color: #64748b !important;
            font-size: 7.5pt !important;
          }
          .record-book-print-contact {
            color: #475569 !important;
            font-size: 6.5pt !important;
            line-height: 1.35 !important;
          }
          .record-book-print-title {
            max-width: 165px !important;
            text-align: right !important;
          }
          .record-book-print-title h1 {
            margin: 0 !important;
            font-size: 15pt !important;
            line-height: 1.2 !important;
            color: #0f172a !important;
          }
          .record-book-print-status {
            display: inline-block !important;
            margin-top: 4px !important;
            padding: 2px 7px !important;
            border-radius: 3px !important;
            background: #eff6ff !important;
            color: #1d4ed8 !important;
            font-size: 7pt !important;
            font-weight: 700 !important;
          }
          .record-book-print-meta {
            display: grid !important;
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            gap: 0 !important;
            margin: 10px 0 12px !important;
            border: 1px solid #e2e8f0 !important;
          }
          .record-book-print-meta > div {
            min-width: 0 !important;
            padding: 7px 9px !important;
            border-right: 1px solid #e2e8f0 !important;
          }
          .record-book-print-meta > div:last-child {
            border-right: 0 !important;
          }
          .record-book-print-label {
            display: block !important;
            margin-bottom: 2px !important;
            color: #64748b !important;
            font-size: 6.5pt !important;
            font-weight: 700 !important;
            text-transform: uppercase !important;
          }
          .record-book-print-value {
            display: block !important;
            color: #0f172a !important;
            font-size: 8pt !important;
            font-weight: 600 !important;
            overflow-wrap: anywhere !important;
          }
          .record-book-print-summary {
            display: grid !important;
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            gap: 7px !important;
            margin-bottom: 12px !important;
          }
          .record-book-print-summary > div {
            min-width: 0 !important;
            padding: 7px 9px !important;
            border: 1px solid #dbeafe !important;
            background: #f8fafc !important;
          }
          .record-book-screen-report-header,
          .record-book-screen-summary {
            display: none !important;
          }
          .record-book-print-table-card {
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: #ffffff !important;
            box-shadow: none !important;
          }
          .record-book-print-table-card > div {
            overflow: visible !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 0 !important;
          }
          .record-book-print-table {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
            color: #0f172a !important;
            font-size: 7.2pt !important;
          }
          .record-book-print-table thead {
            display: table-header-group !important;
          }
          .record-book-print-table th {
            padding: 5px 5px !important;
            border-right: 1px solid #cbd5e1 !important;
            border-bottom: 1px solid #94a3b8 !important;
            background: #eff6ff !important;
            color: #1e40af !important;
            font-size: 6.5pt !important;
            line-height: 1.2 !important;
            text-transform: uppercase !important;
            overflow-wrap: anywhere !important;
          }
          .record-book-print-table td {
            padding: 5px !important;
            border-right: 1px solid #e2e8f0 !important;
            border-bottom: 1px solid #e2e8f0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            line-height: 1.25 !important;
            vertical-align: top !important;
            overflow-wrap: anywhere !important;
          }
          .record-book-print-table tbody tr:nth-child(even) td {
            background: #f8fafc !important;
          }
          .record-book-print-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .record-book-print-table [data-column-type='currency'],
          .record-book-print-table [data-column-type='number'],
          .record-book-print-table [data-column-type='percent'] {
            white-space: nowrap !important;
          }
          .record-book-print-hidden-column {
            display: none !important;
          }
          .record-book-print-note {
            margin-top: 10px !important;
            padding-top: 7px !important;
            border-top: 1px solid #cbd5e1 !important;
            color: #64748b !important;
            font-size: 6.5pt !important;
            line-height: 1.35 !important;
          }
        }
      `}</style>

      <div className="record-book-no-print mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {REPORTS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setReportKey(item.key)}
            className={`min-h-24 rounded-lg border p-4 text-left transition ${reportKey === item.key ? 'border-blue-500 bg-blue-950/40' : 'border-slate-800 bg-slate-900/30 hover:border-slate-600'}`}
          >
            <span className="block font-semibold text-slate-100">{item.label}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-400">{item.description}</span>
          </button>
        ))}
      </div>

      <Card className="record-book-no-print mb-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FormSelect
            label="Company"
            value={filters.companyId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                companyId: event.target.value,
                divisionId: '',
                branchId: '',
                expenseCategoryId: '',
              }))
            }
            placeholder="All companies"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Division"
            value={filters.divisionId}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                divisionId: event.target.value,
                branchId: '',
              }))
            }
            placeholder="All divisions"
          >
            {scopedDivisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.code} - {division.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch"
            value={filters.branchId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, branchId: event.target.value }))
            }
            placeholder="All branches"
          >
            {scopedBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} - {branch.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Record Status"
            value={filters.reportStatus}
            onChange={(event) =>
              setFilters((current) => ({ ...current, reportStatus: event.target.value }))
            }
          >
            <option value="FINALIZED">Finalized only</option>
            <option value="DRAFT">Draft only</option>
            <option value="VOIDED">Voided audit rows</option>
            <option value="ACTIVE">Draft + finalized</option>
            <option value="ALL">All statuses</option>
          </FormSelect>
          <FormInput
            label="From"
            type="date"
            value={filters.dateFrom}
            onChange={(event) =>
              setFilters((current) => ({ ...current, dateFrom: event.target.value }))
            }
          />
          <FormInput
            label="To"
            type="date"
            value={filters.dateTo}
            onChange={(event) =>
              setFilters((current) => ({ ...current, dateTo: event.target.value }))
            }
          />
          <FormSelect
            label="Currency"
            value={filters.currency}
            onChange={(event) =>
              setFilters((current) => ({ ...current, currency: event.target.value }))
            }
            placeholder="All currencies"
          >
            <option value="TZS">TZS</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="KES">KES</option>
            <option value="UGX">UGX</option>
          </FormSelect>
          <FormSelect
            label="Expense Category"
            value={filters.expenseCategoryId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, expenseCategoryId: event.target.value }))
            }
            placeholder="All categories"
          >
            {scopedCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Receipt Type"
            value={filters.receiptType}
            onChange={(event) =>
              setFilters((current) => ({ ...current, receiptType: event.target.value }))
            }
            placeholder="All receipt types"
          >
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
            <option value="LIPA_NAMBA">Lipa Namba</option>
            <option value="BANK">Bank</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </FormSelect>
          <FormSelect
            label="Expense Method"
            value={filters.paymentMethod}
            onChange={(event) =>
              setFilters((current) => ({ ...current, paymentMethod: event.target.value }))
            }
            placeholder="All payment methods"
          >
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
            <option value="LIPA_NAMBA">Lipa Namba</option>
            <option value="BANK">Bank</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </FormSelect>
          <FormInput
            className="xl:col-span-2"
            label="Search"
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({ ...current, search: event.target.value }))
            }
            placeholder="Description, payee, receipt label, reference..."
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn
            variant="secondary"
            onClick={() =>
              setFilters((current) => ({ ...current, dateFrom: today, dateTo: today }))
            }
          >
            Today
          </Btn>
          <Btn
            variant="secondary"
            onClick={() =>
              setFilters((current) => ({ ...current, dateFrom: monthStart, dateTo: today }))
            }
          >
            This Month
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => setFilters((current) => ({ ...current, dateFrom: '', dateTo: '' }))}
          >
            All Time
          </Btn>
          <Btn
            variant="ghost"
            onClick={() =>
              setFilters((current) => ({
                ...current,
                divisionId: '',
                branchId: '',
                dateFrom: monthStart,
                dateTo: today,
                currency: 'TZS',
                reportStatus: 'FINALIZED',
                expenseCategoryId: '',
                receiptType: '',
                paymentMethod: '',
                search: '',
              }))
            }
          >
            Reset
          </Btn>
        </div>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {canExport && report && (
        <div className="record-book-no-print mb-5 flex flex-wrap gap-2">
          {(['print', 'pdf', 'xlsx', 'csv', 'json'] as const).map((format) => (
            <Btn
              key={format}
              variant="secondary"
              size="sm"
              loading={exporting === format}
              onClick={() => handleExport(format)}
            >
              {format === 'print' ? 'Print' : `Export ${format.toUpperCase()}`}
            </Btn>
          ))}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : !report || !report.rows.length ? (
        <Card>
          <EmptyState
            title="No report rows"
            description="No Records Book entries match the selected filters and status."
          />
        </Card>
      ) : (
        <div className="record-book-report-print space-y-5">
          <section className="record-book-print-only">
            <div className="record-book-print-letterhead">
              <Image
                className="record-book-print-logo"
                src="/brand/itemba-group-logo.png"
                alt="Itemba Group"
                width={48}
                height={48}
              />
              <div>
                <div className="record-book-print-group">
                  {ITEMBA_DOCUMENT_LETTERHEAD.groupName}
                </div>
                <div className="record-book-print-company">
                  {selectedCompany?.name ?? 'All Accessible Companies'}
                </div>
                <div className="record-book-print-muted">
                  {selectedCompany?.code ? `${selectedCompany.code} | ` : ''}
                  Records Book - independent manual control records
                </div>
                <div className="record-book-print-contact">
                  Address: {ITEMBA_DOCUMENT_LETTERHEAD.address}
                </div>
                <div className="record-book-print-contact">
                  Tel: {ITEMBA_DOCUMENT_LETTERHEAD.telephone} | Phone:{' '}
                  {ITEMBA_DOCUMENT_LETTERHEAD.phone}
                </div>
                <div className="record-book-print-contact">
                  Email: {ITEMBA_DOCUMENT_LETTERHEAD.email}
                </div>
                <div className="record-book-print-contact">
                  TIN: {ITEMBA_DOCUMENT_LETTERHEAD.tin} | VRN: {ITEMBA_DOCUMENT_LETTERHEAD.vrn} |
                  Reg No: {ITEMBA_DOCUMENT_LETTERHEAD.registrationNumber}
                </div>
              </div>
              <div className="record-book-print-title">
                <h1>{report.title}</h1>
                <span className="record-book-print-status">{report.reportStatus}</span>
              </div>
            </div>

            <div className="record-book-print-meta">
              <div>
                <span className="record-book-print-label">Reporting Period</span>
                <span className="record-book-print-value">
                  {printDate(filters.dateFrom)} - {printDate(filters.dateTo)}
                </span>
              </div>
              <div>
                <span className="record-book-print-label">Scope</span>
                <span className="record-book-print-value">
                  {selectedDivision?.name ?? 'All divisions'} /{' '}
                  {selectedBranch?.name ?? 'All branches'}
                </span>
              </div>
              <div>
                <span className="record-book-print-label">Currency</span>
                <span className="record-book-print-value">
                  {filters.currency || 'Separated by currency'}
                </span>
              </div>
              <div>
                <span className="record-book-print-label">Generated</span>
                <span className="record-book-print-value">
                  {new Date(report.generatedAt).toLocaleString()} |{' '}
                  {report.sourceRecordCount.toLocaleString()} records
                </span>
              </div>
            </div>

            <div className="record-book-print-summary">
              {report.summaryByCurrency.flatMap((summary) => [
                <div key={`${summary.currency}-print-sales`}>
                  <span className="record-book-print-label">
                    Recorded Sales ({summary.currency})
                  </span>
                  <span className="record-book-print-value">
                    {recordBookMoney(summary.recordedSales, summary.currency)}
                  </span>
                </div>,
                <div key={`${summary.currency}-print-expenses`}>
                  <span className="record-book-print-label">Money Out ({summary.currency})</span>
                  <span className="record-book-print-value">
                    {recordBookMoney(summary.expenses, summary.currency)}
                  </span>
                </div>,
                <div key={`${summary.currency}-print-net`}>
                  <span className="record-book-print-label">Net Movement ({summary.currency})</span>
                  <span className="record-book-print-value">
                    {recordBookMoney(summary.netMovement, summary.currency)}
                  </span>
                </div>,
                <div key={`${summary.currency}-print-records`}>
                  <span className="record-book-print-label">
                    Source Records ({summary.currency})
                  </span>
                  <span className="record-book-print-value">
                    {summary.salesCount + summary.expenseCount}
                  </span>
                </div>,
              ])}
            </div>
          </section>

          <Card>
            <div className="record-book-screen-report-header mb-4">
              <h1 className="text-xl font-semibold text-slate-100">{report.title}</h1>
              <p className="mt-1 text-sm text-slate-400">{report.description}</p>
              <p className="mt-1 text-xs text-slate-500">
                Generated {new Date(report.generatedAt).toLocaleString()} from{' '}
                {report.sourceRecordCount.toLocaleString()} source records
              </p>
            </div>
            <div className="record-book-screen-summary grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {report.summaryByCurrency.flatMap((summary) => [
                <StatCard
                  key={`${summary.currency}-sales`}
                  label={`Recorded Sales (${summary.currency})`}
                  value={recordBookMoney(summary.recordedSales, summary.currency)}
                />,
                <StatCard
                  key={`${summary.currency}-expenses`}
                  label={`Expenses (${summary.currency})`}
                  value={recordBookMoney(summary.expenses, summary.currency)}
                />,
                <StatCard
                  key={`${summary.currency}-net`}
                  label={`Net Movement (${summary.currency})`}
                  value={recordBookMoney(summary.netMovement, summary.currency)}
                />,
                <StatCard
                  key={`${summary.currency}-records`}
                  label={`Source Records (${summary.currency})`}
                  value={summary.salesCount + summary.expenseCount}
                />,
              ])}
            </div>
          </Card>

          {chartKey && chartRows.length > 1 && (
            <Card className="record-book-no-print">
              <h2 className="mb-4 text-base font-semibold text-slate-100">Largest values</h2>
              <div className="space-y-3">
                {chartRows.map((row, index) => (
                  <div
                    key={`${String(row[report.columns[0].key])}-${index}`}
                    className="grid grid-cols-[minmax(120px,220px)_1fr_auto] items-center gap-3 text-xs"
                  >
                    <span className="truncate text-slate-300">
                      {String(row[report.columns[0].key] ?? `Row ${index + 1}`)}
                    </span>
                    <div className="h-2 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-full rounded bg-blue-500"
                        style={{
                          width: `${Math.max(2, (Math.abs(Number(row[chartKey] ?? 0)) / chartMax) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-right font-semibold text-slate-200">
                      {recordBookMoney(Number(row[chartKey] ?? 0), row.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="record-book-print-table-card">
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="record-book-print-table w-full text-sm">
                <thead className="bg-slate-900/70 text-left text-slate-400">
                  <tr>
                    {report.columns.map((column) => (
                      <th
                        key={column.key}
                        data-column-type={column.type}
                        className={`px-3 py-3 ${column.align === 'right' ? 'text-right' : ''} ${printHiddenColumnKeys.has(column.key) ? 'record-book-print-hidden-column' : ''}`}
                      >
                        {column.label}
                      </th>
                    ))}
                    <th className="record-book-no-print px-3 py-3 text-right">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => {
                    const href = row.sourceHref ?? sourceHref(row.sourceIds?.[0]);
                    return (
                      <tr key={`${report.key}-${index}`} className="border-t border-slate-800">
                        {report.columns.map((column) => (
                          <td
                            key={column.key}
                            data-column-type={column.type}
                            className={`px-3 py-3 ${column.align === 'right' ? 'text-right font-medium' : ''} ${printHiddenColumnKeys.has(column.key) ? 'record-book-print-hidden-column' : ''}`}
                          >
                            {displayCell(row[column.key], column, row.currency)}
                          </td>
                        ))}
                        <td className="record-book-no-print px-3 py-3 text-right">
                          {href ? (
                            <Link className="text-blue-300 hover:text-blue-200" href={href}>
                              View first of {row.sourceIds.length}
                            </Link>
                          ) : (
                            <span className="text-slate-500">{row.sourceIds.length} records</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="record-book-print-only record-book-print-note">
            This report contains independent manual Records Book entries. It does not post to
            Accounting, Sales Orders, Inventory, Receivables, Payables, or Cash Accounts. Generated
            by ITEMBA-R.
          </p>
        </div>
      )}
    </div>
  );
}
