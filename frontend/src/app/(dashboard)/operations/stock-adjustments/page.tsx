'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  Modal,
  Btn,
  PageSpinner,
  FormSelect,
  FormTextarea,
} from '@/components/ui';
import {
  backendDelete,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Branch {
  id: string;
  name: string;
  code?: string | null;
}
interface Product {
  id: string;
  name: string;
  productCode: string;
}
interface Unit {
  id: string;
  name: string;
  symbol: string;
}

interface AdjustmentLine {
  id?: string;
  productId: string;
  systemQty: number;
  countedQty: number;
  unitId: string;
  reason: string;
}

interface StockAdjustment {
  id: string;
  adjustmentNumber?: string;
  status: string;
  reason: string;
  notes?: string | null;
  companyId: string;
  branchId?: string | null;
  createdAt: string;
  company?: { name: string } | null;
  location?: { name: string; locationCode: string } | null;
  branch?: { name: string; code?: string | null } | null;
  lines?: AdjustmentLine[];
  _count?: { lines?: number } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const emptyPaginated = <T,>(): Paginated<T> => ({ data: [], total: 0, page: 1, totalPages: 1 });

interface AdjustmentForm {
  companyId: string;
  branchId: string;
  reason: string;
  notes: string;
  lines: AdjustmentLine[];
}

const BLANK_LINE = (): AdjustmentLine => ({
  productId: '',
  systemQty: 0,
  countedQty: 0,
  unitId: '',
  reason: '',
});
const BLANK_FORM: AdjustmentForm = {
  companyId: '',
  branchId: '',
  reason: '',
  notes: '',
  lines: [BLANK_LINE()],
};

function CreateAdjustmentModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AdjustmentForm>({ ...BLANK_FORM });
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      backendList<Unit>('/units', { query: { limit: 100 } }),
      backendList<Product>('/products', { query: { limit: 300 } }),
    ]).then(([unitResult, productResult]) => {
      if (cancelled) return;
      setUnits(unitResult.status === 'fulfilled' ? unitResult.value : []);
      setProducts(productResult.status === 'fulfilled' ? productResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!form.companyId) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    backendList<Branch>('/branches', {
      query: { companyId: form.companyId, activeOnly: true, limit: 200 },
    })
      .then((rows) => {
        if (!cancelled) setBranches(rows);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const setField = <K extends keyof AdjustmentForm>(k: K, v: AdjustmentForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<AdjustmentLine>) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, BLANK_LINE()] }));
  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.branchId) {
      setError('Branch/location is required');
      return;
    }
    if (!form.reason.trim()) {
      setError('Reason is required');
      return;
    }
    if (!form.lines.length) {
      setError('Add at least one line');
      return;
    }
    if (form.lines.some((l) => !l.productId || !l.unitId)) {
      setError('Each line needs product and unit');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        companyId: form.companyId,
        branchId: form.branchId,
        reason: form.reason,
        notes: form.notes || undefined,
        lines: form.lines.map((l) => ({
          productId: l.productId,
          systemQty: Number(l.systemQty) || 0,
          countedQty: Number(l.countedQty) || 0,
          unitId: l.unitId,
          reason: l.reason || undefined,
        })),
      };
      await backendPost('/stock-adjustments', body);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create Stock Adjustment"
      size="2xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            Create Draft
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => {
              setField('companyId', e.target.value);
              setField('branchId', '');
            }}
            placeholder="Select company"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch / Location"
            required
            value={form.branchId}
            onChange={(e) => setField('branchId', e.target.value)}
            placeholder={form.companyId ? 'Select branch/location' : 'Select company first'}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code ? `${branch.code} - ` : ''}
                {branch.name}
              </option>
            ))}
          </FormSelect>
        </div>
        <FormTextarea
          label="Reason"
          required
          rows={2}
          value={form.reason}
          onChange={(e) => setField('reason', e.target.value)}
          placeholder="Stock take, damage, etc."
        />
        <FormTextarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Line Items
            </h4>
            <Btn variant="secondary" size="xs" onClick={addLine}>
              + Add Line
            </Btn>
          </div>
          <div
            className="overflow-x-auto rounded-lg border"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">System Qty</th>
                  <th className="px-3 py-2">Counted Qty</th>
                  <th className="px-3 py-2">Variance</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.lines.map((line, i) => {
                  const variance = (Number(line.countedQty) || 0) - (Number(line.systemQty) || 0);
                  const varColor =
                    variance > 0
                      ? 'text-emerald-600'
                      : variance < 0
                        ? 'text-red-600'
                        : 'text-slate-500';
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1">
                        <select
                          value={line.productId}
                          onChange={(e) => setLine(i, { productId: e.target.value })}
                          className="w-full text-xs border rounded px-2 py-1"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                        >
                          <option value="">Select…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          value={line.systemQty}
                          onChange={(e) => setLine(i, { systemQty: Number(e.target.value) })}
                          className="w-24 text-xs border rounded px-2 py-1"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          value={line.countedQty}
                          onChange={(e) => setLine(i, { countedQty: Number(e.target.value) })}
                          className="w-24 text-xs border rounded px-2 py-1"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                        />
                      </td>
                      <td className={`px-3 py-1 text-xs tabular-nums font-medium ${varColor}`}>
                        {variance > 0 ? '+' : ''}
                        {variance}
                      </td>
                      <td className="px-2 py-1">
                        <select
                          value={line.unitId}
                          onChange={(e) => setLine(i, { unitId: e.target.value })}
                          className="w-full text-xs border rounded px-2 py-1"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                        >
                          <option value="">Unit…</option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.symbol}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={line.reason}
                          onChange={(e) => setLine(i, { reason: e.target.value })}
                          className="w-full text-xs border rounded px-2 py-1"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        {form.lines.length > 1 && (
                          <Btn variant="ghost" size="xs" onClick={() => removeLine(i)}>
                            ×
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RejectDialog({
  id,
  onClose,
  onConfirmed,
}: {
  id: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleReject = async () => {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await backendPatch(`/stock-adjustments/${id}/reject`, { reason });
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Reject Adjustment"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleReject} loading={saving}>
            Reject
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <FormTextarea
        label="Reason"
        required
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

function DeleteConfirm({
  adj,
  onClose,
  onConfirmed,
}: {
  adj: StockAdjustment;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/stock-adjustments/${adj.id}`);
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel Adjustment"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Keep
          </Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>
            Cancel Adjustment
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Cancel adjustment <strong>{adj.adjustmentNumber ?? adj.id}</strong>?
      </p>
    </Modal>
  );
}

export default function StockAdjustmentsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<StockAdjustment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StockAdjustment | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');

  const canView = hasPermission('inventory.view');
  const canCreate = hasPermission('inventory.adjustments.create');
  const canApprove = hasPermission('inventory.adjustments.approve');
  const canPost = hasPermission('inventory.adjustments.post');

  useEffect(() => {
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setLoadError('');
    try {
      setData(
        await backendPage<StockAdjustment>('/stock-adjustments', {
          query: {
            page,
            limit: 20,
            companyId: companyId || undefined,
            status: status || undefined,
          },
        }),
      );
    } catch (err: unknown) {
      setData(emptyPaginated<StockAdjustment>());
      setLoadError(err instanceof Error ? err.message : 'Failed to load stock adjustments');
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const doAction = async (id: string, action: 'submit' | 'approve' | 'post') => {
    setActionLoading(`${id}:${action}`);
    setActionError('');
    try {
      await backendPatch(`/stock-adjustments/${id}/${action}`);
      await load();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Stock Adjustments" subtitle="Inventory adjustments" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
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

  const counts = {
    draft: data?.data.filter((a) => a.status === 'DRAFT').length ?? 0,
    pending: data?.data.filter((a) => a.status === 'PENDING_APPROVAL').length ?? 0,
    approved: data?.data.filter((a) => a.status === 'APPROVED').length ?? 0,
    posted: data?.data.filter((a) => a.status === 'POSTED').length ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <CreateAdjustmentModal
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {rejecting && (
        <RejectDialog
          id={rejecting}
          onClose={() => setRejecting(null)}
          onConfirmed={() => {
            setRejecting(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          adj={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader title="Stock Adjustments" subtitle="Reconcile inventory counts and corrections" />

      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Draft (page)" value={counts.draft} />
        <StatCard label="Pending (page)" value={counts.pending} />
        <StatCard label="Approved (page)" value={counts.approved} />
        <StatCard label="Posted (page)" value={counts.posted} />
      </div>

      {loadError && (
        <div
          role="alert"
          className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          {loadError}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          {actionError}
        </div>
      )}

      <PageToolbar
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="POSTED">Posted</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </>
        }
        actions={
          canCreate ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Adjustment
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Branch / Location</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Lines</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No adjustments
                  </td>
                </tr>
              ) : (
                data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      {a.adjustmentNumber ?? a.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-xs">{a.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {a.branch?.name ?? a.location?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs truncate max-w-[200px]" title={a.reason}>
                      {a.reason}
                    </td>
                    <td className="px-4 py-3 text-xs">{a._count?.lines ?? a.lines?.length ?? 0}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={a.status} />
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {a.status === 'DRAFT' && canCreate && (
                        <>
                          <Btn
                            variant="primary"
                            size="xs"
                            loading={actionLoading === `${a.id}:submit`}
                            onClick={() => doAction(a.id, 'submit')}
                          >
                            Submit
                          </Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(a)}>
                            Cancel
                          </Btn>
                        </>
                      )}
                      {a.status === 'PENDING_APPROVAL' && canApprove && (
                        <>
                          <Btn
                            variant="success"
                            size="xs"
                            loading={actionLoading === `${a.id}:approve`}
                            onClick={() => doAction(a.id, 'approve')}
                          >
                            Approve
                          </Btn>
                          <Btn variant="danger" size="xs" onClick={() => setRejecting(a.id)}>
                            Reject
                          </Btn>
                        </>
                      )}
                      {a.status === 'APPROVED' && canPost && (
                        <Btn
                          variant="primary"
                          size="xs"
                          loading={actionLoading === `${a.id}:post`}
                          onClick={() => doAction(a.id, 'post')}
                        >
                          Post
                        </Btn>
                      )}
                      {(a.status === 'REJECTED' || a.status === 'CANCELLED') && canCreate && (
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(a)}>
                          Delete
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
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
