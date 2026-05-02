'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const SITE_STATUSES = ['ACTIVE', 'INACTIVE', 'CLOSED'];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

interface Company { id: string; name: string; }
interface Project { id: string; projectName: string; projectCode: string; }
const initForm = { siteCode: '', projectId: '', siteName: '', location: '', status: 'ACTIVE', siteManagerId: '', startDate: '', endDate: '', notes: '' };

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function SitesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>(initForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])
    );
  }, []);

  useEffect(() => {
    if (!companyId) { setProjects([]); return; }
    fetch(`/api/backend/construction/projects?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      setProjects(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/construction/sites?companyId=${companyId}&page=1&limit=50`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm({ ...initForm }); setShowModal(true); }
  function openEdit(item: any) {
    setEditing(item);
    setForm({
      siteCode: item.siteCode ?? '', projectId: item.projectId ?? '', siteName: item.siteName ?? '',
      location: item.location ?? '', status: item.status ?? 'ACTIVE', siteManagerId: item.siteManagerId ?? '',
      startDate: item.startDate ? item.startDate.substring(0, 10) : '',
      endDate: item.endDate ? item.endDate.substring(0, 10) : '',
      notes: item.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId };
      if (!body.startDate) delete body.startDate;
      if (!body.endDate) delete body.endDate;
      const url = editing ? `/api/backend/construction/sites/${editing.id}` : '/api/backend/construction/sites';
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try { await fetch(`/api/backend/construction/sites/${deleteTarget}`, { method: 'DELETE' }); load(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setDeleteTarget(null); }
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const projName = (id: string) => projects.find(p => p.id === id)?.projectCode ?? id;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Construction Sites" subtitle="Site registry and project locations" />
        <div className="flex gap-2 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Site</Btn>}
        </div>
      </div>
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} sites</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Site Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Project</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Location</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Manager ID</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Start</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>End</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No sites found.</td></tr>
                ) : data.data.map((s: any) => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{s.siteCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.siteName}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.projectId ? projName(s.projectId) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.location ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={s.status} /></td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.siteManagerId ?? '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.startDate ? fmtDate(s.startDate) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.endDate ? fmtDate(s.endDate) : '—'}</td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => openEdit(s)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(s.id)}>Del</Btn>
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
        title={editing ? 'Edit Site' : 'New Site'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>Save Site</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Site Code *" value={form.siteCode} onChange={sf('siteCode')} />
          <FormInput label="Site Name *" value={form.siteName} onChange={sf('siteName')} />
          <div className="col-span-2">
            <FormSelect label="Project" value={form.projectId} onChange={sf('projectId')}>
              <option value="">— None —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </FormSelect>
          </div>
          <div className="col-span-2">
            <FormInput label="Location *" value={form.location} onChange={sf('location')} />
          </div>
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {SITE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <FormInput label="Site Manager ID" value={form.siteManagerId} onChange={sf('siteManagerId')} placeholder="Optional" />
          <FormInput label="Start Date" type="date" value={form.startDate} onChange={sf('startDate')} />
          <FormInput label="End Date" type="date" value={form.endDate} onChange={sf('endDate')} />
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={2} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Site"
        message="Delete this site? This cannot be undone."
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
