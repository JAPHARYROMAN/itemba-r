'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  POSTED: 'bg-purple-50 text-purple-700 border-purple-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}
function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';
const inputCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

const EMPTY_FORM = { cropSeasonId: '', farmId: '', harvestDate: '', quantity: '', unitId: '', qualityGrade: '', estimatedUnitValue: '', notes: '' };

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }
interface Farm { id: string; name: string; }
interface Season { id: string; seasonName: string; }

export default function HarvestsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [farms, setFarms] = useState<Farm[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
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
    if (!companyId) { setDivisions([]); setDivisionId(''); setFarms([]); setSeasons([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0) setDivisionId(divs[0].id);
    });
    fetch(`/api/backend/agriculture/farms?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setFarms(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
    fetch(`/api/backend/agriculture/crop-seasons?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setSeasons(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId, page: '1', limit: '50' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/backend/agriculture/harvest-records?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowModal(true); }
  function openEdit(h: any) {
    setEditing(h);
    setForm({
      cropSeasonId: h.cropSeasonId ?? '',
      farmId: h.farmId ?? '',
      harvestDate: h.harvestDate ? h.harvestDate.split('T')[0] : '',
      quantity: h.quantity?.toString() ?? '',
      unitId: h.unitId ?? '',
      qualityGrade: h.qualityGrade ?? '',
      estimatedUnitValue: h.estimatedUnitValue?.toString() ?? '',
      notes: h.notes ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body = {
        ...form,
        quantity: form.quantity ? parseFloat(form.quantity) : undefined,
        estimatedUnitValue: form.estimatedUnitValue ? parseFloat(form.estimatedUnitValue) : undefined,
        harvestDate: form.harvestDate ? new Date(form.harvestDate).toISOString().split('T')[0] : undefined,
        cropSeasonId: form.cropSeasonId || undefined,
        companyId,
        divisionId,
      };
      const url = editing ? `/api/backend/agriculture/harvest-records/${editing.id}` : '/api/backend/agriculture/harvest-records';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message ?? 'Save failed'); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/backend/agriculture/harvest-records/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function handleAction(harvestId: string, endpoint: string) {
    setActionLoading(`${harvestId}-${endpoint}`);
    try {
      const res = await fetch(`/api/backend/agriculture/harvest-records/${harvestId}/${endpoint}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error('Action failed');
      await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Action failed'); }
    finally { setActionLoading(null); }
  }

  function ActionBtn({ id, label, endpoint, disabled }: { id: string; label: string; endpoint: string; disabled?: boolean }) {
    const key = `${id}-${endpoint}`;
    return (
      <button onClick={() => handleAction(id, endpoint)} disabled={disabled || actionLoading === key} className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-100 disabled:opacity-40 transition-colors mr-1">
        {actionLoading === key ? '…' : label}
      </button>
    );
  }

  const farmName = (id: string) => farms.find(f => f.id === id)?.name ?? '—';
  const seasonName = (id: string) => seasons.find(s => s.id === id)?.seasonName ?? '—';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Harvests" subtitle="Harvest records and approval workflow" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">All Statuses</option>
            {Object.keys(STATUS_CLR).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          {companyId && <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 font-medium">+ New Harvest</button>}
        </div>
      </div>
      {!companyId && <div className="text-center py-10 text-sm text-slate-400">Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <Spinner />}
      {companyId && !loading && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{data.total} harvests</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls}>#</th><th className={thCls}>Farm</th><th className={thCls}>Season/Crop</th>
                  <th className={thCls}>Date</th><th className={thCls}>Qty</th><th className={thCls}>Quality</th>
                  <th className={thCls}>Est. Value</th><th className={thCls}>Status</th><th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">No harvests found.</td></tr>
                ) : data.data.map((h: any) => (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium text-indigo-600`}>{h.harvestNumber}</td>
                    <td className={tdCls}>{farmName(h.farmId)}</td>
                    <td className={tdCls}>{h.cropSeasonId ? seasonName(h.cropSeasonId) : '—'}</td>
                    <td className={tdCls}>{h.harvestDate ? fmtDate(h.harvestDate) : '—'}</td>
                    <td className={tdCls}>{h.quantity != null ? `${h.quantity} ${h.unitId ?? ''}`.trim() : '—'}</td>
                    <td className={tdCls}>{h.qualityGrade ?? '—'}</td>
                    <td className={tdCls}>{h.estimatedTotalValue != null ? fmtCurrency(h.estimatedTotalValue) : '—'}</td>
                    <td className={tdCls}><Badge status={h.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => openEdit(h)} className="text-xs text-indigo-600 hover:underline mr-1">Edit</button>
                        {h.status === 'DRAFT' && <ActionBtn id={h.id} label="Submit" endpoint="submit" />}
                        {h.status === 'SUBMITTED' && <ActionBtn id={h.id} label="Approve" endpoint="approve" />}
                        {h.status === 'SUBMITTED' && <ActionBtn id={h.id} label="Reject" endpoint="reject" />}
                        {h.status === 'APPROVED' && <ActionBtn id={h.id} label="Post" endpoint="post" />}
                        <button onClick={() => setDeleteId(h.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">{editing ? 'Edit Harvest' : 'New Harvest'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-600">{error}</div>}
              {divisions.length > 1 && (
                <div>
                  <label className={labelCls}>Division</label>
                  <select value={divisionId} onChange={e => setDivisionId(e.target.value)} className={inputCls}>
                    {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelCls}>Farm</label>
                  <select value={form.farmId} onChange={e => setForm(p => ({ ...p, farmId: e.target.value }))} className={inputCls}>
                    <option value="">— Select Farm —</option>
                    {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Season (optional)</label>
                  <select value={form.cropSeasonId} onChange={e => setForm(p => ({ ...p, cropSeasonId: e.target.value }))} className={inputCls}>
                    <option value="">— Select Season —</option>
                    {seasons.map(s => <option key={s.id} value={s.id}>{s.seasonName}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelCls}>Harvest Date</label><input type="date" value={form.harvestDate} onChange={e => setForm(p => ({ ...p, harvestDate: e.target.value }))} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelCls}>Quantity</label><input type="number" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} placeholder="5000" className={inputCls} /></div>
                <div><label className={labelCls}>Unit (e.g. KG)</label><input value={form.unitId} onChange={e => setForm(p => ({ ...p, unitId: e.target.value }))} placeholder="KG" className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelCls}>Quality Grade</label><input value={form.qualityGrade} onChange={e => setForm(p => ({ ...p, qualityGrade: e.target.value }))} placeholder="Grade A" className={inputCls} /></div>
                <div><label className={labelCls}>Est. Unit Value</label><input type="number" value={form.estimatedUnitValue} onChange={e => setForm(p => ({ ...p, estimatedUnitValue: e.target.value }))} placeholder="500" className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={3} className={inputCls} /></div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-60 font-medium">{saving ? 'Saving…' : 'Save Harvest'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="text-3xl">⚠️</div>
            <p className="text-sm text-slate-700 font-medium">Delete this harvest record? This action cannot be undone.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="px-5 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
