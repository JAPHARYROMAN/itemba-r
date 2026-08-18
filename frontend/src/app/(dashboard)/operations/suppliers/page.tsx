'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  Modal,
  PageHeader,
  PageToolbar,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  backendDelete,
  backendGet,
  backendList,
  backendPage,
  backendPatch,
} from '@/lib/api-client';
import {
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  SupplierFormModal,
  humanize,
  type Company,
  type Division,
  type ProductCategory,
  type Supplier,
} from './_components/SupplierFormModal';

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

interface WorkbenchSummary {
  total: number;
  active: number;
  blocked: number;
  inactive: number;
  currentBalance: number;
  openPayableBalance: number;
  overduePayableBalance: number;
}

function emptyPaginated<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

function fmtMoney(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0)
  );
}

function DeleteConfirm({
  supplier,
  onClose,
  onConfirmed,
}: {
  supplier: Supplier;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/suppliers/${supplier.id}`);
      showToast('success', 'Supplier deleted', supplier.name);
      onConfirmed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete supplier';
      setError(message);
      showToast('error', 'Could not delete supplier', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Supplier"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>
            Delete
          </Btn>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-200">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Delete <strong>{supplier.name}</strong>? Suppliers linked to historical purchases remain
        preserved in those documents, but this supplier will no longer be selectable.
      </p>
    </Modal>
  );
}

export default function SuppliersPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [summary, setSummary] = useState<WorkbenchSummary | null>(null);
  const [data, setData] = useState<Paginated<Supplier> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierType, setSupplierType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const canView = hasPermission('suppliers.view');
  const canCreate = hasPermission('suppliers.create');
  const canUpdate = hasPermission('suppliers.update') || canCreate;
  const canDelete = hasPermission('suppliers.delete');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    Promise.allSettled([
      backendList<Company>('/companies', { query: { limit: 500 } }),
      backendList<ProductCategory>('/product-categories', { query: { limit: 5000 } }),
    ]).then(([companyResult, categoryResult]) => {
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setDivisionId('');
      return;
    }
    let cancelled = false;
    backendList<Division>('/divisions', { query: { companyId, limit: 500 } })
      .then((rows) => {
        if (!cancelled) setDivisions(rows);
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      companyId: companyId || undefined,
      divisionId: divisionId || undefined,
      productCategoryId: categoryId || undefined,
      supplierType: supplierType || undefined,
      status: status || undefined,
    }),
    [categoryId, companyId, debouncedSearch, divisionId, status, supplierType],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [listResult, summaryResult] = await Promise.all([
        backendPage<Supplier>('/suppliers', { query: { ...query, page, limit: 20 } }),
        backendGet<WorkbenchSummary>('/suppliers/workbench-summary', { query }),
      ]);
      setData(listResult);
      setSummary(summaryResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load suppliers';
      setError(message);
      setData(emptyPaginated<Supplier>(page));
      setSummary(null);
      showToast('error', 'Could not load suppliers', message);
    } finally {
      setLoading(false);
    }
  }, [canView, page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusToggle = async (supplier: Supplier) => {
    const nextStatus = supplier.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    try {
      await backendPatch(`/suppliers/${supplier.id}`, {
        companyId: supplier.companyId,
        status: nextStatus,
      });
      showToast('success', nextStatus === 'BLOCKED' ? 'Supplier blocked' : 'Supplier unblocked', supplier.name);
      load();
    } catch (err) {
      showToast('error', 'Could not update supplier status', err instanceof Error ? err.message : 'Failed');
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Suppliers" subtitle="Supplier control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="space-y-6 p-6">
      {creating && (
        <SupplierFormModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <SupplierFormModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          supplier={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader
        title="Suppliers"
        subtitle="Supplier profiles, purchase exposure, payables, statements, and performance"
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard label="Total Suppliers" value={summary?.total ?? data?.total ?? 0} />
        <StatCard label="Active" value={summary?.active ?? 0} />
        <StatCard label="Blocked" value={summary?.blocked ?? 0} />
        <StatCard label="Open AP" value={fmtMoney(summary?.openPayableBalance)} />
        <StatCard label="Overdue AP" value={fmtMoney(summary?.overduePayableBalance)} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search name, code, contact, phone, TIN or VRN..."
        filters={
          <>
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setDivisionId('');
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
              value={divisionId}
              onChange={(event) => {
                setDivisionId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              disabled={!companyId}
            >
              <option value="">All Divisions</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              value={supplierType}
              onChange={(event) => {
                setSupplierType(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {SUPPLIER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanize(type)}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {SUPPLIER_STATUSES.map((row) => (
                <option key={row} value={row}>
                  {humanize(row)}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          canCreate ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Supplier
            </Btn>
          ) : null
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">Credit Limit</th>
                <th className="px-4 py-3 text-right">Current Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <SkeletonTable rows={6} cols={8} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    No suppliers found
                  </td>
                </tr>
              ) : (
                data.data.map((supplier) => (
                  <tr key={supplier.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {supplier.name}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {supplier.supplierCode ?? 'No code'} · {humanize(supplier.supplierType)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{supplier.company?.name ?? '—'}</div>
                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                        {supplier.division
                          ? `${supplier.division.name}${supplier.division.code ? ` (${supplier.division.code})` : ''}`
                          : 'No division'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {supplier.productCategories?.length
                        ? supplier.productCategories.map((item) => item.productCategory.name).join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{supplier.phone ?? supplier.email ?? '—'}</div>
                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                        {supplier.contactPerson ?? supplier.tin ?? ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(supplier.creditLimit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(supplier.currentBalance)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={supplier.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => router.push(`/operations/suppliers/${supplier.id}`)}
                        >
                          View
                        </Btn>
                        {canUpdate && (
                          <>
                            <Btn variant="ghost" size="xs" onClick={() => setEditing(supplier)}>
                              Edit
                            </Btn>
                            <Btn
                              variant={supplier.status === 'BLOCKED' ? 'success' : 'warning'}
                              size="xs"
                              onClick={() => handleStatusToggle(supplier)}
                            >
                              {supplier.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                            </Btn>
                          </>
                        )}
                        {canDelete && (
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(supplier)}>
                            Delete
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
          <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((current) => current + 1)}
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
