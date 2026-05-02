'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface DocRequirement {
  id: string;
  requirementCode: string;
  requirementType: string;
  title: string;
  description?: string | null;
  required: boolean;
  expiryRequired: boolean;
  renewalRequired: boolean;
  renewalPeriodDays?: number | null;
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const TYPES = ['BUSINESS_LICENSE', 'TAX_CLEARANCE', 'AUDIT_REPORT', 'INSURANCE', 'REGULATORY_CERTIFICATE', 'OTHER'];
const STATUSES = ['ACTIVE', 'INACTIVE'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface ReqForm {
  requirementCode: string; title: string; requirementType: string; status: string;
  description: string; required: boolean; expiryRequired: boolean;
  renewalRequired: boolean; renewalPeriodDays: string; notes: string;
}
const BLANK: ReqForm = { requirementCode: '', title: '', requirementType: 'OTHER', status: 'ACTIVE', description: '', required: false, expiryRequired: false, renewalRequired: false, renewalPeriodDays: '', notes: '' };

function ReqModal({ mode, initial, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: DocRequirement; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ReqForm>(() => initial ? {
    requirementCode: initial.requirementCode, title: initial.title,
    requirementType: initial.requirementType, status: initial.status,
    description: initial.description ?? '',
    required: initial.required, expiryRequired: initial.expiryRequired, renewalRequired: initial.renewalRequired,
    renewalPeriodDays: initial.renewalPeriodDays != null ? String(initial.renewalPeriodDays) : '',
    notes: initial.notes ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof ReqForm>(k: K, v: ReqForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.requirementCode.trim() || !form.title.trim()) { setError('Code and title required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        requirementCode: form.requirementCode, title: form.title,
        requirementType: form.requirementType, status: form.status,
        description: form.description || undefined, notes: form.notes || undefined,
        required: form.required, expiryRequired: form.expiryRequired, renewalRequired: form.renewalRequired,
        renewalPeriodDays: form.renewalRequired && form.renewalPeriodDays ? Number(form.renewalPeriodDays) : undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/compliance/document-requirements' : `/api/backend/compliance/document-requirements/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Requirement' : 'Edit Requirement'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.requirementCode} onChange={(e) => set('requirementCode', e.target.value)} />
        <FormInput label="Title" required value={form.title} onChange={(e) => set('title', e.target.value)} />
        <FormSelect label="Type" value={form.requirementType} onChange={(e) => set('requirementType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="col-span-2 grid grid-cols-3 gap-3 pt-2 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
            <input type="checkbox" checked={form.required} onChange={(e) => set('required', e.target.checked)} /> Required
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
            <input type="checkbox" checked={form.expiryRequired} onChange={(e) => set('expiryRequired', e.target.checked)} /> Has expiry
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
            <input type="checkbox" checked={form.renewalRequired} onChange={(e) => set('renewalRequired', e.target.checked)} /> Renewable
          </label>
        </div>
        {form.renewalRequired && <FormInput label="Renewal Period (days)" type="number" value={form.renewalPeriodDays} onChange={(e) => set('renewalPeriodDays', e.target.value)} />}
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function DocRequirementsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('compliance_document_requirements.manage');
  const canView = hasPermission('compliance_document_requirements.view') || canManage;

  const [items, setItems] = useState<DocRequirement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [requirementType, setRequirementType] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DocRequirement | null>(null);
  const [deleting, setDeleting] = useState<DocRequirement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (requirementType) params.set('requirementType', requirementType);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/compliance/document-requirements?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<DocRequirement> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, requirementType, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/compliance/document-requirements/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const activeCount = items.filter((r) => r.status === 'ACTIVE').length;
  const renewalCount = items.filter((r) => r.renewalRequired).length;

  if (!canView) return <div className="p-6"><PageHeader title="Document Requirements" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Document Requirements" subtitle="Required documents catalog" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="Renewal Required (page)" value={renewalCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={requirementType} onChange={(e) => reset(setRequirementType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Requirement</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No requirements</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Required</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">Renewable</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{r.requirementCode}</td>
                    <td className="px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3 text-xs">{r.requirementType}</td>
                    <td className="px-4 py-3 text-xs">{r.required ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-xs">{r.expiryRequired ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-xs">{r.renewalRequired ? `Yes (${r.renewalPeriodDays ?? '?'}d)` : 'No'}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(r)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(r)}>Delete</Btn>
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

      {creating && <ReqModal mode="create" onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <ReqModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Requirement" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete <strong>{deleting.title}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
