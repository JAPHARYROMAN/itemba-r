'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  ConfirmDialog,
  PermissionDeniedState,
  showToast,
} from '@/components/ui';
import { ResponsiveDataTable, type ResponsiveColumn } from '@/components/aurora/data-display/ResponsiveDataTable';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPost } from '@/lib/api-client';
// Note: this list reads the response raw via backendGet because the backend
// returns { items, total, ... } rather than the { data, ... } shape that
// backendPage/normalizePaginated read from.
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface Supplier {
  id: string;
  name: string;
  supplierCode?: string | null;
}

interface SupplierQuotationLine {
  id: string;
  productId?: string | null;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
}

interface SupplierQuotation extends Record<string, unknown> {
  id: string;
  supplierQuotationNumber: string;
  companyId: string;
  supplierId: string;
  rfqId?: string | null;
  quotationDate: string;
  validUntil?: string | null;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  currency: string;
  status: string;
  notes?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  lines?: SupplierQuotationLine[];
  // Optional relations if the backend later includes them.
  company?: { name?: string | null; code?: string | null } | null;
  supplier?: { name?: string | null; supplierCode?: string | null } | null;
  rfq?: { id: string; rfqNumber?: string | null } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

// The supplier-quotations endpoint returns { items, total, page, limit }
// (not the { data, total, ... } shape backendPage/normalizePaginated expects),
// so we read the response raw with backendGet and fall back across both keys.
interface ListEnvelope {
  items?: SupplierQuotation[];
  data?: SupplierQuotation[];
  total?: number;
  page?: number;
  limit?: number;
}

// SupplierQuotationStatus enum from the Prisma schema.
const STATUSES = ['DRAFT', 'RECEIVED', 'EVALUATED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

// Statuses the backend allows accept/reject against (service guard: DRAFT | SUBMITTED,
// but the schema uses RECEIVED — we surface actions for the not-yet-decided states and
// let the backend enforce the final rule, surfacing any 400 via a toast).
const DECIDABLE_STATUSES = ['DRAFT', 'RECEIVED', 'EVALUATED'];

const PAGE_SIZE = 20;

function emptyPage<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number | string, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asNumber(value))}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

type PendingAction = { quotation: SupplierQuotation; action: 'accept' | 'reject' };

export default function SupplierQuotationsPage() {
  const { hasPermission } = useAuth();

  const canView =
    hasPermission('supplier_quotations.list') || hasPermission('supplier_quotations.view');
  // Backend gates both accept and reject on 'supplier_quotations.accept'.
  const canDecide = hasPermission('supplier_quotations.accept');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [data, setData] = useState<Paginated<SupplierQuotation> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Name-resolution lookups: the list endpoint returns raw FK ids only.
  const companyMap = useMemo(() => {
    const map = new Map<string, Company>();
    companies.forEach((c) => map.set(c.id, c));
    return map;
  }, [companies]);

  const supplierMap = useMemo(() => {
    const map = new Map<string, Supplier>();
    suppliers.forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliers]);

  const companyName = useCallback(
    (q: SupplierQuotation) =>
      q.company?.name ?? companyMap.get(q.companyId)?.name ?? q.companyId,
    [companyMap],
  );

  const supplierName = useCallback(
    (q: SupplierQuotation) =>
      q.supplier?.name ?? supplierMap.get(q.supplierId)?.name ?? q.supplierId,
    [supplierMap],
  );

  // Load companies for the filter + name resolution.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 200 } })
      .then((items) => {
        if (!cancelled) setCompanies(items);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  // Load suppliers scoped to the selected company (or all) for name resolution + filter.
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Supplier>('/suppliers', {
      query: { companyId: companyId || undefined, limit: 500 },
    })
      .then((items) => {
        if (!cancelled) setSuppliers(items);
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  // Debounce the search box.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const result = await backendGet<ListEnvelope | SupplierQuotation[]>(
        '/supplier-quotations',
        {
          query: {
            page,
            limit: PAGE_SIZE,
            companyId: companyId || undefined,
            supplierId: supplierId || undefined,
            status: status || undefined,
            search: search.trim() || undefined,
          },
        },
      );
      const rows = Array.isArray(result) ? result : (result.items ?? result.data ?? []);
      const total = Array.isArray(result)
        ? rows.length
        : Number(result.total ?? rows.length);
      setData({
        data: rows,
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supplier quotations');
      setData(emptyPage<SupplierQuotation>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, supplierId, status, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDecision = async ({ quotation, action }: PendingAction) => {
    setBusyId(quotation.id);
    try {
      await backendPost(`/supplier-quotations/${quotation.id}/${action}`);
      showToast(
        'success',
        `Quotation ${quotation.supplierQuotationNumber} ${
          action === 'accept' ? 'accepted' : 'rejected'
        }`,
      );
      setPending(null);
      await load();
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : `Failed to ${action} quotation`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const quotations = useMemo(() => data?.data ?? [], [data]);

  const stats = useMemo(() => {
    const accepted = quotations.filter((q) => q.status === 'ACCEPTED').length;
    const pendingReview = quotations.filter((q) => DECIDABLE_STATUSES.includes(q.status)).length;
    const acceptedValue = quotations
      .filter((q) => q.status === 'ACCEPTED')
      .reduce((sum, q) => sum + asNumber(q.totalAmount), 0);
    return { accepted, pendingReview, acceptedValue };
  }, [quotations]);

  const exportCsv = () => {
    if (!quotations.length) return;
    const rows = quotations.map((q) => ({
      'Quotation #': q.supplierQuotationNumber,
      Company: companyName(q),
      Supplier: supplierName(q),
      RFQ: q.rfq?.rfqNumber ?? q.rfqId ?? '',
      'Quotation Date': formatDate(q.quotationDate),
      'Valid Until': formatDate(q.validUntil),
      Subtotal: asNumber(q.subtotal).toFixed(2),
      Tax: asNumber(q.taxAmount).toFixed(2),
      Discount: asNumber(q.discountAmount).toFixed(2),
      Total: asNumber(q.totalAmount).toFixed(2),
      Currency: q.currency,
      Status: q.status,
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`supplier-quotations-${stamp}.csv`, 'text/csv;charset=utf-8', rowsToCsv(rows));
  };

  const columns: ResponsiveColumn<SupplierQuotation>[] = [
    {
      key: 'supplierQuotationNumber',
      header: 'Quotation #',
      priority: 1,
      accessor: (q) => <span className="font-mono text-xs">{q.supplierQuotationNumber}</span>,
    },
    {
      key: 'supplier',
      header: 'Supplier',
      priority: 1,
      accessor: (q) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{supplierName(q)}</div>
          <div className="text-xs truncate" style={{ color: 'var(--aurora-text-muted)' }}>
            {companyName(q)}
          </div>
        </div>
      ),
    },
    {
      key: 'rfqId',
      header: 'RFQ',
      priority: 3,
      accessor: (q) =>
        q.rfq?.rfqNumber || q.rfqId ? (
          <span className="text-xs">{q.rfq?.rfqNumber ?? q.rfqId}</span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            —
          </span>
        ),
    },
    {
      key: 'quotationDate',
      header: 'Quotation Date',
      priority: 2,
      accessor: (q) => <span className="text-sm">{formatDate(q.quotationDate)}</span>,
    },
    {
      key: 'validUntil',
      header: 'Valid Until',
      priority: 3,
      accessor: (q) => <span className="text-sm">{formatDate(q.validUntil)}</span>,
    },
    {
      key: 'totalAmount',
      header: 'Total',
      priority: 1,
      align: 'right',
      accessor: (q) => <span className="font-medium">{money(q.totalAmount, q.currency)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      accessor: (q) => <StatusBadge status={q.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      priority: 1,
      align: 'right',
      exportExclude: true,
      accessor: (q) => {
        if (!canDecide || !DECIDABLE_STATUSES.includes(q.status)) {
          return (
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              —
            </span>
          );
        }
        return (
          <div className="flex justify-end gap-1">
            <Btn
              variant="primary"
              size="xs"
              loading={busyId === q.id}
              aria-label={`Accept quotation ${q.supplierQuotationNumber}`}
              onClick={() => setPending({ quotation: q, action: 'accept' })}
            >
              Accept
            </Btn>
            <Btn
              variant="secondary"
              size="xs"
              loading={busyId === q.id}
              aria-label={`Reject quotation ${q.supplierQuotationNumber}`}
              onClick={() => setPending({ quotation: q, action: 'reject' })}
            >
              Reject
            </Btn>
          </div>
        );
      },
    },
  ];

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Supplier Quotations"
          subtitle="Review quotations received from suppliers"
        />
        <PermissionDeniedState />
      </div>
    );
  }

  const totalPages = data?.totalPages ?? 1;

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Supplier Quotations"
        subtitle="Review, accept, and reject quotations received from suppliers"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Quotations" value={data?.total ?? 0} />
        <StatCard label="Pending Review" value={stats.pendingReview} variant="amber" />
        <StatCard label="Accepted" value={stats.accepted} variant="green" />
        <StatCard label="Accepted Value" value={money(stats.acceptedValue)} />
      </div>

      <PageToolbar
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search quotation number..."
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setSupplierId('');
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by supplier"
              value={supplierId}
              onChange={(event) => {
                setSupplierId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Statuses</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          <Btn variant="secondary" onClick={exportCsv} disabled={!quotations.length}>
            Export CSV
          </Btn>
        }
      />

      <ResponsiveDataTable<SupplierQuotation>
        columns={columns}
        data={quotations}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={() => void load()}
        errorTitle="Could not load supplier quotations"
        emptyTitle="No supplier quotations found"
        emptyDescription="Adjust your filters or wait for suppliers to submit quotations."
        exportable
        onExport={exportCsv}
        exportFileName="supplier-quotations"
        pagination={{
          page,
          limit: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: (next) => {
            if (next >= 1 && next <= totalPages) setPage(next);
          },
        }}
      />

      {pending && (
        <ConfirmDialog
          open
          onClose={() => {
            if (!busyId) setPending(null);
          }}
          onConfirm={() => runDecision(pending)}
          title={pending.action === 'accept' ? 'Accept quotation?' : 'Reject quotation?'}
          message={
            pending.action === 'accept'
              ? `Accept quotation ${pending.quotation.supplierQuotationNumber} from ${supplierName(
                  pending.quotation,
                )} for ${money(pending.quotation.totalAmount, pending.quotation.currency)}?`
              : `Reject quotation ${pending.quotation.supplierQuotationNumber} from ${supplierName(
                  pending.quotation,
                )}? This cannot be undone.`
          }
          confirmLabel={pending.action === 'accept' ? 'Accept' : 'Reject'}
          variant={pending.action === 'reject' ? 'danger' : 'default'}
          loading={busyId === pending.quotation.id}
        />
      )}
    </div>
  );
}
