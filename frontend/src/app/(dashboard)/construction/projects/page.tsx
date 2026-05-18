'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, Modal, Btn, FormInput, FormSelect, FormTextarea, ConfirmDialog, PageSpinner } from '@/components/ui';

const PROJECT_TYPES = ['RESIDENTIAL','COMMERCIAL','ROAD','CIVIL_WORKS','RENOVATION','SUPPLY_AND_INSTALL','OTHER'];
const PROJECT_STATUSES = ['PLANNED','ACTIVE','ON_HOLD','COMPLETED','CLOSED','CANCELLED'];

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }
const initForm = {
  projectCode: '', divisionId: '', branchId: '', customerId: '', clientName: '',
  projectName: '', projectType: 'COMMERCIAL', location: '', contractId: '',
  startDate: '', expectedEndDate: '', contractValue: '', budgetAmount: '',
  currency: 'TZS', status: 'PLANNED', projectManagerId: '', notes: '',
};

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ProjectsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>(initForm);
  const [saving, setSaving] = useState(false);
  const [profitability, setProfitability] = useState<{ id: string; data: any } | null>(null);
  const [profitLoading, setProfitLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const NEXT_STATUS: Record<string, { label: string; next: string }> = {
    PLANNED:   { label: 'Activate', next: 'ACTIVE' },
    ACTIVE:    { label: 'Hold', next: 'ON_HOLD' },
    ON_HOLD:   { label: 'Re-activate', next: 'ACTIVE' },
  };

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j =>
      setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])
    );
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/backend/construction/projects?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [companyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm({ ...initForm }); setShowModal(true); }
  function openEdit(item: any) {
    setEditing(item);
    setForm({
      projectCode: item.projectCode ?? '',
      divisionId: item.divisionId ?? '',
      branchId: item.branchId ?? '',
      customerId: item.customerId ?? '',
      clientName: item.clientName ?? '',
      projectName: item.projectName ?? '',
      projectType: item.projectType ?? 'COMMERCIAL',
      location: item.location ?? '',
      contractId: item.contractId ?? '',
      startDate: item.startDate ? item.startDate.substring(0, 10) : '',
      expectedEndDate: item.expectedEndDate ? item.expectedEndDate.substring(0, 10) : '',
      contractValue: item.contractValue != null ? String(item.contractValue) : '',
      budgetAmount: item.budgetAmount != null ? String(item.budgetAmount) : '',
      currency: item.currency ?? 'TZS',
      status: item.status ?? 'PLANNED',
      projectManagerId: item.projectManagerId ?? '',
      notes: item.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body: Record<string, any> = { ...form, companyId };
      if (body.contractValue) body.contractValue = parseFloat(body.contractValue);
      if (body.budgetAmount) body.budgetAmount = parseFloat(body.budgetAmount);
      if (!body.contractValue) delete body.contractValue;
      if (!body.budgetAmount) delete body.budgetAmount;
      if (!body.startDate) delete body.startDate;
      if (!body.expectedEndDate) delete body.expectedEndDate;
      const url = editing ? `/api/backend/construction/projects/${editing.id}` : '/api/backend/construction/projects';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/backend/construction/projects/${deleteTarget}`, { method: 'DELETE' });
      load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setDeleteTarget(null); }
  }

  async function changeStatus(projectId: string, newStatus: string) {
    setActionLoading(projectId);
    try {
      const res = await fetch(`/api/backend/construction/projects/${projectId}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Status change failed');
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setActionLoading(null); }
  }

  async function viewProfitability(projectId: string) {
    setProfitLoading(projectId);
    try {
      const res = await fetch(`/api/backend/construction/projects/${projectId}/profitability`);
      if (res.ok) { const json = await res.json(); setProfitability({ id: projectId, data: json.data ?? json }); }
    } finally { setProfitLoading(null); }
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Construction Projects" subtitle="Project portfolio and contract management" />
        <div className="flex gap-2 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
            <option value="">All Statuses</option>
            {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          {companyId && (
            <Btn variant="primary" onClick={openNew}>+ New Project</Btn>
          )}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load projects.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}

      {profitability && (
        <Card className="p-4 border-indigo-200 bg-indigo-50">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-indigo-800 mb-2">Profitability — Project {profitability.id}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div><div className="text-xs text-indigo-600">Contract Value</div><div className="font-medium" style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(profitability.data.contractValue ?? 0)}</div></div>
                <div><div className="text-xs text-indigo-600">Total Cost</div><div className="font-medium" style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(profitability.data.totalCost ?? 0)}</div></div>
                <div><div className="text-xs text-indigo-600">Gross Profit</div><div className="font-medium" style={{ color: 'var(--aurora-text)' }}>{fmtCurrency(profitability.data.grossProfit ?? 0)}</div></div>
                <div><div className="text-xs text-indigo-600">Gross Margin</div><div className="font-medium" style={{ color: 'var(--aurora-text)' }}>{profitability.data.grossMargin?.toFixed(1) ?? '—'}%</div></div>
              </div>
            </div>
            <button onClick={() => setProfitability(null)} className="text-indigo-600 hover:text-indigo-800 text-xs ml-4">✕ Close</button>
          </div>
        </Card>
      )}

      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} projects</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Project Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Type</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Client</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Contract Value</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Budget</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Start</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>End</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No projects found.</td></tr>
                ) : data.data.map((p: any) => {
                  const ns = NEXT_STATUS[p.status];
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{p.projectCode}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.projectName}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.projectType?.replace(/_/g, ' ') ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.clientName ?? '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.contractValue != null ? fmtCurrency(p.contractValue) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.budgetAmount != null ? fmtCurrency(p.budgetAmount) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.startDate ? fmtDate(p.startDate) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{p.expectedEndDate ? fmtDate(p.expectedEndDate) : '—'}</td>
                      <td className={tdCls}><StatusBadge status={p.status} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-1 flex-wrap">
                          <Btn size="sm" variant="secondary" onClick={() => viewProfitability(p.id)} loading={profitLoading === p.id}>P&L</Btn>
                          {ns && (
                            <Btn size="sm" variant="secondary" onClick={() => changeStatus(p.id, ns.next)} loading={actionLoading === p.id}>{ns.label}</Btn>
                          )}
                          <Btn size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(p.id)}>Del</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Project' : 'New Project'}
        size="2xl"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleSave}>Save Project</Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <FormInput label="Project Code *" value={form.projectCode} onChange={sf('projectCode')} />
          <FormInput label="Project Name *" value={form.projectName} onChange={sf('projectName')} />
          <FormSelect label="Project Type" value={form.projectType} onChange={sf('projectType')}>
            {PROJECT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={sf('status')}>
            {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </FormSelect>
          <FormSelect label="Division" value={form.divisionId} onChange={sf('divisionId')}>
            <option value="">— None —</option>
            {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </FormSelect>
          <FormInput label="Client Name" value={form.clientName} onChange={sf('clientName')} />
          <FormInput label="Location" value={form.location} onChange={sf('location')} />
          <FormInput label="Currency" value={form.currency} onChange={sf('currency')} />
          <FormInput label="Contract Value" type="number" value={form.contractValue} onChange={sf('contractValue')} />
          <FormInput label="Budget Amount" type="number" value={form.budgetAmount} onChange={sf('budgetAmount')} />
          <FormInput label="Start Date" type="date" value={form.startDate} onChange={sf('startDate')} />
          <FormInput label="Expected End Date" type="date" value={form.expectedEndDate} onChange={sf('expectedEndDate')} />
          <FormInput label="Branch ID" value={form.branchId} onChange={sf('branchId')} placeholder="Optional" />
          <FormInput label="Customer ID" value={form.customerId} onChange={sf('customerId')} placeholder="Optional" />
          <FormInput label="Contract ID" value={form.contractId} onChange={sf('contractId')} placeholder="Optional" />
          <FormInput label="Project Manager ID" value={form.projectManagerId} onChange={sf('projectManagerId')} placeholder="Optional" />
          <div className="col-span-2">
            <FormTextarea label="Notes" value={form.notes} onChange={sf('notes')} rows={3} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Project"
        message="Delete this project? This cannot be undone."
        variant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
