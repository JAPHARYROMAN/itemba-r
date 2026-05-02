'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface Requirement { id: string; title: string }

interface DocStatus {
  id: string;
  companyId: string;
  company?: { name: string };
  requirementId: string;
  requirement?: { title: string };
  documentId?: string | null;
  status: string;
  expiryDate?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const STATUSES = ['MISSING', 'AVAILABLE', 'EXPIRED', 'EXPIRING_SOON', 'UNDER_REVIEW'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface StatusForm {
  companyId: string; requirementId: string; documentId: string; status: string;
  expiryDate: string; renewalDate: string; notes: string;
}
const BLANK: StatusForm = { companyId: '', requirementId: '', documentId: '', status: 'MISSING', expiryDate: '', renewalDate: '', notes: '' };

function StatusModal({ mode, initial, companies, requirements, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: DocStatus; companies: Company[]; requirements: Requirement[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<StatusForm>(() => initial ? {
    companyId: initial.companyId, requirementId: initial.requirementId,
    documentId: initial.documentId ?? '', status: initial.status,
    expiryDate: initial.expiryDate?.split('T')[0] ?? '',
    renewalDate: initial.renewalDate?.split('T')[0] ?? '',
    notes: initial.notes ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof StatusForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.companyId || !form.requirementId) { setError('Company and requirement required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId, requirementId: form.requirementId, status: form.status,
        documentId: form.documentId || undefined,
        expiryDate: form.expiryDate || undefined,
        renewalDate: form.renewalDate || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch(mode === 'create' ? '/api/backend/compliance/document-status' : `/api/backend/compliance/document-status/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Doc Status' : 'Edit Doc Status'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Requirement" required value={form.requirementId} onChange={(e) => set('requirementId', e.target.value)} placeholder="Select…">
          {requirements.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </FormSelect>
        <FormInput label="Document Id" value={form.documentId} onChange={(e) => set('documentId', e.target.value)} />
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormInput label="Expiry Date" type="date" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
        <FormInput label="Renewal Date" type="date" value={form.renewalDate} onChange={(e) => set('renewalDate', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function DocStatusPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('compliance_document_status.manage');
  const canView = hasPermission('compliance_document_status.view') || canManage;

  const [items, setItems] = useState<DocStatus[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DocStatus | null>(null);
  const [deleting, setDeleting] = useState<DocStatus | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
    fetch('/api/backend/compliance/document-requirements?limit=100').then((r) => r.json()).then((j) => setRequirements(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/compliance/document-status?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<DocStatus> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/compliance/document-status/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };

  const availableCount = items.filter((s) => s.status === 'AVAILABLE').length;
  const missingCount = items.filter((s) => s.status === 'MISSING').length;
  const expiringCount = items.filter((s) => s.status === 'EXPIRING_SOON').length;

  if (!canView) return <div className="p-6"><PageHeader title="Document Status" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Document Status" subtitle="Per-company tracking of document availability and expiry" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Available (page)" value={availableCount} />
        <StatCard label="Missing (page)" value={missingCount} />
        <StatCard label="Expiring (page)" value={expiringCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Status</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No records</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Requirement</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">Renewal</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const danger = s.status === 'MISSING' || s.status === 'EXPIRED';
                  const warn = s.status === 'EXPIRING_SOON';
                  return (
                    <tr key={s.id} className="border-t" style={{ borderColor: 'var(--aurora-border)', background: danger ? 'rgba(239,68,68,0.06)' : warn ? 'rgba(245,158,11,0.06)' : undefined }}>
                      <td className="px-4 py-3 text-xs">{s.company?.name ?? '—'}</td>
                      <td className="px-4 py-3">{s.requirement?.title ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-xs">{s.expiryDate?.split('T')[0] ?? '—'}</td>
                      <td className="px-4 py-3 text-xs">{s.renewalDate?.split('T')[0] ?? '—'}</td>
                      {canManage && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(s)}>Edit</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(s)}>Delete</Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
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

      {creating && <StatusModal mode="create" companies={companies} requirements={requirements} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <StatusModal mode="edit" initial={editing} companies={companies} requirements={requirements} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Status" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete this status entry?</p>
        </Modal>
      )}
    </div>
  );
}
