'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { PageHeader, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList } from '@/lib/api-client';
import { downloadBinaryGet } from '@/lib/export-download';

type Section = 'OVERVIEW' | 'PURCHASES' | 'PRODUCTS' | 'PAYABLES';

interface CompanyOption {
  id: string;
  name: string;
  code?: string | null;
}

interface ScopeOption extends CompanyOption {
  companyId?: string;
  divisionId?: string | null;
  division?: { id?: string; companyId?: string } | null;
}

interface SupplierOption {
  id: string;
  companyId: string;
  supplierCode?: string | null;
  name: string;
  status: string;
}

interface SupplierSummary {
  currency: string;
  purchaseOrderCount: number;
  totalPurchased: number;
  paidAmount: number;
  outstandingAmount: number;
  averagePurchaseValue: number;
  payableCount: number;
  payableAmount: number;
  payablePaidAmount: number;
  payableOutstandingAmount: number;
  overduePayableAmount: number;
}

interface PurchaseLine {
  id: string;
  productCode?: string | null;
  sku?: string | null;
  product: string;
  quantity: number;
  unit: string;
  unitCost: number;
  lineTotal: number;
}

interface SupplierReportRow {
  id: string;
  sourceHref?: string;
  purchaseOrderNumber?: string;
  invoiceNumber?: string;
  invoiceDate?: string | null;
  invoiceSource?: string;
  orderDate?: string;
  branch?: string;
  division?: string;
  purchaseType?: string;
  lineCount?: number;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  totalAmount?: number;
  paidAmount?: number;
  outstandingAmount?: number;
  lines?: PurchaseLine[];
  productCode?: string | null;
  sku?: string | null;
  product?: string;
  category?: string;
  unit?: string;
  purchaseCount?: number;
  quantity?: number;
  averageUnitCost?: number;
  lastPurchaseDate?: string;
  payableNumber?: string;
  issueDate?: string;
  dueDate?: string | null;
  amount?: number;
}

interface Supplier360Report {
  supplier: {
    id: string;
    supplierCode?: string | null;
    name: string;
    legalName?: string | null;
    status: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    tin?: string | null;
    vrn?: string | null;
    paymentTerms?: string | null;
    company: CompanyOption;
    division?: CompanyOption | null;
    categories: Array<{ id: string; name: string }>;
  };
  summary: {
    byCurrency: SupplierSummary[];
    uniqueProducts: number;
    missingInvoiceCount: number;
    linkedInvoiceCount: number;
  };
  section: Section;
  rows: SupplierReportRow[];
  total: number;
  page: number;
  limit: number;
  generatedAt: string;
}

interface Filters {
  companyId: string;
  supplierId: string;
  divisionId: string;
  branchId: string;
  dateFrom: string;
  dateTo: string;
  purchaseStatus: string;
  paymentStatus: string;
  invoiceStatus: string;
  search: string;
}

const EMPTY_FILTERS: Filters = {
  companyId: '',
  supplierId: '',
  divisionId: '',
  branchId: '',
  dateFrom: '',
  dateTo: '',
  purchaseStatus: '',
  paymentStatus: '',
  invoiceStatus: '',
  search: '',
};

const TABS: Array<{ key: Section; label: string }> = [
  { key: 'OVERVIEW', label: 'Overview' },
  { key: 'PURCHASES', label: 'Purchases & Invoices' },
  { key: 'PRODUCTS', label: 'Products' },
  { key: 'PAYABLES', label: 'Payables' },
];

const controlClass =
  'h-10 min-w-0 rounded-md border px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

const controlStyle = {
  background: 'var(--aurora-bg-subtle)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
  colorScheme: 'dark',
} as const;

function money(value: number | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))}`;
}

function dateOnly(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function statusTone(status?: string) {
  if (status === 'PAID' || status === 'CONFIRMED' || status === 'RECEIVED') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (status === 'OVERDUE' || status === 'UNPAID' || status === 'MISSING') {
    return 'border-red-500/30 bg-red-500/10 text-red-300';
  }
  return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
}

function StatusBadge({ value }: { value?: string }) {
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${statusTone(value)}`}
    >
      {(value || '—').replaceAll('_', ' ')}
    </span>
  );
}

function Metric({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div
      className="min-w-0 border-r px-4 py-3 last:border-r-0"
      style={{ borderColor: 'var(--aurora-border)' }}
    >
      <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {value}
      </p>
      {help ? (
        <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export default function SupplierReportsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('operations.reports.view');
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [divisions, setDivisions] = useState<ScopeOption[]>([]);
  const [branches, setBranches] = useState<ScopeOption[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [section, setSection] = useState<Section>('OVERVIEW');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Supplier360Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [initialSupplierId, setInitialSupplierId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSection = params.get('section');
    if (TABS.some((tab) => tab.key === initialSection)) setSection(initialSection as Section);
    setInitialSupplierId(params.get('supplierId') || '');
    const companyId = params.get('companyId') || '';
    setFilters((current) => ({ ...current, companyId }));

    backendList<CompanyOption>('/companies', { query: { limit: 500 } })
      .then((rows) => {
        setCompanies(rows);
        const selectedCompany = companyId || rows[0]?.id || '';
        setFilters((current) => ({ ...current, companyId: selectedCompany }));
      })
      .catch(() => showToast('error', 'Could not load companies'));
  }, []);

  useEffect(() => {
    if (!filters.companyId) {
      setSuppliers([]);
      setDivisions([]);
      setBranches([]);
      return;
    }
    let active = true;
    Promise.all([
      backendList<SupplierOption>('/suppliers', {
        query: { companyId: filters.companyId, limit: 500 },
      }),
      backendList<ScopeOption>('/divisions', {
        query: { companyId: filters.companyId, limit: 500 },
      }),
      backendList<ScopeOption>('/branches', {
        query: { companyId: filters.companyId, limit: 500 },
      }),
    ])
      .then(([supplierRows, divisionRows, branchRows]) => {
        if (!active) return;
        setSuppliers(supplierRows);
        setDivisions(divisionRows);
        setBranches(branchRows);
        const preferred = supplierRows.some((row) => row.id === initialSupplierId)
          ? initialSupplierId
          : supplierRows[0]?.id || '';
        setFilters((current) => ({
          ...current,
          supplierId: preferred,
          divisionId: '',
          branchId: '',
        }));
        setInitialSupplierId('');
      })
      .catch(() => showToast('error', 'Could not load supplier report filters'));
    return () => {
      active = false;
    };
  }, [filters.companyId, initialSupplierId]);

  useEffect(() => {
    if (filters.supplierId && !applied.supplierId) setApplied(filters);
  }, [applied.supplierId, filters]);

  const filteredBranches = useMemo(
    () =>
      filters.divisionId
        ? branches.filter((branch) =>
            [branch.divisionId, branch.division?.id].includes(filters.divisionId),
          )
        : branches,
    [branches, filters.divisionId],
  );

  const requestParams = useCallback(
    (selectedSection: Section, selectedPage = page) => {
      const params = new URLSearchParams({
        companyId: applied.companyId,
        supplierId: applied.supplierId,
        section: selectedSection,
        page: String(selectedPage),
        limit: '25',
      });
      Object.entries(applied).forEach(([key, value]) => {
        if (value && key !== 'companyId' && key !== 'supplierId') params.set(key, value);
      });
      return params;
    },
    [applied, page],
  );

  const loadReport = useCallback(async () => {
    if (!canView || !applied.companyId || !applied.supplierId) {
      setReport(null);
      return;
    }
    setLoading(true);
    try {
      const data = await backendGet<Supplier360Report>(
        `/operations-reports/supplier-360?${requestParams(section).toString()}`,
      );
      setReport(data);
    } catch (error) {
      showToast(
        'error',
        'Could not load Supplier 360 report',
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setLoading(false);
    }
  }, [applied.companyId, applied.supplierId, canView, requestParams, section]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function applyFilters() {
    if (!filters.companyId || !filters.supplierId) {
      showToast('warning', 'Select a company and supplier first');
      return;
    }
    setPage(1);
    setExpanded(new Set());
    setApplied(filters);
  }

  function clearFilters() {
    const next = {
      ...EMPTY_FILTERS,
      companyId: filters.companyId,
      supplierId: filters.supplierId,
    };
    setFilters(next);
    setApplied(next);
    setPage(1);
  }

  async function exportReport(format: 'pdf' | 'xlsx' | 'csv' | 'json') {
    if (!report) return;
    setExporting(format);
    try {
      const params = requestParams(section, 1);
      params.set('format', format);
      const supplierName = report.supplier.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await downloadBinaryGet(
        `/operations-reports/supplier-360/export?${params.toString()}`,
        `supplier-360-${supplierName}.${format}`,
      );
      showToast('success', `${format.toUpperCase()} report downloaded`);
    } catch (error) {
      showToast(
        'error',
        'Could not export supplier report',
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setExporting('');
    }
  }

  function changeSection(next: Section) {
    setSection(next);
    setPage(1);
    setExpanded(new Set());
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Supplier Reports"
          subtitle="Supplier purchase and payable intelligence"
        />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          You do not have permission to view operations reports.
        </p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil((report?.total ?? 0) / (report?.limit ?? 25)));

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Supplier 360 Reports"
        subtitle="Purchases, supplier invoices, products and payable exposure in one account view"
      />

      <section className="border-y py-4" style={{ borderColor: 'var(--aurora-border)' }}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Company
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.companyId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  companyId: event.target.value,
                  supplierId: '',
                }))
              }
            >
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Supplier
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.supplierId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, supplierId: event.target.value }))
              }
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.supplierCode ? `${supplier.supplierCode} — ` : ''}
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Division
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.divisionId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  divisionId: event.target.value,
                  branchId: '',
                }))
              }
            >
              <option value="">All divisions</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Branch
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.branchId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, branchId: event.target.value }))
              }
            >
              <option value="">All branches</option>
              {filteredBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            From
            <input
              type="date"
              className={controlClass}
              style={controlStyle}
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateFrom: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            To
            <input
              type="date"
              className={controlClass}
              style={controlStyle}
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateTo: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Purchase status
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.purchaseStatus}
              onChange={(event) =>
                setFilters((current) => ({ ...current, purchaseStatus: event.target.value }))
              }
            >
              <option value="">All statuses</option>
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RECEIVED', 'CANCELLED', 'VOIDED'].map(
                (value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="grid gap-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Payment status
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.paymentStatus}
              onChange={(event) =>
                setFilters((current) => ({ ...current, paymentStatus: event.target.value }))
              }
            >
              <option value="">All payments</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partially paid</option>
              <option value="PAID">Paid</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end">
          <label
            className="grid min-w-52 gap-1 text-xs"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            Supplier invoice coverage
            <select
              className={controlClass}
              style={controlStyle}
              value={filters.invoiceStatus}
              onChange={(event) =>
                setFilters((current) => ({ ...current, invoiceStatus: event.target.value }))
              }
            >
              <option value="">All invoices</option>
              <option value="MISSING">Missing invoice reference</option>
              <option value="RECORDED">Operations reference</option>
              <option value="LINKED">Procurement invoice linked</option>
            </select>
          </label>
          <label
            className="grid min-w-0 flex-1 gap-1 text-xs"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            Search PO, invoice or product
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4" />
              <input
                className={`${controlClass} w-full pl-9`}
                style={controlStyle}
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyFilters();
                }}
                placeholder="PO number, supplier invoice, product name, code or SKU"
              />
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearFilters}
              className="h-10 rounded-md border px-4 text-sm"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyFilters}
              className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Apply filters
            </button>
          </div>
        </div>
      </section>

      {report ? (
        <>
          <section
            className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-start lg:justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {report.supplier.name}
                </h2>
                <StatusBadge value={report.supplier.status} />
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                {[
                  report.supplier.supplierCode,
                  report.supplier.company.name,
                  report.supplier.division?.name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/operations/suppliers/${report.supplier.id}`}
                className="inline-flex h-9 items-center rounded-md border px-3 text-sm"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
              >
                Supplier account
              </Link>
              {(
                [
                  ['pdf', 'PDF', FileText],
                  ['xlsx', 'Excel', FileSpreadsheet],
                  ['csv', 'CSV', Download],
                  ['json', 'JSON', FileJson],
                ] as const
              ).map(([format, label, Icon]) => (
                <button
                  key={format}
                  type="button"
                  disabled={Boolean(exporting)}
                  onClick={() => void exportReport(format)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50"
                  style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                >
                  <Icon className="h-4 w-4" /> {exporting === format ? 'Preparing…' : label}
                </button>
              ))}
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadReport()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border disabled:opacity-50"
                style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                title="Refresh report"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </section>

          <div
            className="grid overflow-hidden rounded-md border sm:grid-cols-2 xl:grid-cols-4"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <Metric label="Products supplied" value={String(report.summary.uniqueProducts)} />
            <Metric
              label="Missing invoice refs"
              value={String(report.summary.missingInvoiceCount)}
              help="Purchases needing supplier invoice details"
            />
            <Metric
              label="Procurement invoices"
              value={String(report.summary.linkedInvoiceCount)}
            />
            <Metric label="Report generated" value={dateOnly(report.generatedAt)} />
          </div>

          {report.summary.byCurrency.map((summary) => (
            <div
              key={summary.currency}
              className="grid overflow-hidden rounded-md border sm:grid-cols-2 xl:grid-cols-5"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <Metric
                label={`Purchases (${summary.currency})`}
                value={money(summary.totalPurchased, summary.currency)}
                help={`${summary.purchaseOrderCount} purchase orders`}
              />
              <Metric label="Paid" value={money(summary.paidAmount, summary.currency)} />
              <Metric
                label="PO outstanding"
                value={money(summary.outstandingAmount, summary.currency)}
              />
              <Metric
                label="AP outstanding"
                value={money(summary.payableOutstandingAmount, summary.currency)}
                help={`${summary.payableCount} payable records`}
              />
              <Metric
                label="Overdue AP"
                value={money(summary.overduePayableAmount, summary.currency)}
              />
            </div>
          ))}

          <nav
            className="flex gap-1 overflow-x-auto border-b"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => changeSection(tab.key)}
                className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${section === tab.key ? 'border-blue-500 text-blue-400' : 'border-transparent'}`}
                style={section === tab.key ? undefined : { color: 'var(--aurora-text-muted)' }}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {section === 'OVERVIEW' ? (
            <section
              className="grid gap-x-8 gap-y-5 border-b pb-6 sm:grid-cols-2 lg:grid-cols-4"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              {[
                ['Legal name', report.supplier.legalName],
                ['Phone', report.supplier.phone],
                ['Email', report.supplier.email],
                ['Payment terms', report.supplier.paymentTerms],
                ['TIN', report.supplier.tin],
                ['VRN', report.supplier.vrn],
                ['Address', report.supplier.address],
                [
                  'Categories',
                  report.supplier.categories.map((category) => category.name).join(', '),
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                    {label}
                  </p>
                  <p className="mt-1 break-words text-sm" style={{ color: 'var(--aurora-text)' }}>
                    {value || '—'}
                  </p>
                </div>
              ))}
            </section>
          ) : (
            <section
              className="min-w-0 overflow-hidden rounded-md border"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              {loading ? (
                <div
                  className="px-4 py-16 text-center text-sm"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Loading supplier report…
                </div>
              ) : report.rows.length === 0 ? (
                <div
                  className="px-4 py-16 text-center text-sm"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  No records match the selected filters.
                </div>
              ) : section === 'PURCHASES' ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] text-sm">
                    <thead
                      style={{
                        background: 'var(--aurora-bg-subtle)',
                        color: 'var(--aurora-text-muted)',
                      }}
                    >
                      <tr>
                        {[
                          '',
                          'Purchase order',
                          'Supplier invoice',
                          'Order date',
                          'Branch',
                          'Type',
                          'Total',
                          'Outstanding',
                          'Status',
                          'Payment',
                          'Action',
                        ].map((heading) => (
                          <th key={heading} className="px-3 py-3 text-left text-xs uppercase">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <PurchaseRow
                          key={row.id}
                          row={row}
                          open={expanded.has(row.id)}
                          onToggle={() => toggleExpanded(row.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : section === 'PRODUCTS' ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead
                      style={{
                        background: 'var(--aurora-bg-subtle)',
                        color: 'var(--aurora-text-muted)',
                      }}
                    >
                      <tr>
                        {[
                          'Product',
                          'Category',
                          'Unit',
                          'Purchases',
                          'Quantity',
                          'Average cost',
                          'Total purchased',
                          'Last purchase',
                        ].map((heading) => (
                          <th key={heading} className="px-3 py-3 text-left text-xs uppercase">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr
                          key={`${row.productCode}-${row.unit}-${row.currency}`}
                          className="border-t"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            color: 'var(--aurora-text)',
                          }}
                        >
                          <td className="px-3 py-3">
                            <p className="font-medium">{row.product}</p>
                            <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {row.productCode || row.sku || 'No code'}
                            </p>
                          </td>
                          <td className="px-3 py-3">{row.category || '—'}</td>
                          <td className="px-3 py-3">{row.unit || '—'}</td>
                          <td className="px-3 py-3">{row.purchaseCount}</td>
                          <td className="px-3 py-3 text-right">{row.quantity}</td>
                          <td className="px-3 py-3 text-right">
                            {money(row.averageUnitCost, row.currency)}
                          </td>
                          <td className="px-3 py-3 text-right font-medium">
                            {money(row.totalAmount, row.currency)}
                          </td>
                          <td className="px-3 py-3">{dateOnly(row.lastPurchaseDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead
                      style={{
                        background: 'var(--aurora-bg-subtle)',
                        color: 'var(--aurora-text-muted)',
                      }}
                    >
                      <tr>
                        {[
                          'Payable',
                          'Purchase order',
                          'Supplier invoice',
                          'Issue date',
                          'Due date',
                          'Amount',
                          'Paid',
                          'Outstanding',
                          'Status',
                          'Action',
                        ].map((heading) => (
                          <th key={heading} className="px-3 py-3 text-left text-xs uppercase">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            color: 'var(--aurora-text)',
                          }}
                        >
                          <td className="px-3 py-3 font-mono text-xs">{row.payableNumber}</td>
                          <td className="px-3 py-3 font-mono text-xs">
                            {row.purchaseOrderNumber || '—'}
                          </td>
                          <td className="px-3 py-3">
                            {row.invoiceNumber || <span className="text-red-300">Missing</span>}
                          </td>
                          <td className="px-3 py-3">{dateOnly(row.issueDate)}</td>
                          <td className="px-3 py-3">{dateOnly(row.dueDate)}</td>
                          <td className="px-3 py-3 text-right">
                            {money(row.amount, row.currency)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {money(row.paidAmount, row.currency)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {money(row.outstandingAmount, row.currency)}
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge value={row.status} />
                          </td>
                          <td className="px-3 py-3">
                            <Link
                              href={row.sourceHref || '#'}
                              className="text-blue-400 hover:underline"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {section !== 'OVERVIEW' && report.total > 0 ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                Page {page} of {totalPages} · {report.total} records
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="h-9 rounded-md border px-3 text-sm disabled:opacity-40"
                  style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((value) => value + 1)}
                  className="h-9 rounded-md border px-3 text-sm disabled:opacity-40"
                  style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div
          className="rounded-md border px-4 py-20 text-center"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
        >
          {loading
            ? 'Loading Supplier 360 report…'
            : 'Select a company and supplier to open the report.'}
        </div>
      )}
    </div>
  );
}

function PurchaseRow({
  row,
  open,
  onToggle,
}: {
  row: SupplierReportRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-t"
        style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
      >
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded"
            title={open ? 'Hide purchased products' : 'Show purchased products'}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-3 font-mono text-xs">{row.purchaseOrderNumber}</td>
        <td className="px-3 py-3">
          <p>{row.invoiceNumber || <span className="text-red-300">Missing</span>}</p>
          {row.invoiceNumber ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {row.invoiceSource === 'PROCUREMENT_INVOICE'
                ? 'Procurement invoice'
                : 'Operations reference'}
            </p>
          ) : null}
        </td>
        <td className="px-3 py-3">{dateOnly(row.orderDate)}</td>
        <td className="px-3 py-3">{row.branch || '—'}</td>
        <td className="px-3 py-3">{row.purchaseType?.replaceAll('_', ' ')}</td>
        <td className="px-3 py-3 text-right font-medium">{money(row.totalAmount, row.currency)}</td>
        <td className="px-3 py-3 text-right">{money(row.outstandingAmount, row.currency)}</td>
        <td className="px-3 py-3">
          <StatusBadge value={row.status} />
        </td>
        <td className="px-3 py-3">
          <StatusBadge value={row.paymentStatus} />
        </td>
        <td className="px-3 py-3">
          <Link href={row.sourceHref || '#'} className="text-blue-400 hover:underline">
            View PO
          </Link>
        </td>
      </tr>
      {open ? (
        <tr
          className="border-t"
          style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
        >
          <td colSpan={11} className="px-12 py-4">
            <div
              className="overflow-x-auto rounded border"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              <table className="w-full min-w-[720px] text-sm">
                <thead style={{ color: 'var(--aurora-text-muted)' }}>
                  <tr>
                    {['Product', 'Code / SKU', 'Quantity', 'Unit', 'Unit cost', 'Line total'].map(
                      (heading) => (
                        <th key={heading} className="px-3 py-2 text-left text-xs uppercase">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {row.lines?.map((line) => (
                    <tr
                      key={line.id}
                      className="border-t"
                      style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                    >
                      <td className="px-3 py-2">{line.product}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {line.productCode || line.sku || '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{line.quantity}</td>
                      <td className="px-3 py-2">{line.unit}</td>
                      <td className="px-3 py-2 text-right">{money(line.unitCost, row.currency)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {money(line.lineTotal, row.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
