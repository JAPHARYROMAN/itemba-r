'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface Obligation {
  id: string;
  obligationCode: string;
  companyId: string;
  company?: { name: string };
  obligationType: string;
  title: string;
  description?: string | null;
  dueDate: string;
  recurrence: string;
  priority: string;
  responsibleUserId?: string | null;
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const TYPES = ['TAX_FILING', 'REGULATORY_REPORT', 'LICENSE_RENEWAL', 'AUDIT_PREPARATION', 'DOCUMENT_SUBMISSION', 'OTHER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface ObForm {
  obligationCode: string; title: string; companyId: string; obligationType: string;
  priority: string; dueDate: string; recurrence: string; status: string;
  responsibleUserId: string; description: string; notes: string;
}
const BLANK: ObForm = { obligationCode: '', title: '', companyId: '', obligationType: 'OTHER', priority: 'MEDIUM', dueDate: '', recurrence: 'NONE', status: 'OPEN', responsibleUserId: '', description: '', notes: '' };

function ObModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: Obligation; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ObForm>(() => initial ? {
    obligationCode: initial.obligationCode, title: initial.title, companyId: initial.companyId,
    obligationType: initial.obligationType, priority: initial.priority,
    dueDate: initial.dueDate?.split('T')[0] ?? '',
    recurrence: initial.recurrence, status: initial.status,
    responsibleUserId: initial.responsibleUserId ?? '',
    description: initial.description ?? '', notes: initial.notes ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof ObForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.obligationCode.trim() || !form.title.trim() || !form.companyId) { setError('Code, title, company required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        obligationCode: form.obligationCode, title: form.title, companyId: form.companyId,
        obligationType: form.obligationType, priority: form.priority, recurrence: form.recurrence, status: form.status,
        dueDate: form.dueDate || undefined,
        responsibleUserId: form.responsibleUserId || undefined,
        description: form.description || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/compliance/obligations' : `/api/backend/compliance/obligations/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Obligation' : 'Edit Obligation'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.obligationCode} onChange={(e) => set('obligationCode', e.target.value)} />
        <FormInput label="Title" required value={form.title} onChange={(e) => set('title', e.target.value)} />
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Type" value={form.obligationType} onChange={(e) => set('obligationType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Priority" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </FormSelect>
        <FormInput label="Due Date" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        <FormSelect label="Recurrence" value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
          {RECURRENCES.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <div className="col-span-2"><FormInput label="Responsible User Id" value={form.responsibleUserId} onChange={(e) => set('responsibleUserId', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function ObligationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('compliance_obligations.manage');
  const canView = hasPermission('compliance_obligations.view') || canManage;

  const [items, setItems] = useState<Obligation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [obligationType, setObligationType] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Obligation | null>(null);
  const [deleting, setDeleting] = useState<Obligation | null>(null);
  const [actingId, setActingId] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (obligationType) params.set('obligationType', obligationType);
    if (priority) params.set('priority', priority);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/compliance/obligations?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<Obligation> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, obligationType, priority, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/compliance/obligations/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };
  const doComplete = async (id: string) => {
    setActingId(id);
    await fetch(`/api/backend/compliance/obligations/${id}/complete`, { method: 'PATCH' });
    setActingId(''); load();
  };

  const openCount = items.filter((o) => o.status === 'OPEN' || o.status === 'IN_PROGRESS').length;
  const overdueCount = items.filter((o) => o.status === 'OVERDUE').length;
  const criticalCount = items.filter((o) => o.priority === 'CRITICAL').length;

  if (!canView) return <div className="p-6"><PageHeader title="Obligations" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Obligations" subtitle="Statutory deadlines and recurring filings" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Open (page)" value={openCount} />
        <StatCard label="Overdue (page)" value={overdueCount} />
        <StatCard label="Critical (page)" value={criticalCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={obligationType} onChange={(e) => reset(setObligationType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={priority} onChange={(e) => reset(setPriority)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Obligation</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No obligations</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-t" style={{ borderColor: 'var(--aurora-border)', background: o.status === 'OVERDUE' ? 'rgba(239,68,68,0.06)' : undefined }}>
                    <td className="px-4 py-3 font-mono text-xs">{o.obligationCode}</td>
                    <td className="px-4 py-3">{o.title}</td>
                    <td className="px-4 py-3 text-xs">{o.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{o.obligationType}</td>
                    <td className="px-4 py-3 text-xs">{o.dueDate?.split('T')[0]}</td>
                    <td className="px-4 py-3"><StatusBadge status={o.priority} /></td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && <Btn variant="success" size="xs" loading={actingId === o.id} onClick={() => doComplete(o.id)}>Complete</Btn>}
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(o)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(o)}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {page} of {totalPages} ({total} total)</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>

      {creating && <ObModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <ObModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Obligation" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete <strong>{deleting.title}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
