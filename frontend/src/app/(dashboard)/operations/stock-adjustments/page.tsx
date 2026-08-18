'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  Modal,
  DetailDrawer,
  ProductPicker,
  Btn,
  PageSpinner,
  FormSelect,
  FormTextarea,
  SkeletonTable,
  EmptyState,
} from '@/components/ui';
import { rowsToCsv, downloadTextFile, cellToString } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';
import {
  backendDelete,
  backendGet,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Division {
  id: string;
  name: string;
  code?: string | null;
}
interface Branch {
  id: string;
  name: string;
  code?: string | null;
  divisionId?: string | null;
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
  unitCost: number | '';
  reason: string;
  // UI-only: system qty was prefilled from the live balance, so it is read-only.
  systemQtyLocked?: boolean;
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

interface AdjustmentDetailLine {
  id: string;
  productId: string;
  systemQuantity: number | string;
  countedQuantity: number | string;
  varianceQuantity: number | string;
  unitCost?: number | string | null;
  reason?: string | null;
  product?: { id: string; name: string; sku?: string | null } | null;
  unit?: { id: string; name: string; symbol: string } | null;
}
interface AdjustmentDetail {
  id: string;
  adjustmentNumber?: string;
  status: string;
  reason: string;
  notes?: string | null;
  createdAt?: string;
  approvedAt?: string | null;
  postedAt?: string | null;
  company?: { name: string } | null;
  branch?: { name: string; code?: string | null } | null;
  createdBy?: { fullName: string } | null;
  approvedBy?: { fullName: string } | null;
  postedBy?: { fullName: string } | null;
  lines?: AdjustmentDetailLine[];
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
  divisionId: string;
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
  unitCost: '',
  reason: '',
});
const BLANK_FORM: AdjustmentForm = {
  companyId: '',
  divisionId: '',
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
  const workspace = useInventoryWorkspace();
  const workspaceScope = workspace?.scope;
  const [form, setForm] = useState<AdjustmentForm>({ ...BLANK_FORM });
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceScope) return;
    setForm((current) => ({
      ...current,
      companyId: workspaceScope.companyId,
      divisionId: workspaceScope.divisionId,
      branchId: workspaceScope.branchId,
    }));
  }, [workspaceScope]);

  useEffect(() => {
    let cancelled = false;
    backendList<Unit>('/units', { query: { limit: 100 } })
      .then((rows) => {
        if (!cancelled) setUnits(rows);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      return;
    }
    let cancelled = false;
    backendList<Division>('/divisions', {
      query: { companyId: form.companyId, limit: 200 },
    })
      .then((rows) => {
        if (!cancelled) setDivisions(rows);
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  useEffect(() => {
    if (!form.companyId) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    backendList<Branch>('/branches', {
      query: {
        companyId: form.companyId,
        divisionId: form.divisionId || undefined,
        activeOnly: true,
        limit: 200,
      },
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
  }, [form.companyId, form.divisionId]);

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

  // Prefill (and lock) System Qty from the live on-hand balance for the chosen
  // product at the chosen branch, so variance = counted − actual stock. Falls back
  // to an editable 0 when there is no balance row yet.
  const prefillSystemQty = async (i: number, productId: string) => {
    if (!productId || !form.companyId || !form.branchId) {
      setLine(i, { systemQty: 0, systemQtyLocked: false });
      return;
    }
    try {
      const res = await backendPage<{ quantityOnHand: number | string }>('/inventory-balances', {
        query: { companyId: form.companyId, productId, locationId: form.branchId, limit: 1 },
      });
      const row = res.data[0];
      const onHand = row ? Number(row.quantityOnHand) : 0;
      setLine(i, {
        systemQty: Number.isFinite(onHand) ? onHand : 0,
        systemQtyLocked: Boolean(row),
      });
    } catch {
      setLine(i, { systemQtyLocked: false });
    }
  };

  // Stock differs per branch — re-prefill every product line when the branch changes.
  useEffect(() => {
    if (!form.companyId || !form.branchId) return;
    form.lines.forEach((l, i) => {
      if (l.productId) void prefillSystemQty(i, l.productId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.branchId]);

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
    if (
      form.lines.some((l) => {
        const variance = (Number(l.countedQty) || 0) - (Number(l.systemQty) || 0);
        return variance > 0 && (!l.unitCost || Number(l.unitCost) <= 0);
      })
    ) {
      setError('Every positive stock addition must include a unit cost greater than zero');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        companyId: form.companyId,
        ...(form.divisionId ? { divisionId: form.divisionId } : {}),
        branchId: form.branchId,
        reason: form.reason,
        notes: form.notes || undefined,
        lines: form.lines.map((l) => ({
          productId: l.productId,
          systemQuantity: Number(l.systemQty) || 0,
          countedQuantity: Number(l.countedQty) || 0,
          unitId: l.unitId,
          unitCost: l.unitCost ? Number(l.unitCost) : undefined,
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
      {workspace && !workspace.scope.branchId && (
        <div
          className="mb-3 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--aurora-primary)',
            background: 'var(--aurora-primary-subtle)',
            color: 'var(--aurora-text)',
          }}
        >
          Choose the division and branch for this adjustment.
        </div>
      )}
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            onChange={(e) => {
              setForm((current) => ({
                ...current,
                companyId: e.target.value,
                divisionId: '',
                branchId: '',
                lines: [BLANK_LINE()],
              }));
            }}
            placeholder="Select company"
            disabled={Boolean(workspace?.scope.companyId)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Division"
            value={form.divisionId}
            onChange={(e) => {
              setField('divisionId', e.target.value);
              setField('branchId', '');
            }}
            placeholder={form.companyId ? 'All divisions' : 'Select company first'}
            disabled={!form.companyId || Boolean(workspace?.scope.divisionId)}
          >
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.code ? `${division.code} - ` : ''}
                {division.name}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Branch / Location"
            required
            value={form.branchId}
            onChange={(e) => {
              const branchId = e.target.value;
              const branch = branches.find((candidate) => candidate.id === branchId);
              setForm((current) => ({
                ...current,
                branchId,
                divisionId: current.divisionId || branch?.divisionId || '',
              }));
            }}
            placeholder={form.companyId ? 'Select branch/location' : 'Select company first'}
            disabled={!form.companyId || Boolean(workspace?.scope.branchId)}
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
              <caption className="sr-only">Stock adjustment line items</caption>
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th scope="col" className="px-3 py-2">Product</th>
                  <th scope="col" className="px-3 py-2">System Qty</th>
                  <th scope="col" className="px-3 py-2">Counted Qty</th>
                  <th scope="col" className="px-3 py-2">Variance</th>
                  <th scope="col" className="px-3 py-2">Unit</th>
                  <th scope="col" className="px-3 py-2">Unit Cost</th>
                  <th scope="col" className="px-3 py-2">Reason</th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
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
                      <td className="px-2 py-1 min-w-[200px]">
                        <ProductPicker
                          value={line.productId}
                          onChange={(pid, product) => {
                            const effectivePurchasePrice = Number(product?.effectivePurchasePrice ?? 0);
                            setLine(i, {
                              productId: pid,
                              unitId: product?.defaultUnitId ?? line.unitId,
                              unitCost:
                                Number.isFinite(effectivePurchasePrice) && effectivePurchasePrice > 0
                                  ? effectivePurchasePrice
                                  : line.unitCost,
                            });
                            void prefillSystemQty(i, pid);
                          }}
                          companyId={form.companyId}
                          placeholder="Search product…"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          aria-label={`System quantity, line ${i + 1}`}
                          value={line.systemQty}
                          onChange={(e) => setLine(i, { systemQty: Number(e.target.value) })}
                          readOnly={line.systemQtyLocked}
                          title={
                            line.systemQtyLocked
                              ? 'Prefilled from live stock on hand at this branch'
                              : undefined
                          }
                          className={`w-24 text-xs border rounded px-2 py-1 ${
                            line.systemQtyLocked ? 'opacity-70 cursor-not-allowed' : ''
                          }`}
                          style={{
                            borderColor: 'var(--aurora-border)',
                            background: line.systemQtyLocked
                              ? 'var(--aurora-bg-subtle)'
                              : 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          aria-label={`Counted quantity, line ${i + 1}`}
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
                          aria-label={`Unit, line ${i + 1}`}
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
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`Unit cost, line ${i + 1}`}
                          value={line.unitCost}
                          onChange={(e) =>
                            setLine(i, {
                              unitCost: e.target.value === '' ? '' : Number(e.target.value),
                            })
                          }
                          className="w-28 text-xs border rounded px-2 py-1"
                          style={{
                            borderColor: variance > 0 && !line.unitCost
                              ? 'var(--aurora-danger, #ef4444)'
                              : 'var(--aurora-border)',
                            background: 'var(--aurora-card)',
                            color: 'var(--aurora-text)',
                          }}
                          placeholder={variance > 0 ? 'Required' : 'N/A'}
                          disabled={variance <= 0}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          aria-label={`Reason, line ${i + 1}`}
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
                          <Btn
                            variant="ghost"
                            size="xs"
                            aria-label={`Remove line ${i + 1}`}
                            onClick={() => removeLine(i)}
                          >
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
  const workspace = useInventoryWorkspace();
  const workspaceScope = workspace?.scope;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<StockAdjustment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StockAdjustment | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdjustmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const canView = hasPermission('inventory.view');
  const canCreate = hasPermission('inventory.adjustments.create');
  const canApprove = hasPermission('inventory.adjustments.approve');
  const canPost = hasPermission('inventory.adjustments.post');

  useEffect(() => {
    if (!workspaceScope) return;
    setCompanyId(workspaceScope.companyId);
    setPage(1);
  }, [workspaceScope]);

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

  // Detail drawer: fetch the full adjustment (lines + approval trail) on open.
  useEffect(() => {
    if (!viewingId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    backendGet<AdjustmentDetail>(`/stock-adjustments/${viewingId}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewingId]);

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
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
        }),
      );
    } catch (err: unknown) {
      setData(emptyPaginated<StockAdjustment>());
      setLoadError(err instanceof Error ? err.message : 'Failed to load stock adjustments');
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const exportColumns = ['Number', 'Company', 'Branch', 'Reason', 'Lines', 'Status', 'Created'];
  const buildExportRows = () =>
    (data?.data ?? []).map((a) => ({
      Number: a.adjustmentNumber ?? a.id,
      Company: a.company?.name ?? '',
      Branch: a.branch?.name ?? a.location?.name ?? '',
      Reason: a.reason ?? '',
      Lines: a._count?.lines ?? a.lines?.length ?? 0,
      Status: a.status,
      Created: a.createdAt,
    }));

  const exportCsv = () => {
    const rows = buildExportRows();
    if (!rows.length) return;
    const csv = rowsToCsv(rows, exportColumns);
    downloadTextFile(
      `stock-adjustments-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
      csv,
    );
  };

  const exportPdf = async () => {
    const rows = buildExportRows();
    if (!rows.length) return;
    setExportingPdf(true);
    setActionError('');
    try {
      const filters = [
        companyId ? companies.find((c) => c.id === companyId)?.name : '',
        status,
        dateFrom ? `From ${dateFrom}` : '',
        dateTo ? `To ${dateTo}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      await downloadTablePdf({
        title: 'Stock Adjustments',
        subtitle: filters || undefined,
        companyId: companyId || undefined,
        columns: exportColumns,
        rows: rows.map((r) => exportColumns.map((c) => cellToString(r[c as keyof typeof r]))),
        numericColumns: [4],
        baseName: 'stock-adjustments',
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to export PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const doAction = async (id: string, action: 'submit' | 'approve' | 'post' | 'revert') => {
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

      <DetailDrawer
        open={Boolean(viewingId)}
        title={detail?.adjustmentNumber ? `Adjustment ${detail.adjustmentNumber}` : 'Stock Adjustment'}
        subtitle={detail?.company?.name ?? undefined}
        width="lg"
        onClose={() => setViewingId(null)}
      >
        {detailLoading || !detail ? (
          <PageSpinner />
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <div className="text-xs uppercase text-slate-400">Status</div>
                <div className="mt-1">
                  <StatusBadge value={detail.status} />
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-400">Branch / Location</div>
                <div className="mt-1">{detail.branch?.name ?? '—'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs uppercase text-slate-400">Reason</div>
                <div className="mt-1">{detail.reason || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-400">Created by</div>
                <div className="mt-1">{detail.createdBy?.fullName ?? '—'}</div>
              </div>
              {detail.approvedBy && (
                <div>
                  <div className="text-xs uppercase text-slate-400">Approved by</div>
                  <div className="mt-1">{detail.approvedBy.fullName}</div>
                </div>
              )}
              {detail.postedBy && (
                <div>
                  <div className="text-xs uppercase text-slate-400">Posted by</div>
                  <div className="mt-1">{detail.postedBy.fullName}</div>
                </div>
              )}
            </div>

            {detail.notes && (
              <div>
                <div className="text-xs uppercase text-slate-400">Notes</div>
                <div className="mt-1 whitespace-pre-wrap">{detail.notes}</div>
              </div>
            )}

            <div>
              <div className="text-xs uppercase text-slate-400 mb-2">Lines</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">Adjustment line items</caption>
                  <thead>
                    <tr className="text-left text-slate-400 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
                      <th scope="col" className="py-1.5 pr-2">Product</th>
                      <th scope="col" className="py-1.5 px-2 text-right">System</th>
                      <th scope="col" className="py-1.5 px-2 text-right">Counted</th>
                      <th scope="col" className="py-1.5 px-2 text-right">Variance</th>
                      <th scope="col" className="py-1.5 px-2 text-right">Unit Cost</th>
                      <th scope="col" className="py-1.5 px-2">Unit</th>
                      <th scope="col" className="py-1.5 pl-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
                    {(detail.lines ?? []).map((l) => {
                      const variance = Number(l.varianceQuantity ?? 0);
                      const fmt = (x: number | string) =>
                        Number(x ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
                      return (
                        <tr key={l.id}>
                          <td className="py-1.5 pr-2">
                            {l.product?.name ?? l.productId}
                            {l.product?.sku ? (
                              <span className="text-slate-400"> ({l.product.sku})</span>
                            ) : null}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(l.systemQuantity)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(l.countedQuantity)}</td>
                          <td
                            className={`py-1.5 px-2 text-right tabular-nums ${
                              variance < 0 ? 'text-red-600' : variance > 0 ? 'text-emerald-600' : ''
                            }`}
                          >
                            {variance > 0 ? '+' : ''}
                            {fmt(l.varianceQuantity)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums">
                            {l.unitCost ? `TZS ${fmt(l.unitCost)}` : '—'}
                          </td>
                          <td className="py-1.5 px-2">{l.unit?.symbol ?? l.unit?.name ?? '—'}</td>
                          <td className="py-1.5 pl-2">{l.reason ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      <PageHeader title="Stock Adjustments" subtitle="Reconcile inventory counts and corrections" />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
              aria-label="Filter by company"
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
              aria-label="Filter by status"
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
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              title="From date"
              aria-label="From date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              title="To date"
              aria-label="To date"
            />
          </>
        }
        actions={
          <>
            <Btn
              variant="secondary"
              onClick={exportCsv}
              disabled={!data?.data.length}
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              onClick={exportPdf}
              disabled={!data?.data.length || exportingPdf}
            >
              {exportingPdf ? 'Exporting…' : 'Export PDF'}
            </Btn>
            {canCreate ? (
              <Btn
                variant="primary"
                onClick={() => setCreating(true)}
                title={
                  workspace && (!workspace.scope.companyId || !workspace.scope.branchId)
                    ? 'Choose the company and branch in the adjustment form'
                    : undefined
                }
              >
                + New Adjustment
              </Btn>
            ) : null}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <caption className="sr-only">Stock adjustments</caption>
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th scope="col" className="px-4 py-3">Number</th>
                <th scope="col" className="px-4 py-3">Company</th>
                <th scope="col" className="px-4 py-3">Branch / Location</th>
                <th scope="col" className="px-4 py-3">Reason</th>
                <th scope="col" className="px-4 py-3">Lines</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-3">
                    <SkeletonTable rows={6} cols={7} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title="No adjustments"
                      description="No stock adjustments match the current filters."
                    />
                  </td>
                </tr>
              ) : (
                data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <button
                        type="button"
                        onClick={() => setViewingId(a.id)}
                        className="text-blue-600 hover:underline"
                        title="View adjustment details"
                      >
                        {a.adjustmentNumber ?? a.id.slice(0, 8)}
                      </button>
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
                      {a.status === 'APPROVED' && (
                        <>
                          {canPost && (
                            <Btn
                              variant="primary"
                              size="xs"
                              loading={actionLoading === `${a.id}:post`}
                              onClick={() => doAction(a.id, 'post')}
                            >
                              Post
                            </Btn>
                          )}
                          {canApprove && (
                            <Btn
                              variant="secondary"
                              size="xs"
                              loading={actionLoading === `${a.id}:revert`}
                              onClick={() => doAction(a.id, 'revert')}
                            >
                              Revert
                            </Btn>
                          )}
                        </>
                      )}
                      {a.status === 'POSTED' && (
                        <Link
                          href={`/inventory?tab=stock&view=movements&companyId=${encodeURIComponent(a.companyId)}&referenceType=StockAdjustment&referenceId=${encodeURIComponent(a.id)}`}
                          className="text-xs text-blue-600 hover:underline"
                          title="View the stock movements this adjustment posted"
                        >
                          Movements
                        </Link>
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
