'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  PageToolbar,
  SkeletonTable,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendList, backendPage, backendPost } from '@/lib/api-client';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface NamedRef {
  id: string;
  name: string;
  code?: string | null;
}

interface Grn {
  id: string;
  grnNumber: string;
  companyId: string;
  supplierId?: string | null;
  branchId?: string | null;
  receivedDate?: string | null;
  status: string;
  postedAt?: string | null;
  branch?: NamedRef | null;
  division?: NamedRef | null;
  company?: { name?: string | null; code?: string | null } | null;
  supplier?: { name?: string | null; supplierCode?: string | null } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const STATUSES = ['DRAFT', 'RECEIVED', 'INSPECTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED'];

function emptyPage<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export default function GRNsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('grn.list');
  const canApprove = hasPermission('grn.approve');
  const canPost = hasPermission('grn.post');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Grn> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ grn: Grn; action: 'approve' | 'post' } | null>(null);

  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    companies.forEach((company) => map.set(company.id, company.name));
    return map;
  }, [companies]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 100 } })
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

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await backendPage<Grn>('/goods-received-notes', {
        query: {
          page,
          limit: 20,
          companyId: companyId || undefined,
          status: status || undefined,
          search: search.trim() || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goods received notes');
      setData(emptyPage<Grn>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (grn: Grn, action: 'approve' | 'post') => {
      setBusyId(grn.id);
      setError(null);
      try {
        await backendPost(`/goods-received-notes/${grn.id}/${action}`);
        setPending(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed');
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Goods Received Notes" subtitle="Record and track goods received from suppliers" />
        <Card className="mt-6">
          <div className="px-6 py-12 text-center">
            <p className="text-[15px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
              Access Restricted
            </p>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
              You do not have permission to view goods received notes.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const grns = data?.data ?? [];
  const draftCount = grns.filter((grn) => grn.status === 'DRAFT').length;
  const approvedCount = grns.filter((grn) => grn.status === 'APPROVED').length;
  const postedCount = grns.filter((grn) => grn.status === 'POSTED').length;

  const exportCsv = () => {
    const rows = grns.map((grn) => ({
      'GRN #': grn.grnNumber,
      Company: grn.company?.name ?? companyNameById.get(grn.companyId) ?? grn.companyId,
      Supplier: grn.supplier?.name ?? grn.supplierId ?? '',
      'Branch / Location': grn.branch?.name ?? '',
      'Received Date': formatDate(grn.receivedDate),
      Status: grn.status,
      'Posted At': formatDate(grn.postedAt),
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`goods-received-notes-${stamp}.csv`, 'text/csv;charset=utf-8', rowsToCsv(rows));
  };

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  const companyLabel = (grn: Grn) =>
    grn.company?.name ?? companyNameById.get(grn.companyId) ?? grn.companyId;
  const supplierLabel = (grn: Grn) => grn.supplier?.name ?? grn.supplierId ?? '—';
  const branchLabel = (grn: Grn) => grn.branch?.name ?? '—';

  return (
    <div className="p-6 space-y-6">
      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === 'post' ? 'Post goods received note' : 'Approve goods received note'}
        message={
          pending?.action === 'post'
            ? `Post GRN ${pending?.grn.grnNumber}? This receives the accepted quantities into inventory and cannot be undone.`
            : `Approve GRN ${pending?.grn.grnNumber}? Only DRAFT notes can be approved.`
        }
        confirmLabel={pending?.action === 'post' ? 'Post' : 'Approve'}
        variant={pending?.action === 'post' ? 'warning' : 'default'}
        loading={pending ? busyId === pending.grn.id : false}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void runAction(pending.grn, pending.action);
        }}
      />

      <PageHeader
        title="Goods Received Notes"
        subtitle="Record and track goods received from suppliers"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Notes" value={data?.total ?? 0} />
        <StatCard label="Draft" value={draftCount} />
        <StatCard label="Approved" value={approvedCount} />
        <StatCard label="Posted" value={postedCount} />
      </div>

      <PageToolbar
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search GRN number..."
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
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
          <Btn variant="secondary" onClick={exportCsv} disabled={!grns.length}>
            Export CSV
          </Btn>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <caption className="sr-only">Goods received notes</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">
                  GRN #
                </th>
                <th scope="col" className="px-4 py-3">
                  Company
                </th>
                <th scope="col" className="px-4 py-3">
                  Supplier
                </th>
                <th scope="col" className="px-4 py-3">
                  Branch / Location
                </th>
                <th scope="col" className="px-4 py-3">
                  Received Date
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  Posted At
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <SkeletonTable rows={6} cols={8} />
                  </td>
                </tr>
              ) : !grns.length ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No goods received notes"
                      description="Records will appear here once goods are received from suppliers."
                    />
                  </td>
                </tr>
              ) : (
                grns.map((grn) => (
                  <tr key={grn.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{grn.grnNumber}</td>
                    <td className="px-4 py-3">{companyLabel(grn)}</td>
                    <td className="px-4 py-3">{supplierLabel(grn)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>
                      {branchLabel(grn)}
                    </td>
                    <td className="px-4 py-3">{formatDate(grn.receivedDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={grn.status} />
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>
                      {formatDate(grn.postedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canApprove && grn.status === 'DRAFT' && (
                          <Btn
                            variant="secondary"
                            size="xs"
                            loading={busyId === grn.id}
                            onClick={() => setPending({ grn, action: 'approve' })}
                          >
                            Approve
                          </Btn>
                        )}
                        {canPost && grn.status === 'APPROVED' && (
                          <Btn
                            variant="primary"
                            size="xs"
                            loading={busyId === grn.id}
                            onClick={() => setPending({ grn, action: 'post' })}
                          >
                            Post
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div
            className="flex items-center justify-between border-t px-5 py-3"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} - {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
