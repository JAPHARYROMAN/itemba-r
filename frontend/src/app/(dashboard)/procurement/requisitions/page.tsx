'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  ConfirmDialog,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PermissionDeniedState,
  ProductPicker,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from '@/components/aurora/data-display/ResponsiveDataTable';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPost } from '@/lib/api-client';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface UserRef {
  id: string;
  fullName?: string | null;
  email?: string | null;
}

type RequisitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED_TO_RFQ'
  | 'CONVERTED_TO_PO'
  | 'CANCELLED';

type RequisitionPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

interface RequisitionLine {
  id?: string;
  productId?: string | null;
  description: string;
  quantity: number | string;
  unitId?: string | null;
  estimatedUnitCost?: number | string | null;
  estimatedTotalCost?: number | string | null;
  preferredSupplierId?: string | null;
}

interface PurchaseRequisition extends Record<string, unknown> {
  id: string;
  requisitionNumber: string;
  companyId: string;
  divisionId?: string | null;
  branchId?: string | null;
  requestedById: string;
  requestDate?: string | null;
  neededByDate?: string | null;
  purpose?: string | null;
  priority: RequisitionPriority;
  status: RequisitionStatus;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectedById?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  totalEstimatedAmount?: number | string | null;
  currency?: string | null;
  notes?: string | null;
  // Relations may or may not be present depending on the endpoint include.
  company?: { name?: string | null; code?: string | null } | null;
  requestedBy?: UserRef | null;
  lines?: RequisitionLine[];
}

interface ListEnvelope {
  items?: PurchaseRequisition[];
  data?: PurchaseRequisition[];
  total?: number;
  page?: number;
  limit?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUSES: RequisitionStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CONVERTED_TO_RFQ',
  'CONVERTED_TO_PO',
  'CANCELLED',
];

const PRIORITIES: RequisitionPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const PAGE_LIMIT = 20;
const today = new Date().toISOString().slice(0, 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

function toNumber(value: number | string | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(toNumber(value))}`;
}

function requisitionCode() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PR-${stamp}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

function emptyLine(): RequisitionLine {
  return { description: '', quantity: '1', estimatedUnitCost: '', productId: '' };
}

const PRIORITY_TONE: Record<RequisitionPriority, string> = {
  URGENT: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  NORMAL: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  LOW: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PurchaseRequisitionsPage() {
  const { user, hasPermission } = useAuth();
  const canView = hasPermission('purchase_requisitions.list');
  const canCreate = hasPermission('purchase_requisitions.create');
  const canUpdate = hasPermission('purchase_requisitions.update');
  const canApprove = hasPermission('purchase_requisitions.approve');
  const canReadUsers = hasPermission('users.read');

  const [rows, setRows] = useState<PurchaseRequisition[]>([]);
  const [total, setTotal] = useState(0);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    req: PurchaseRequisition;
    action: 'submit' | 'approve';
  } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PurchaseRequisition | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<{
    requisitionNumber: string;
    companyId: string;
    priority: RequisitionPriority;
    requestDate: string;
    neededByDate: string;
    purpose: string;
    notes: string;
    lines: RequisitionLine[];
  }>({
    requisitionNumber: '',
    companyId: '',
    priority: 'NORMAL',
    requestDate: today,
    neededByDate: '',
    purpose: '',
    notes: '',
    lines: [emptyLine()],
  });

  // ── Lookups ────────────────────────────────────────────────────────────────

  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    companies.forEach((company) => map.set(company.id, company.name));
    return map;
  }, [companies]);

  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => map.set(u.id, u.fullName || u.email || u.id));
    return map;
  }, [users]);

  const companyLabel = useCallback(
    (req: PurchaseRequisition) =>
      req.company?.name ?? companyNameById.get(req.companyId) ?? req.companyId,
    [companyNameById],
  );

  const requesterLabel = useCallback(
    (req: PurchaseRequisition) =>
      req.requestedBy?.fullName ??
      req.requestedBy?.email ??
      userNameById.get(req.requestedById) ??
      // Fall back to a short id so the table never shows a full raw UUID.
      `${req.requestedById.slice(0, 8)}…`,
    [userNameById],
  );

  // ── Reference data ───────────────────────────────────────────────────────────

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
    if (!canView || !canReadUsers) return;
    let cancelled = false;
    // Best-effort: only used to resolve requester UUIDs to names. Guarded by
    // permission and a silent catch so the page still works without it.
    backendList<UserRef>('/users')
      .then((items) => {
        if (!cancelled) setUsers(items);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, canReadUsers]);

  // ── Debounced search ─────────────────────────────────────────────────────────

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // ── Load list ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // The purchase-requisitions endpoint returns { items, total, page, limit }
      // (not the { data, total, ... } shape backendPage expects), so read it raw.
      const result = await backendGet<ListEnvelope | PurchaseRequisition[]>(
        '/purchase-requisitions',
        {
          query: {
            page,
            limit: PAGE_LIMIT,
            companyId: companyId || undefined,
            status: status || undefined,
          },
        },
      );
      const items = Array.isArray(result)
        ? result
        : (result.items ?? result.data ?? []);
      setRows(items);
      setTotal(
        Array.isArray(result) ? items.length : Number(result.total ?? items.length),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load purchase requisitions');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Client-side text filter (backend has no free-text search param) ──────────

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((req) => {
      const haystack = [
        req.requisitionNumber,
        req.purpose ?? '',
        companyLabel(req),
        requesterLabel(req),
        req.status,
        req.priority,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, companyLabel, requesterLabel]);

  // ── Stats (from the loaded page) ─────────────────────────────────────────────

  const stats = useMemo(() => {
    const open = rows.filter((r) => r.status === 'DRAFT' || r.status === 'SUBMITTED').length;
    const pending = rows.filter((r) => r.status === 'SUBMITTED').length;
    const approved = rows.filter((r) => r.status === 'APPROVED').length;
    const value = rows.reduce((sum, r) => sum + toNumber(r.totalEstimatedAmount), 0);
    return { open, pending, approved, value };
  }, [rows]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const runAction = useCallback(
    async (req: PurchaseRequisition, action: 'submit' | 'approve') => {
      setBusyId(req.id);
      try {
        await backendPost(`/purchase-requisitions/${req.id}/${action}`);
        showToast(
          'success',
          action === 'submit'
            ? `Requisition ${req.requisitionNumber} submitted for approval`
            : `Requisition ${req.requisitionNumber} approved`,
        );
        setConfirm(null);
        await load();
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Action failed');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const runReject = useCallback(async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setFormError('A rejection reason is required');
      return;
    }
    setBusyId(rejectTarget.id);
    try {
      await backendPost(`/purchase-requisitions/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      showToast('success', `Requisition ${rejectTarget.requisitionNumber} rejected`);
      setRejectTarget(null);
      setRejectReason('');
      setFormError('');
      await load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }, [rejectTarget, rejectReason, load]);

  // ── Create ───────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setForm({
      requisitionNumber: requisitionCode(),
      companyId: companyId || user?.companyId || '',
      priority: 'NORMAL',
      requestDate: today,
      neededByDate: '',
      purpose: '',
      notes: '',
      lines: [emptyLine()],
    });
    setFormError('');
    setCreating(true);
  };

  const updateLine = (index: number, patch: Partial<RequisitionLine>) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (index: number) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== index) : f.lines,
    }));

  const formTotal = useMemo(
    () =>
      form.lines.reduce(
        (sum, line) => sum + toNumber(line.quantity) * toNumber(line.estimatedUnitCost),
        0,
      ),
    [form.lines],
  );

  const saveRequisition = async () => {
    const validLines = form.lines.filter((line) => line.description.trim());
    if (!form.requisitionNumber.trim() || !form.companyId) {
      setFormError('Requisition number and company are required');
      return;
    }
    if (validLines.length === 0) {
      setFormError('Add at least one line with a description');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const body = {
        requisitionNumber: form.requisitionNumber.trim(),
        companyId: form.companyId,
        priority: form.priority,
        requestDate: form.requestDate || undefined,
        neededByDate: form.neededByDate || undefined,
        purpose: form.purpose.trim() || undefined,
        notes: form.notes.trim() || undefined,
        totalEstimatedAmount: formTotal,
        currency: 'TZS',
        lines: validLines.map((line) => {
          const qty = toNumber(line.quantity);
          const unitCost = toNumber(line.estimatedUnitCost);
          return {
            productId: line.productId || undefined,
            description: line.description.trim(),
            quantity: qty,
            estimatedUnitCost: line.estimatedUnitCost === '' ? undefined : unitCost,
            estimatedTotalCost: line.estimatedUnitCost === '' ? undefined : qty * unitCost,
          };
        }),
      };
      await backendPost('/purchase-requisitions', body);
      showToast('success', `Requisition ${form.requisitionNumber} created`);
      setCreating(false);
      setPage(1);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create requisition');
    } finally {
      setSaving(false);
    }
  };

  // ── CSV / PDF export ─────────────────────────────────────────────────────────

  const buildExportRows = useCallback(
    () =>
      visibleRows.map((req) => ({
        'Requisition #': req.requisitionNumber,
        Company: companyLabel(req),
        'Requested By': requesterLabel(req),
        Priority: req.priority,
        Status: req.status,
        'Estimated Amount': toNumber(req.totalEstimatedAmount),
        Currency: req.currency ?? 'TZS',
        'Request Date': formatDate(req.requestDate),
        'Needed By': formatDate(req.neededByDate),
        Purpose: req.purpose ?? '',
      })),
    [visibleRows, companyLabel, requesterLabel],
  );

  const exportCsv = () => {
    const csv = rowsToCsv(buildExportRows());
    if (!csv) {
      showToast('info', 'Nothing to export');
      return;
    }
    downloadTextFile(`purchase-requisitions-${today}.csv`, 'text/csv;charset=utf-8', csv);
  };

  const [exportingPdf, setExportingPdf] = useState(false);

  const exportPdf = async () => {
    const data = buildExportRows();
    if (!data.length) {
      showToast('info', 'Nothing to export');
      return;
    }
    const exportColumns = Object.keys(data[0]);
    setExportingPdf(true);
    try {
      await downloadTablePdf({
        title: 'Purchase Requisitions',
        subtitle:
          [
            companyId ? companyNameById.get(companyId) ?? companyId : 'All Companies',
            status ? status.replace(/_/g, ' ') : 'All Statuses',
          ].join(' · '),
        companyId: companyId || undefined,
        columns: exportColumns,
        rows: data.map((row) =>
          exportColumns.map((col) => cellToString(row[col as keyof typeof row])),
        ),
        numericColumns: [5],
        baseName: 'purchase-requisitions',
      });
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'PDF export failed');
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────────────

  const columns: ResponsiveColumn<PurchaseRequisition>[] = useMemo(
    () => [
      {
        key: 'requisitionNumber',
        header: 'Requisition #',
        priority: 1,
        accessor: (req) => <span className="font-mono text-xs">{req.requisitionNumber}</span>,
      },
      {
        key: 'company',
        header: 'Company',
        priority: 2,
        accessor: (req) => companyLabel(req),
      },
      {
        key: 'requestedBy',
        header: 'Requested By',
        priority: 3,
        accessor: (req) => requesterLabel(req),
      },
      {
        key: 'priority',
        header: 'Priority',
        priority: 2,
        accessor: (req) => (
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[req.priority] ?? PRIORITY_TONE.NORMAL}`}
          >
            {req.priority}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        priority: 1,
        accessor: (req) => <StatusBadge status={req.status} />,
      },
      {
        key: 'totalEstimatedAmount',
        header: 'Est. Amount',
        priority: 2,
        align: 'right',
        accessor: (req) => (
          <span className="font-mono">{formatMoney(req.totalEstimatedAmount, req.currency ?? 'TZS')}</span>
        ),
      },
      {
        key: 'requestDate',
        header: 'Request Date',
        priority: 3,
        accessor: (req) => (
          <span style={{ color: 'var(--aurora-text-muted)' }}>{formatDate(req.requestDate)}</span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        priority: 1,
        align: 'right',
        exportExclude: true,
        accessor: (req) => {
          const isBusy = busyId === req.id;
          const canSubmit = canUpdate && req.status === 'DRAFT';
          const canDecide = canApprove && req.status === 'SUBMITTED';
          if (!canSubmit && !canDecide) {
            return <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>;
          }
          return (
            <div className="flex justify-end gap-1">
              {canSubmit && (
                <Btn
                  variant="secondary"
                  size="xs"
                  loading={isBusy}
                  onClick={() => setConfirm({ req, action: 'submit' })}
                >
                  Submit
                </Btn>
              )}
              {canDecide && (
                <>
                  <Btn
                    variant="success"
                    size="xs"
                    loading={isBusy}
                    onClick={() => setConfirm({ req, action: 'approve' })}
                  >
                    Approve
                  </Btn>
                  <Btn
                    variant="danger"
                    size="xs"
                    disabled={isBusy}
                    onClick={() => {
                      setRejectTarget(req);
                      setRejectReason('');
                      setFormError('');
                    }}
                  >
                    Reject
                  </Btn>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [busyId, canApprove, canUpdate, companyLabel, requesterLabel],
  );

  // ── Access gate ──────────────────────────────────────────────────────────────

  if (!canView) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Purchase Requisitions"
          subtitle="Raise and track internal purchase requests before they become purchase orders"
        />
        <PermissionDeniedState description="You do not have permission to view purchase requisitions." />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Purchase Requisitions"
        subtitle="Raise and track internal purchase requests before they become purchase orders"
        actions={
          canCreate ? (
            <Btn onClick={openCreate}>New Requisition</Btn>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Requisitions" value={total} />
        <StatCard label="Open (Draft + Submitted)" value={stats.open} variant="blue" />
        <StatCard label="Pending Approval" value={stats.pending} variant="amber" />
        <StatCard label="Approved" value={stats.approved} variant="green" />
      </div>

      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
          Estimated Value (this page)
        </div>
        <div className="mt-1 text-xl font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {formatMoney(stats.value)}
        </div>
      </Card>

      <ResponsiveDataTable<PurchaseRequisition>
        columns={columns}
        data={visibleRows}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={() => void load()}
        errorTitle="Could not load requisitions"
        emptyTitle="No purchase requisitions"
        emptyDescription="Create a requisition to request goods or services for approval."
        searchable
        searchValue={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search number, purpose, company…"
        filters={
          <>
            <select
              aria-label="Filter by company"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setPage(1);
              }}
              className="aurora-input text-sm"
              style={{ height: '36px' }}
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.code ? `${company.code} — ${company.name}` : company.name}
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
              className="aurora-input text-sm"
              style={{ height: '36px' }}
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
          <>
            <Btn variant="secondary" onClick={exportCsv} disabled={visibleRows.length === 0}>
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => void exportPdf()}
              disabled={visibleRows.length === 0 || exportingPdf}
            >
              Export PDF
            </Btn>
          </>
        }
        pagination={{
          page,
          limit: PAGE_LIMIT,
          total,
          onPageChange: (next) => {
            if (next >= 1 && next <= totalPages) setPage(next);
          },
        }}
      />

      {/* Submit / Approve confirmation */}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'approve' ? 'Approve requisition' : 'Submit for approval'}
        message={
          confirm?.action === 'approve'
            ? `Approve requisition ${confirm?.req.requisitionNumber}? Only submitted requisitions can be approved.`
            : `Submit requisition ${confirm?.req.requisitionNumber} for approval? Draft edits are locked once submitted.`
        }
        confirmLabel={confirm?.action === 'approve' ? 'Approve' : 'Submit'}
        loading={confirm ? busyId === confirm.req.id : false}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runAction(confirm.req, confirm.action);
        }}
      />

      {/* Reject with reason */}
      {rejectTarget && (
        <Modal
          open
          title="Reject requisition"
          subtitle={rejectTarget.requisitionNumber}
          size="md"
          onClose={() => {
            setRejectTarget(null);
            setRejectReason('');
            setFormError('');
          }}
          footer={
            <>
              <Btn
                variant="secondary"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                  setFormError('');
                }}
              >
                Cancel
              </Btn>
              <Btn variant="danger" loading={busyId === rejectTarget.id} onClick={() => void runReject()}>
                Reject
              </Btn>
            </>
          }
        >
          <div className="space-y-3">
            <FormTextarea
              label="Rejection reason"
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this requisition is being rejected…"
              error={formError || undefined}
            />
          </div>
        </Modal>
      )}

      {/* Create requisition */}
      {creating && (
        <Modal
          open
          title="New Purchase Requisition"
          subtitle="Requisitions are created as DRAFT, then submitted for approval"
          size="3xl"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Btn>
              <Btn loading={saving} onClick={() => void saveRequisition()}>
                Create Requisition
              </Btn>
            </>
          }
        >
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <FormInput
                label="Requisition Number"
                required
                value={form.requisitionNumber}
                onChange={(e) => setForm((f) => ({ ...f, requisitionNumber: e.target.value }))}
              />
              <FormSelect
                label="Company"
                required
                value={form.companyId}
                onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                placeholder="Select company"
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.code ? `${company.code} — ${company.name}` : company.name}
                  </option>
                ))}
              </FormSelect>
              <FormSelect
                label="Priority"
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priority: e.target.value as RequisitionPriority }))
                }
              >
                {PRIORITIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </FormSelect>
              <FormInput
                label="Request Date"
                type="date"
                value={form.requestDate}
                onChange={(e) => setForm((f) => ({ ...f, requestDate: e.target.value }))}
              />
              <FormInput
                label="Needed By"
                type="date"
                value={form.neededByDate}
                onChange={(e) => setForm((f) => ({ ...f, neededByDate: e.target.value }))}
              />
              <FormInput
                label="Purpose"
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                placeholder="e.g. Office restock"
              />
            </div>

            {/* Line items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-secondary)' }}>
                  Line Items
                </span>
                <Btn variant="secondary" size="xs" onClick={addLine}>
                  Add Line
                </Btn>
              </div>
              <div className="space-y-3">
                {form.lines.map((line, index) => {
                  const lineTotal = toNumber(line.quantity) * toNumber(line.estimatedUnitCost);
                  return (
                    <div
                      key={index}
                      className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_90px_130px_120px_auto] md:items-end"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <div>
                        <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--aurora-text-secondary)' }}>
                          Description / Product
                        </label>
                        <ProductPicker
                          value={line.productId ?? ''}
                          companyId={form.companyId || undefined}
                          placeholder="Search product (optional)"
                          onChange={(productId, product) =>
                            updateLine(index, {
                              productId,
                              description:
                                product?.name && !line.description.trim()
                                  ? product.name
                                  : line.description,
                            })
                          }
                        />
                        <FormInput
                          className="mt-2"
                          value={line.description}
                          onChange={(e) => updateLine(index, { description: e.target.value })}
                          placeholder="Description (required)"
                        />
                      </div>
                      <FormInput
                        label="Qty"
                        type="number"
                        min="0"
                        value={String(line.quantity)}
                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                      />
                      <FormInput
                        label="Unit Cost"
                        type="number"
                        min="0"
                        value={line.estimatedUnitCost === null || line.estimatedUnitCost === undefined ? '' : String(line.estimatedUnitCost)}
                        onChange={(e) => updateLine(index, { estimatedUnitCost: e.target.value })}
                      />
                      <div>
                        <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--aurora-text-secondary)' }}>
                          Line Total
                        </label>
                        <div className="px-3 py-2 text-[13px] font-mono rounded-lg" style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text)' }}>
                          {formatMoney(lineTotal)}
                        </div>
                      </div>
                      <Btn
                        variant="ghost"
                        size="xs"
                        disabled={form.lines.length <= 1}
                        onClick={() => removeLine(index)}
                        aria-label="Remove line"
                      >
                        Remove
                      </Btn>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-end text-sm">
                <span style={{ color: 'var(--aurora-text-muted)' }}>Estimated Total:&nbsp;</span>
                <span className="font-semibold font-mono">{formatMoney(formTotal)}</span>
              </div>
            </div>

            <FormTextarea
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {formError}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
