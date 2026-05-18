'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Btn, Card, ConfirmDialog, FormInput, FormSelect, FormTextarea, Modal, PageHeader, PageSpinner, StatusBadge } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const fmtCurrency = (n: number | string | null | undefined) =>
  `TZS ${new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(Number(n ?? 0)) ? Number(n ?? 0) : 0)}`;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

interface Project { id: string; projectName: string; projectCode: string; divisionId?: string; customerId?: string | null }

interface Billing {
  id: string;
  billingNumber: string;
  projectId: string;
  customerId?: string | null;
  billingDate: string;
  description: string;
  amount: number | string;
  currency: string;
  status: string;
  salesOrderId?: string | null;
  receivableId?: string | null;
  project?: { projectName: string; projectCode: string };
  customer?: { id: string; name: string } | null;
  salesOrder?: { id: string; salesOrderNumber: string; status: string; paymentStatus: string } | null;
  receivable?: { id: string; receivableNumber: string; outstandingAmount: number | string; status: string; dueDate?: string | null } | null;
}

interface FormState {
  projectId: string;
  divisionId: string;
  customerId: string;
  billingDate: string;
  description: string;
  amount: string;
  currency: string;
}

const blankForm = (): FormState => ({
  projectId: '', divisionId: '', customerId: '', billingDate: new Date().toISOString().slice(0, 10),
  description: '', amount: '', currency: 'TZS',
});

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function BillingPage() {
  const [companyId, setCompanyId] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<{ data: Billing[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Billing | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { companyOptions } = useOrgScope(companyId, { skipBranches: true, skipDivisions: true, skipEmployees: true });

  useEffect(() => {
    if (!companyId) { setProjects([]); return; }
    fetch(`/api/backend/construction/projects?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setProjects(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []),
    );
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) { setData({ data: [], total: 0 }); return; }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (projectFilter) params.set('projectId', projectFilter);
      const res = await fetch(`/api/backend/construction/billing?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      const payload = json.data?.data ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 };
      setData(payload);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, projectFilter]);

  useEffect(() => { void load(); }, [load]);

  async function handleAction(billingId: string, endpoint: 'send' | 'approve' | 'paid' | 'cancel') {
    setActionLoading(`${billingId}-${endpoint}`); setError('');
    try {
      const res = await fetch(`/api/backend/construction/billing/${billingId}/${endpoint}`, { method: 'PATCH' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `HTTP ${res.status}`));
      }
      await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Action failed'); }
    finally { setActionLoading(null); }
  }

  const openNew = () => { setEditing(null); setForm(blankForm()); setError(''); setShowModal(true); };

  const openEdit = (b: Billing) => {
    setEditing(b);
    const proj = projects.find(p => p.id === b.projectId);
    setForm({
      projectId: b.projectId,
      divisionId: proj?.divisionId ?? '',
      customerId: b.customerId ?? '',
      billingDate: b.billingDate?.slice(0, 10) ?? '',
      description: b.description ?? '',
      amount: b.amount != null ? String(b.amount) : '',
      currency: b.currency ?? 'TZS',
    });
    setError(''); setShowModal(true);
  };

  async function handleSave() {
    setSaving(true); setError('');
    try {
      if (!form.projectId) throw new Error('Project is required');
      if (!form.amount || Number(form.amount) <= 0) throw new Error('Amount must be greater than zero');
      if (!form.description.trim()) throw new Error('Description is required');
      const proj = projects.find(p => p.id === form.projectId);
      const body: Record<string, unknown> = {
        companyId,
        divisionId: form.divisionId || proj?.divisionId,
        projectId: form.projectId,
        billingDate: form.billingDate || new Date().toISOString().slice(0, 10),
        description: form.description.trim(),
        amount: Number(form.amount),
        currency: form.currency || 'TZS',
      };
      if (form.customerId) body.customerId = form.customerId;
      const url = editing ? `/api/backend/construction/billing/${editing.id}` : '/api/backend/construction/billing';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? 'Save failed'));
      }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/backend/construction/billing/${deleteTarget}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteTarget(null);
    }
  }

  const sf = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const totalBilled = data.data.reduce((s, b) => s + Number(b.amount ?? 0), 0);
  const totalSettled = data.data.filter(b => !!b.salesOrderId).length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Project Billing" subtitle="Project billing → SalesOrder → Receivable. Approving a billing books revenue automatically." />
        <div className="flex gap-2 flex-wrap items-center">
          <div className="w-56">
            <FormSelect value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectFilter(''); }} options={companyOptions} placeholder="Pick company" />
          </div>
          {companyId && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-sm border rounded-md px-3 py-2"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
            >
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Billing</Btn>}
        </div>
      </div>

      {!companyId && <Card className="p-8 text-center text-sm text-slate-400">Pick a company to load billings.</Card>}
      {error && <Card className="p-3 bg-red-50 border-red-200 text-red-700 text-sm">{error}</Card>}
      {companyId && loading && <PageSpinner />}

      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
            <span className="text-xs text-slate-500">{data.total} billing record{data.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-4 text-xs">
              <span><span className="text-slate-500">Total billed: </span><span className="font-semibold tabular-nums">{fmtCurrency(totalBilled)}</span></span>
              <span><span className="text-slate-500">Settled: </span><span className="font-semibold tabular-nums">{totalSettled} / {data.total}</span></span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Project</th>
                  <th className={thCls}>Date</th>
                  <th className={thCls + ' text-right'}>Amount</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Sales Order</th>
                  <th className={thCls}>Receivable</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {data.data.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No billing records found.</td></tr>
                ) : data.data.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-xs`}>{b.billingNumber}</td>
                    <td className={tdCls}>
                      <div className="font-medium">{b.project?.projectName ?? '—'}</div>
                      <div className="text-[11px] font-mono text-slate-400">{b.project?.projectCode ?? ''}</div>
                    </td>
                    <td className={tdCls}>{fmtDate(b.billingDate)}</td>
                    <td className={`${tdCls} text-right tabular-nums font-medium`}>{fmtCurrency(b.amount)}</td>
                    <td className={tdCls}><StatusBadge status={b.status} /></td>
                    <td className={tdCls}>
                      {b.salesOrder ? (
                        <div>
                          <div className="font-mono text-xs">{b.salesOrder.salesOrderNumber}</div>
                          <div className="text-[11px] text-slate-500">{b.salesOrder.paymentStatus}</div>
                        </div>
                      ) : <span className="text-slate-400 italic text-xs">—</span>}
                    </td>
                    <td className={tdCls}>
                      {b.receivable ? (
                        <div>
                          <div className="font-mono text-xs">{b.receivable.receivableNumber}</div>
                          <div className="text-[11px] text-slate-500">
                            <span className="tabular-nums">{fmtCurrency(b.receivable.outstandingAmount)}</span> outstanding
                            {b.receivable.dueDate && ` · due ${fmtDate(b.receivable.dueDate)}`}
                          </div>
                        </div>
                      ) : <span className="text-slate-400 italic text-xs">—</span>}
                    </td>
                    <td className={tdCls}>
                      <div className="flex gap-1 flex-wrap">
                        {b.status === 'DRAFT' && (
                          <Btn size="xs" variant="primary" onClick={() => handleAction(b.id, 'send')} loading={actionLoading === `${b.id}-send`}>Send</Btn>
                        )}
                        {b.status === 'SENT' && (
                          <Btn size="xs" variant="success" onClick={() => handleAction(b.id, 'approve')} loading={actionLoading === `${b.id}-approve`}>Approve</Btn>
                        )}
                        {(b.status === 'APPROVED' || b.status === 'PARTIALLY_PAID') && (
                          <Btn size="xs" variant="success" onClick={() => handleAction(b.id, 'paid')} loading={actionLoading === `${b.id}-paid`}>Mark Paid</Btn>
                        )}
                        {['DRAFT', 'SENT'].includes(b.status) && (
                          <Btn size="xs" variant="secondary" onClick={() => openEdit(b)}>Edit</Btn>
                        )}
                        {b.status !== 'PAID' && b.status !== 'CANCELLED' && (
                          <Btn size="xs" variant="ghost" onClick={() => handleAction(b.id, 'cancel')} loading={actionLoading === `${b.id}-cancel`}>Cancel</Btn>
                        )}
                        {b.status === 'DRAFT' && (
                          <Btn size="xs" variant="danger" onClick={() => setDeleteTarget(b.id)}>Del</Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit billing' : 'New billing'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>{editing ? 'Save' : 'Create'}</Btn>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
          <FormSelect
            label="Project"
            required
            value={form.projectId}
            onChange={(e) => {
              const v = e.target.value;
              const proj = projects.find(p => p.id === v);
              setForm(p => ({ ...p, projectId: v, divisionId: proj?.divisionId ?? '', customerId: p.customerId || (proj?.customerId ?? '') }));
            }}
          >
            <option value="">— Select project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
          </FormSelect>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Billing date" required type="date" value={form.billingDate} onChange={sf('billingDate')} />
            <FormInput label="Amount (TZS)" required type="number" value={form.amount} onChange={sf('amount')} />
          </div>
          <FormTextarea label="Description" required value={form.description} onChange={sf('description')} rows={2} placeholder="What this billing covers (e.g. Phase 1 — foundation)." />
          <FormInput label="Currency" value={form.currency} onChange={sf('currency')} />
          <p className="text-xs text-slate-500">
            On <strong>Approve</strong>, the system creates a credit Sales Order against the project&apos;s customer and opens a Receivable automatically. Make sure the project has a customer assigned before approving.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete billing"
        message="Delete this billing record? Only DRAFT billings can be deleted."
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
