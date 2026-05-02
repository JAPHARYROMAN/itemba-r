'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Btn, Modal, PageToolbar, FormInput, FormSelect, FormTextarea, DateInput, PageSpinner, StatusBadge, ConfirmDialog } from '@/components/ui';

const STATUS_CLR: Record<string, string> = {
  PLANNED: 'bg-slate-50 text-slate-600 border-slate-200',
  LAND_PREPARATION: 'bg-orange-50 text-orange-700 border-orange-200',
  PLANTED: 'bg-blue-50 text-blue-700 border-blue-200',
  GROWING: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HARVESTING: 'bg-amber-50 text-amber-700 border-amber-200',
  HARVESTED: 'bg-green-50 text-green-700 border-green-200',
  CLOSED: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  CANCELLED: 'bg-red-50 text-red-600 border-red-200',
};
const NEXT_STATUS: Record<string, string> = {
  PLANNED: 'LAND_PREPARATION',
  LAND_PREPARATION: 'PLANTED',
  PLANTED: 'GROWING',
  GROWING: 'HARVESTING',
  HARVESTING: 'HARVESTED',
};

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';
function fmtCurrency(n: number) { return `TZS ${new Intl.NumberFormat('en-US').format(n)}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

const EMPTY_FORM = { seasonName: '', farmId: '', cropId: '', plantingDate: '', expectedHarvestDate: '', expectedYield: '', budgetAmount: '', currency: 'TZS', notes: '' };

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }
interface Farm { id: string; name: string; }
interface Crop { id: string; name: string; }

export default function SeasonsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [farms, setFarms] = useState<Farm[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); setFarms([]); setCrops([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0) setDivisionId(divs[0].id);
    });
    fetch(`/api/backend/agriculture/farms?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setFarms(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
    fetch(`/api/backend/agriculture/crops?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setCrops(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/backend/agriculture/crop-seasons?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowModal(true); }
  function openEdit(s: any) {
    setEditing(s);
    setForm({
      seasonName: s.seasonName ?? '',
      farmId: s.farmId ?? '',
      cropId: s.cropId ?? '',
      plantingDate: s.plantingDate ? s.plantingDate.split('T')[0] : '',
      expectedHarvestDate: s.expectedHarvestDate ? s.expectedHarvestDate.split('T')[0] : '',
      expectedYield: s.expectedYield?.toString() ?? '',
      budgetAmount: s.budgetAmount?.toString() ?? '',
      currency: s.currency ?? 'TZS',
      notes: s.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.seasonName.trim()) { setError('Season name is required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        ...form,
        expectedYield: form.expectedYield ? parseFloat(form.expectedYield) : undefined,
        budgetAmount: form.budgetAmount ? parseFloat(form.budgetAmount) : undefined,
        plantingDate: form.plantingDate ? new Date(form.plantingDate).toISOString().split('T')[0] : undefined,
        expectedHarvestDate: form.expectedHarvestDate ? new Date(form.expectedHarvestDate).toISOString().split('T')[0] : undefined,
        companyId,
        divisionId,
      };
      const url = editing ? `/api/backend/agriculture/crop-seasons/${editing.id}` : '/api/backend/agriculture/crop-seasons';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/backend/agriculture/crop-seasons/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function handleAdvance(id: string, nextStatus: string) {
    setActionLoading(`${id}-advance`);
    try {
      const res = await fetch(`/api/backend/agriculture/crop-seasons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
      if (!res.ok) throw new Error('Status update failed');
      await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Action failed'); }
    finally { setActionLoading(null); }
  }

  async function handleCancel(id: string) {
    setActionLoading(`${id}-cancel`);
    try {
      const res = await fetch(`/api/backend/agriculture/crop-seasons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELLED' }) });
      if (!res.ok) throw new Error('Cancel failed');
      await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Cancel failed'); }
    finally { setActionLoading(null); }
  }

  const farmName = (id: string) => farms.find(f => f.id === id)?.name ?? '—';
  const cropName = (id: string) => crops.find(c => c.id === id)?.name ?? '—';

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Crop Seasons" subtitle="Season tracking, budgets and revenues" />
      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" style={{ color: 'var(--aurora-text)' }}>
              <option value="">All Statuses</option>
              {Object.keys(STATUS_CLR).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </>
        }
        actions={companyId ? <Btn onClick={openCreate}>+ New Season</Btn> : undefined}
      />
      {!companyId && <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <PageSpinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{data.total} seasons</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Code</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Season Name</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Crop</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Farm</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Planting Date</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Exp. Harvest</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Budget</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Status</th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No seasons found.</td></tr>
                ) : data.data.map((s: any) => {
                  const next = NEXT_STATUS[s.status];
                  const advKey = `${s.id}-advance`;
                  const canKey = `${s.id}-cancel`;
                  return (
                    <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} font-medium text-indigo-600`}>{s.seasonCode}</td>
                      <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>{s.seasonName}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{cropName(s.cropId)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{farmName(s.farmId)}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.plantingDate ? fmtDate(s.plantingDate) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.expectedHarvestDate ? fmtDate(s.expectedHarvestDate) : '—'}</td>
                      <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>{s.budgetAmount != null ? fmtCurrency(s.budgetAmount) : '—'}</td>
                      <td className={tdCls}><StatusBadge status={s.status} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-1 flex-wrap">
                          <Btn variant="ghost" size="xs" onClick={() => openEdit(s)}>Edit</Btn>
                          {next && (
                            <Btn variant="ghost" size="xs" loading={actionLoading === advKey} onClick={() => handleAdvance(s.id, next)}>
                              → {next.replace(/_/g, ' ')}
                            </Btn>
                          )}
                          {!['CLOSED', 'CANCELLED'].includes(s.status) && (
                            <Btn variant="danger" size="xs" loading={actionLoading === canKey} onClick={() => handleCancel(s.id)}>
                              Cancel
                            </Btn>
                          )}
                          <Btn variant="danger" size="xs" onClick={() => setDeleteId(s.id)}>Delete</Btn>
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
        title={editing ? 'Edit Season' : 'New Season'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn loading={saving} onClick={handleSave}>Save Season</Btn>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-600">{error}</div>}
          {divisions.length > 1 && (
            <FormSelect label="Division" value={divisionId} onChange={e => setDivisionId(e.target.value)}>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </FormSelect>
          )}
          <FormInput label="Season Name *" value={form.seasonName} onChange={e => setForm(p => ({ ...p, seasonName: e.target.value }))} placeholder="Season 2024A" />
          <div className="grid grid-cols-2 gap-4">
            <FormSelect label="Farm" value={form.farmId} onChange={e => setForm(p => ({ ...p, farmId: e.target.value }))}>
              <option value="">— Select Farm —</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </FormSelect>
            <FormSelect label="Crop" value={form.cropId} onChange={e => setForm(p => ({ ...p, cropId: e.target.value }))}>
              <option value="">— Select Crop —</option>
              {crops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DateInput label="Planting Date" value={form.plantingDate} onChange={e => setForm(p => ({ ...p, plantingDate: e.target.value }))} />
            <DateInput label="Expected Harvest Date" value={form.expectedHarvestDate} onChange={e => setForm(p => ({ ...p, expectedHarvestDate: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Expected Yield" type="number" value={form.expectedYield} onChange={e => setForm(p => ({ ...p, expectedYield: e.target.value }))} placeholder="5000" />
            <FormInput label="Budget Amount" type="number" value={form.budgetAmount} onChange={e => setForm(p => ({ ...p, budgetAmount: e.target.value }))} placeholder="1000000" />
          </div>
          <FormInput label="Currency" value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} placeholder="TZS" />
          <FormTextarea label="Notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Season"
        message="Delete this season? This action cannot be undone."
        variant="danger"
        confirmLabel="Delete"
        onConfirm={() => handleDelete(deleteId!)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
