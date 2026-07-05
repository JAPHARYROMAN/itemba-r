'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  DateInput,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageToolbar,
  StatCard,
  showToast,
} from '@/components/ui';
import {
  ResponsiveDataTable,
  StatusBadge,
  type ResponsiveColumn,
} from '@/components/aurora/data-display';
import type { StatusVariant } from '@/lib/design-system/status';
import { useAuth } from '@/hooks/use-auth';
import {
  backendGet,
  backendList,
  backendPost,
  backendPut,
} from '@/lib/api-client';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

// ── Types ───────────────────────────────────────────────────────────────────

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

interface Supplier {
  id: string;
  name: string;
  supplierCode?: string | null;
  status?: string | null;
}

interface RFQSupplier {
  id: string;
  supplierId: string;
  responseStatus?: string | null;
  sentAt?: string | null;
}

interface RFQ {
  id: string;
  rfqNumber: string;
  companyId: string;
  purchaseRequisitionId?: string | null;
  title: string;
  description?: string | null;
  status: string;
  rfqDate?: string | null;
  closingDate?: string | null;
  awardedSupplierId?: string | null;
  awardedAt?: string | null;
  notes?: string | null;
  createdById?: string | null;
  createdAt?: string | null;
  rfqSuppliers?: RFQSupplier[];
}

interface RFQListResponse {
  items?: RFQ[];
  data?: RFQ[];
  total?: number;
  page?: number;
  limit?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const RFQ_STATUSES = [
  'DRAFT',
  'SENT',
  'RESPONSES_RECEIVED',
  'EVALUATED',
  'AWARDED',
  'CANCELLED',
] as const;

const PAGE_LIMIT = 20;

const EXPORT_HEADERS = [
  'RFQ #',
  'Title',
  'Description',
  'Company',
  'Suppliers',
  'Status',
  'RFQ Date',
  'Closing Date',
  'Created By',
];

// Status → StatusBadge variant. Left unspecified statuses fall through to the
// design-system default resolver.
const STATUS_VARIANT: Partial<Record<(typeof RFQ_STATUSES)[number], StatusVariant>> = {
  DRAFT: 'muted',
  SENT: 'info',
  RESPONSES_RECEIVED: 'warning',
  EVALUATED: 'primary',
  AWARDED: 'success',
  CANCELLED: 'danger',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function normalizeList(payload: RFQListResponse | RFQ[] | null | undefined): {
  rows: RFQ[];
  total: number;
} {
  if (Array.isArray(payload)) return { rows: payload, total: payload.length };
  const rows = Array.isArray(payload?.items)
    ? payload!.items!
    : Array.isArray(payload?.data)
      ? payload!.data!
      : [];
  return { rows, total: Number(payload?.total ?? rows.length) };
}

// ── Create modal ──────────────────────────────────────────────────────────────

interface CreateForm {
  companyId: string;
  title: string;
  description: string;
  rfqDate: string;
  closingDate: string;
  notes: string;
  supplierIds: string[];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// The backend server-generates a company-scoped, race-safe rfqNumber
// (RFQ-{YYYY}-00001) via EntityCodeGeneratorService, so the client no longer
// mints one — the server owns numbering.

function CreateRfqModal({
  companies,
  onClose,
  onSaved,
}: {
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateForm>({
    companyId: companies.length === 1 ? companies[0].id : '',
    title: '',
    description: '',
    rfqDate: todayIso(),
    closingDate: '',
    notes: '',
    supplierIds: [],
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!form.companyId) {
      setSuppliers([]);
      return;
    }
    let cancelled = false;
    backendList<Supplier>('/suppliers', {
      query: { companyId: form.companyId, status: 'ACTIVE', limit: 500 },
    })
      .then((rows) => {
        if (!cancelled) setSuppliers(rows);
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const toggleSupplier = (id: string) =>
    setForm((current) => ({
      ...current,
      supplierIds: current.supplierIds.includes(id)
        ? current.supplierIds.filter((s) => s !== id)
        : [...current.supplierIds, id],
    }));

  const handleSubmit = async () => {
    if (!form.companyId) return setError('Company is required');
    if (!form.title.trim()) return setError('Title is required');

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        // rfqNumber is intentionally omitted — the backend server-generates it.
        companyId: form.companyId,
        title: form.title.trim(),
      };
      if (form.description.trim()) body.description = form.description.trim();
      if (form.rfqDate) body.rfqDate = new Date(form.rfqDate).toISOString();
      if (form.closingDate) body.closingDate = new Date(form.closingDate).toISOString();
      if (form.notes.trim()) body.notes = form.notes.trim();
      if (form.supplierIds.length) {
        body.rfqSuppliers = form.supplierIds.map((supplierId) => ({ supplierId }));
      }
      await backendPost('/rfqs', body);
      showToast('success', 'RFQ created', form.title.trim());
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create RFQ';
      setError(message);
      showToast('error', 'Could not create RFQ', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create RFQ"
      subtitle="Draft a new request for quotation and optionally invite suppliers"
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            Create RFQ
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(event) => setForm((c) => ({ ...c, companyId: event.target.value, supplierIds: [] }))}
          placeholder="Select company"
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
              {company.code ? ` (${company.code})` : ''}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Title"
          required
          value={form.title}
          onChange={(event) => set('title', event.target.value)}
          placeholder="e.g. Q3 Fuel Supply"
        />
        <DateInput
          label="RFQ Date"
          value={form.rfqDate}
          onChange={(event) => set('rfqDate', event.target.value)}
        />
        <DateInput
          label="Closing Date"
          value={form.closingDate}
          onChange={(event) => set('closingDate', event.target.value)}
        />
        <div className="md:col-span-2">
          <FormTextarea
            label="Description"
            rows={2}
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            Invite Suppliers{' '}
            <span style={{ color: 'var(--aurora-text-muted)' }}>
              ({form.supplierIds.length} selected)
            </span>
          </label>
          {!form.companyId ? (
            <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Select a company to load suppliers.
            </p>
          ) : suppliers.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              No active suppliers found for this company.
            </p>
          ) : (
            <div
              className="max-h-44 overflow-y-auto rounded-lg border p-2"
              style={{ borderColor: 'var(--aurora-border)' }}
            >
              {suppliers.map((supplier) => (
                <label
                  key={supplier.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--aurora-bg-subtle)]"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  <input
                    type="checkbox"
                    checked={form.supplierIds.includes(supplier.id)}
                    onChange={() => toggleSupplier(supplier.id)}
                  />
                  <span>{supplier.name}</span>
                  {supplier.supplierCode && (
                    <span className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {supplier.supplierCode}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="md:col-span-2">
          <FormTextarea
            label="Notes"
            rows={2}
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Invite suppliers modal (send) ─────────────────────────────────────────────

function InviteSuppliersModal({
  rfq,
  onClose,
  onSaved,
}: {
  rfq: RFQ;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<string[]>(
    (rfq.rfqSuppliers ?? []).map((s) => s.supplierId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    backendList<Supplier>('/suppliers', {
      query: { companyId: rfq.companyId, status: 'ACTIVE', limit: 500 },
    })
      .then((rows) => {
        if (!cancelled) setSuppliers(rows);
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rfq.companyId]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );

  const handleSend = async () => {
    if (selected.length === 0) return setError('Select at least one supplier');
    setSaving(true);
    setError('');
    try {
      // Backend: POST /rfqs/:id/send  { supplierIds: string[] } — flips DRAFT → SENT.
      await backendPost(`/rfqs/${rfq.id}/send`, { supplierIds: selected });
      showToast('success', 'RFQ sent to suppliers', rfq.rfqNumber);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send RFQ';
      setError(message);
      showToast('error', 'Could not send RFQ', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite Suppliers"
      subtitle={`Send ${rfq.rfqNumber} to selected suppliers`}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSend} loading={saving}>
            Send RFQ
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <p className="mb-2 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
        {selected.length} supplier{selected.length === 1 ? '' : 's'} selected
      </p>
      {suppliers.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          No active suppliers found for this company.
        </p>
      ) : (
        <div
          className="max-h-72 overflow-y-auto rounded-lg border p-2"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          {suppliers.map((supplier) => (
            <label
              key={supplier.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--aurora-bg-subtle)]"
              style={{ color: 'var(--aurora-text)' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(supplier.id)}
                onChange={() => toggle(supplier.id)}
              />
              <span>{supplier.name}</span>
              {supplier.supplierCode && (
                <span className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {supplier.supplierCode}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Cancel confirm ────────────────────────────────────────────────────────────

function CancelRfqModal({
  rfq,
  onClose,
  onConfirmed,
}: {
  rfq: RFQ;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCancel = async () => {
    setSaving(true);
    setError('');
    try {
      // Backend: PUT /rfqs/:id accepts a partial update; set status to CANCELLED.
      await backendPut(`/rfqs/${rfq.id}`, { status: 'CANCELLED' });
      showToast('success', 'RFQ cancelled', rfq.rfqNumber);
      onConfirmed();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel RFQ';
      setError(message);
      showToast('error', 'Could not cancel RFQ', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel RFQ"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Keep RFQ
          </Btn>
          <Btn variant="danger" onClick={handleCancel} loading={saving}>
            Cancel RFQ
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Are you sure you want to cancel <strong>{rfq.rfqNumber}</strong> — {rfq.title}?
      </p>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RFQsPage() {
  const { hasPermission } = useAuth();

  const canView = hasPermission('rfqs.list') || hasPermission('rfqs.view');
  const canCreate = hasPermission('rfqs.create');
  const canSend = hasPermission('rfqs.send');
  const canUpdate = hasPermission('rfqs.update');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [rows, setRows] = useState<RFQ[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState<RFQ | null>(null);
  const [cancelling, setCancelling] = useState<RFQ | null>(null);

  // Name-resolution maps (company/createdBy relations aren't included in the list payload).
  const companyName = useMemo(() => {
    const map = new Map<string, string>();
    companies.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [companies]);

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => map.set(u.id, u.fullName || u.email || u.id));
    return map;
  }, [users]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    Promise.allSettled([
      backendList<Company>('/companies', { query: { limit: 500 } }),
      backendList<UserRef>('/users', { query: { limit: 1000 } }),
    ]).then(([companyResult, userResult]) => {
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setUsers(userResult.status === 'fulfilled' ? userResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const payload = await backendGet<RFQListResponse | RFQ[]>('/rfqs', {
        query: {
          companyId: companyId || undefined,
          status: status || undefined,
          page,
          limit: PAGE_LIMIT,
        },
      });
      const { rows: fetched, total: fetchedTotal } = normalizeList(payload);
      setRows(fetched);
      setTotal(fetchedTotal);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load RFQs';
      setError(message);
      setRows([]);
      setTotal(0);
      showToast('error', 'Could not load RFQs', message);
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Client-side text search across the loaded page (backend has no search param).
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const haystack = [
        r.rfqNumber,
        r.title,
        r.description ?? '',
        companyName.get(r.companyId) ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, companyName]);

  // Summary metrics computed from the loaded page.
  const summary = useMemo(() => {
    const counts = {
      total,
      draft: 0,
      sent: 0,
      awarded: 0,
      responsesReceived: 0,
    };
    rows.forEach((r) => {
      if (r.status === 'DRAFT') counts.draft += 1;
      else if (r.status === 'SENT') counts.sent += 1;
      else if (r.status === 'AWARDED') counts.awarded += 1;
      else if (r.status === 'RESPONSES_RECEIVED') counts.responsesReceived += 1;
    });
    return counts;
  }, [rows, total]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const columns: ResponsiveColumn<RFQ & Record<string, unknown>>[] = useMemo(
    () => [
      {
        key: 'rfqNumber',
        header: 'RFQ #',
        priority: 1,
        accessor: (row) => (
          <span className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>
            {row.rfqNumber}
          </span>
        ),
      },
      {
        key: 'title',
        header: 'Title',
        priority: 1,
        accessor: (row) => (
          <div>
            <div className="font-medium" style={{ color: 'var(--aurora-text)' }}>
              {row.title}
            </div>
            {row.description && (
              <div className="truncate text-xs" style={{ color: 'var(--aurora-text-muted)', maxWidth: 260 }}>
                {row.description}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'company',
        header: 'Company',
        priority: 2,
        accessor: (row) => companyName.get(row.companyId) ?? 'Unknown company',
      },
      {
        key: 'suppliers',
        header: 'Suppliers',
        priority: 3,
        accessor: (row) => row.rfqSuppliers?.length ?? 0,
      },
      {
        key: 'status',
        header: 'Status',
        priority: 1,
        accessor: (row) => (
          <StatusBadge
            status={row.status}
            variant={STATUS_VARIANT[row.status as (typeof RFQ_STATUSES)[number]]}
          />
        ),
      },
      {
        key: 'rfqDate',
        header: 'RFQ Date',
        priority: 2,
        accessor: (row) => (
          <span style={{ color: 'var(--aurora-text-muted)' }}>{fmtDate(row.rfqDate)}</span>
        ),
      },
      {
        key: 'closingDate',
        header: 'Closing',
        priority: 3,
        accessor: (row) => (
          <span style={{ color: 'var(--aurora-text-muted)' }}>{fmtDate(row.closingDate)}</span>
        ),
      },
      {
        key: 'createdBy',
        header: 'Created By',
        priority: 3,
        accessor: (row) =>
          row.createdById ? userName.get(row.createdById) ?? 'Unknown user' : '—',
      },
      {
        key: 'actions',
        header: '',
        priority: 1,
        exportExclude: true,
        accessor: (row) => {
          const canInvite = canSend && row.status === 'DRAFT';
          const canCancel = canUpdate && row.status !== 'CANCELLED' && row.status !== 'AWARDED';
          if (!canInvite && !canCancel) return null;
          return (
            <div className="flex flex-wrap justify-end gap-2">
              {canInvite && (
                <Btn
                  variant="secondary"
                  size="xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    setInviting(row);
                  }}
                >
                  Invite Suppliers
                </Btn>
              )}
              {canCancel && (
                <Btn
                  variant="danger"
                  size="xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCancelling(row);
                  }}
                >
                  Cancel
                </Btn>
              )}
            </div>
          );
        },
      },
    ],
    [companyName, userName, canSend, canUpdate],
  );

  const buildExportRecords = useCallback(
    (exportRows: RFQ[]): Record<string, unknown>[] =>
      exportRows.map((r) => ({
        'RFQ #': r.rfqNumber,
        Title: r.title,
        Description: r.description ?? '',
        Company: companyName.get(r.companyId) ?? r.companyId,
        Suppliers: r.rfqSuppliers?.length ?? 0,
        Status: humanize(r.status),
        'RFQ Date': fmtDate(r.rfqDate),
        'Closing Date': fmtDate(r.closingDate),
        'Created By': r.createdById ? userName.get(r.createdById) ?? r.createdById : '',
      })),
    [companyName, userName],
  );

  const handleExport = useCallback(
    (exportRows: RFQ[]) => {
      const csv = rowsToCsv(buildExportRecords(exportRows), EXPORT_HEADERS);
      if (!csv) {
        showToast('info', 'Nothing to export', 'No RFQs match the current filters.');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`rfqs-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
    },
    [buildExportRecords],
  );

  const handleExportPdf = useCallback(
    async (exportRows: RFQ[]) => {
      const records = buildExportRecords(exportRows);
      if (!records.length) {
        showToast('info', 'Nothing to export', 'No RFQs match the current filters.');
        return;
      }
      try {
        await downloadTablePdf({
          title: 'Requests for Quotation',
          subtitle: [
            companyId ? companyName.get(companyId) ?? 'Selected company' : 'All companies',
            status ? humanize(status) : 'All statuses',
          ].join(' · '),
          companyId: companyId || undefined,
          columns: EXPORT_HEADERS,
          rows: records.map((rec) => EXPORT_HEADERS.map((h) => cellToString(rec[h]))),
          numericColumns: [4],
          baseName: 'rfqs',
        });
      } catch (err) {
        showToast(
          'error',
          'Could not export PDF',
          err instanceof Error ? err.message : 'Please try again.',
        );
      }
    },
    [buildExportRecords, companyId, companyName, status],
  );

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader
          title="Requests for Quotation"
          subtitle="Manage RFQs sent to suppliers"
        />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted. You do not have permission to view RFQs.
        </p>
      </div>
    );
  }

  const filterSelectCls =
    'rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="space-y-6 p-6">
      {creating && (
        <CreateRfqModal
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {inviting && (
        <InviteSuppliersModal
          rfq={inviting}
          onClose={() => setInviting(null)}
          onSaved={() => {
            setInviting(null);
            load();
          }}
        />
      )}
      {cancelling && (
        <CancelRfqModal
          rfq={cancelling}
          onClose={() => setCancelling(null)}
          onConfirmed={() => {
            setCancelling(null);
            load();
          }}
        />
      )}

      <PageHeader
        title="Requests for Quotation"
        subtitle="Draft, send, and track RFQs across suppliers"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total RFQs" value={summary.total} />
        <StatCard label="Draft" value={summary.draft} />
        <StatCard label="Sent" value={summary.sent} />
        <StatCard label="Responses In" value={summary.responsesReceived} />
        <StatCard label="Awarded" value={summary.awarded} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(value) => setSearch(value)}
        searchPlaceholder="Search RFQ #, title, description, company..."
        filters={
          <>
            <select
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
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Statuses</option>
              {RFQ_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {humanize(item)}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          canCreate && (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New RFQ
            </Btn>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <ResponsiveDataTable<RFQ & Record<string, unknown>>
          columns={columns}
          data={visibleRows as (RFQ & Record<string, unknown>)[]}
          keyField="id"
          loading={loading}
          error={error || undefined}
          onRetry={load}
          errorTitle="Could not load RFQs"
          emptyTitle="No RFQs found"
          emptyDescription="Create a request for quotation or adjust your filters."
          exportable
          onExport={(exportRows) => handleExport(exportRows as RFQ[])}
          exportPdf
          onExportPdf={(exportRows) => handleExportPdf(exportRows as RFQ[])}
          exportFileName="rfqs"
        />
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Btn
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Btn>
            <Btn
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
