'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const PROG_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

interface Company { id: string; name: string; }
interface Project { id: string; projectName: string; projectCode: string; }
const initForm = { progressCode: '', projectId: '', reportDate: '', reportingPeriodStart: '', reportingPeriodEnd: '', overallCompletionPercent: '', status: 'DRAFT', notes: '' };

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ProgressPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
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
    fetch(`/api/backend/construction/projects?companyId=${companyId}&limit=100`).then(r => r.json()).then(j =>
      setProjects(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])
    );
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (projectFilter) params.set('projectId', projectFilter);
      const res = await fetch(`/api/backend/construction/progress?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, projectFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(progressId: string, endpoint: string) {
    setActionLoading(`${progressId}-${endpoint}`);
    try {
      const res = await fetch(`/api/backend/construction/progress/${progressId}/${endpoint}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error('Action failed');
      load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Action failed'); }
    finally { setActionLoading(null); }
  }

  function openNew() { setEditing(null); setForm({ ...initForm }); setShowModal(true); }
  function openEdit(item: any) {
    setEditing(item);
    setForm({
      progressCode: item.progressCode ?? '', projectId: item.projectId ?? '',
      reportDate: item.reportDate ? item.reportDate.substring(0, 10) : '',
      reportingPeriodStart: item.reportingPeriodStart ? item.reportingPeriodStart.substring(0, 10) : '',
      reportingPeriodEnd: item.reportingPeriodEnd ? item.reportingPeriodEnd.substring(0, 10) : '',
      overallCompletionPercent: item.overallCompletionPercent != null ? String(item.overallCompletionPercent) : '',
      status: item.status ?? 'DRAFT', notes: item.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId };
      if (body.overallCompletionPercent) body.overallCompletionPercent = parseFloat(body.overallCompletionPercent);
      if (!body.reportDate) delete body.reportDate;
      if (!body.reportingPeriodStart) delete body.reportingPeriodStart;
      if (!body.reportingPeriodEnd) delete body.reportingPeriodEnd;
      const url = editing ? `/api/backend/construction/progress/${editing.id}` : '/api/backend/construction/progress';
      const res = await fetch(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try { await fetch(`/api/backend/construction/progress/${deleteTarget}`, { method: 'DELETE' }); load(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setDeleteTarget(null); }
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const projName = (id: string) => { const p = projects.find(p => p.id === id); return p ? p.projectCode : id; };

  function ActionBtn({ id, label, endpoint, variant = 'default' }: { id: string; label: string; endpoint: string; variant?: string }) {
    const key = `${id}-${endpoint}`;
    return (
      <Btn size="sm" variant={variant === 'danger' ? 'danger' : 'secondary'} onClick={() => handleAction(id, endpoint)} loading={actionLoading === key}>
        {label}
      </Btn>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Progress Reports" subtitle="Project progress records and approvals" />
        <div className="flex gap-2 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && (
            <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </select>
          )}
          {companyId && <Btn variant="primary" onClick={openNew}>+ New Report</Btn>}
        </div>
      </div>
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} records</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Project</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Report Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Period Start</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Period End</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Completion %</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No progress records found.</td></tr>
                ) : data.data.map((p: any) => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{p.progressCode}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.projectId ? projName(p.projectId) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.reportDate ? fmtDate(p.reportDate) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.reportingPeriodStart ? fmtDate(p.reportingPeriodStart) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.reportingPeriodEnd ? fmtDate(p.reportingPeriodEnd) : '—'}</td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                      {p.overallCompletionPercent != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, p.overallCompletionPercent)}%` }} />
                          </div>
                          <span>{p.overallCompletionPercent}%</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className={tdCls}><StatusBadge status={p.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1 flex-wrap">
                        {p.status === 'DRAFT' && <ActionBtn id={p.id} label="Submit" endpoint="submit" />}
                        {p.status === 'SUBMITTED' && <ActionBtn id={p.id} label="Approve" endpoint="approve" />}
                        {p.status === 'SUBMITTED' && <ActionBtn id={p.id} label="Reject" endpoint="reject" variant="danger" />}
                        {['DRAFT', 'SUBMITTED'].includes(p.status) && (
                          <Btn size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Btn>
                        )}
                        {p.status === 'DRAFT' && (
                          <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(p.id)}>Del</Btn>
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
        title={editing ? 'Edit Progress Report' : 'New Progress Report'}
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>Save Report</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Progress Code *" value={form.progressCode} onChange={sf('progressCode')} />
          <FormInput label="Report Date *" type="date" value={form.reportDate} onChange={sf('reportDate')} />
          <div className="col-span-2">
            <FormSelect label="Project" value={form.projectId} onChange={sf('projectId')}>
              <option value="">— None —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode} — {p.projectName}</option>)}
            </FormSelect>
          </div>
          <FormInput label="Period Start" type="date" value={form.reportingPeriodStart} onChange={sf('reportingPeriodStart')} />
          <FormInput label="Period End" type="date" value={form.reportingPeriodEnd} onChange={sf('reportingPeriodEnd')} />
          <FormInput label="Completion % *" type="number" min="0" max="100" value={form.overallCompletionPercent} onChange={sf('overallCompletionPercent')} />
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {PROG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={3} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Progress Report"
        message="Delete this progress record? This cannot be undone."
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
