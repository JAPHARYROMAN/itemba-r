'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface EvidencePack {
  id: string;
  evidencePackNumber: string;
  companyId: string;
  company?: { name: string };
  packType: string;
  title: string;
  notes?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: string;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const TYPES = ['TAX_AUDIT', 'FINANCIAL_AUDIT', 'PAYROLL_AUDIT', 'LICENSE_RENEWAL', 'BRELA_COMPLIANCE', 'INTERNAL_AUDIT', 'BANK_REVIEW', 'LOAN_REVIEW', 'LEGAL_REVIEW', 'OTHER'];
const STATUSES = ['DRAFT', 'PREPARING', 'REVIEWED', 'READY', 'ARCHIVED', 'CANCELLED'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface PackForm {
  evidencePackNumber: string; title: string; companyId: string; packType: string;
  status: string; periodStart: string; periodEnd: string; notes: string;
}
const BLANK: PackForm = { evidencePackNumber: '', title: '', companyId: '', packType: 'OTHER', status: 'DRAFT', periodStart: '', periodEnd: '', notes: '' };

function PackModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: EvidencePack; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState<PackForm>(() => initial ? {
    evidencePackNumber: initial.evidencePackNumber, title: initial.title, companyId: initial.companyId,
    packType: initial.packType, status: initial.status,
    periodStart: initial.periodStart?.split('T')[0] ?? '',
    periodEnd: initial.periodEnd?.split('T')[0] ?? '',
    notes: initial.notes ?? '',
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof PackForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.evidencePackNumber.trim() || !form.title.trim() || !form.companyId) { setError('Number, title, company required'); return; }
    if (mode === 'create' && !user?.id) { setError('Current user is required to prepare the pack'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        evidencePackNumber: form.evidencePackNumber, title: form.title, companyId: form.companyId,
        packType: form.packType, status: form.status,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
        notes: form.notes || undefined,
      };
      if (mode === 'create') body.preparedById = user!.id;
      const res = await fetch(mode === 'create' ? '/api/backend/audit-evidence-packs' : `/api/backend/audit-evidence-packs/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Evidence Pack' : 'Edit Evidence Pack'} size="xl"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Pack Number" required value={form.evidencePackNumber} onChange={(e) => set('evidencePackNumber', e.target.value)} />
        <FormInput label="Title" required value={form.title} onChange={(e) => set('title', e.target.value)} />
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Type" value={form.packType} onChange={(e) => set('packType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <div />
        <FormInput label="Period Start" type="date" value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
        <FormInput label="Period End" type="date" value={form.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function EvidencePacksPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('audit_evidence_packs.manage');
  const canView = hasPermission('audit_evidence_packs.view') || canManage;

  const [items, setItems] = useState<EvidencePack[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [packType, setPackType] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EvidencePack | null>(null);
  const [deleting, setDeleting] = useState<EvidencePack | null>(null);
  const [actingId, setActingId] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (packType) params.set('packType', packType);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/audit-evidence-packs?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<EvidencePack> = j.data ?? {};
    const totalCount = p.total ?? 0;
    setItems(p.data ?? []);
    setTotal(totalCount);
    setTotalPages(p.totalPages ?? Math.max(1, Math.ceil(totalCount / 20)));
    setLoading(false);
  }, [page, companyId, packType, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const onSaved = () => { setCreating(false); setEditing(null); load(); };
  const doDelete = async () => {
    if (!deleting) return;
    await fetch(`/api/backend/audit-evidence-packs/${deleting.id}`, { method: 'DELETE' });
    setDeleting(null); load();
  };
  const doAction = async (id: string, action: 'review' | 'mark-ready') => {
    setActingId(id);
    await fetch(`/api/backend/audit-evidence-packs/${id}/${action}`, { method: 'PATCH' });
    setActingId(''); load();
  };

  const readyCount = items.filter((p) => p.status === 'READY').length;

  if (!canView) return <div className="p-6"><PageHeader title="Evidence Packs" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Evidence Packs" subtitle="Bundles of compliance documents for audits and reviews" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Ready (page)" value={readyCount} />
        <StatCard label="Page" value={`${page} / ${totalPages}`} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={packType} onChange={(e) => reset(setPackType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Pack</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No packs</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-3 font-mono text-xs">{p.evidencePackNumber}</td>
                    <td className="px-4 py-3">{p.title}</td>
                    <td className="px-4 py-3 text-xs">{p.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{p.packType}</td>
                    <td className="px-4 py-3 text-xs">{p.periodStart?.split('T')[0] ?? '—'} → {p.periodEnd?.split('T')[0] ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {['DRAFT', 'PREPARING'].includes(p.status) && <Btn variant="primary" size="xs" loading={actingId === p.id} onClick={() => doAction(p.id, 'review')}>Mark Reviewed</Btn>}
                        {p.status === 'REVIEWED' && <Btn variant="success" size="xs" loading={actingId === p.id} onClick={() => doAction(p.id, 'mark-ready')}>Mark Ready</Btn>}
                        <Btn variant="ghost" size="xs" onClick={() => setEditing(p)}>Edit</Btn>
                        <Btn variant="ghost" size="xs" onClick={() => setDeleting(p)}>Delete</Btn>
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

      {creating && <PackModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <PackModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete Pack" size="md"
          footer={<><Btn variant="secondary" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" onClick={doDelete}>Delete</Btn></>}>
          <p className="text-sm">Delete <strong>{deleting.title}</strong>?</p>
        </Modal>
      )}
    </div>
  );
}
