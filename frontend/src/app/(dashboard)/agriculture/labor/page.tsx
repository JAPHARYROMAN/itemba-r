'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

const PAYMENT_CLR: Record<string, string> = {
  UNPAID: 'bg-red-50 text-red-600 border-red-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];

function Badge({ status }: { status: string }) {
  const cls = PAYMENT_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}
function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';
const inputCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const fmtCurrency = (n: number | string | null | undefined) => { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Math.round(Number.isFinite(value) ? value : 0))}`; };
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const EMPTY_FORM = { workerName: '', role: '', laborDate: '', hoursWorked: '', dayRate: '', totalAmount: '', currency: 'TZS', paymentStatus: 'UNPAID', notes: '', laborContextId: '' };

interface Company { id: string; name: string; }
interface Division { id: string; name: string; }
interface Season { id: string; seasonName: string; }

export default function AgricultureLaborPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [data, setData] = useState<{ data: any[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (!companyId) { setDivisions([]); setDivisionId(''); setSeasons([]); return; }
    fetch(`/api/backend/divisions?companyId=${companyId}&limit=100`).then(r => r.json()).then(j => {
      const divs = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
      setDivisions(divs);
      if (divs.length > 0) setDivisionId(divs[0].id);
    });
    fetch(`/api/backend/agriculture/crop-seasons?companyId=${companyId}&page=1&limit=100`).then(r => r.json()).then(j => {
      setSeasons(Array.isArray(j.data?.data) ? j.data.data : []);
    });
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/itemba/labor-records?companyId=${companyId}&laborContextType=AGRICULTURE_SEASON&page=1&limit=50`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(Array.isArray(json.data?.data) ? json.data : { data: Array.isArray(json.data) ? json.data : [], total: 0 });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setShowModal(true); }
  function openEdit(r: any) {
    setEditing(r);
    setForm({ workerName: r.workerName ?? '', role: r.role ?? '', laborDate: r.laborDate?.split('T')[0] ?? '', hoursWorked: r.hoursWorked?.toString() ?? '', dayRate: r.dayRate?.toString() ?? '', totalAmount: r.totalAmount?.toString() ?? '', currency: r.currency ?? 'TZS', paymentStatus: r.paymentStatus ?? 'UNPAID', notes: r.notes ?? '', laborContextId: r.laborContextId ?? '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.workerName.trim()) { setError('Worker name is required'); return; }
    if (!form.laborDate) { setError('Labor date is required'); return; }
    if (!form.totalAmount) { setError('Total amount is required'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, hoursWorked: form.hoursWorked ? parseFloat(form.hoursWorked) : undefined, dayRate: form.dayRate ? parseFloat(form.dayRate) : undefined, totalAmount: parseFloat(form.totalAmount), companyId, divisionId, laborContextType: 'AGRICULTURE_SEASON' };
      const url = editing ? `/api/backend/itemba/labor-records/${editing.id}` : '/api/backend/itemba/labor-records';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json(); throw new Error(Array.isArray(e.message) ? e.message.join(', ') : (e.message ?? 'Save failed')); }
      setShowModal(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/backend/itemba/labor-records/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteId(null); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  const totalAmount = data.data.reduce((sum: number, r: any) => sum + Number(r.totalAmount ?? 0), 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Agriculture Labor Records" subtitle="Worker labor costs and payment tracking" />
        <div className="flex items-center gap-3 flex-wrap">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">— Select Company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {companyId && <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 font-medium">+ New Record</button>}
        </div>
      </div>

      {!companyId && <div className="text-center py-10 text-sm text-slate-400">Select a company to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {companyId && loading && <Spinner />}
      {companyId && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card className="p-4"><div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Records</div><div className="text-2xl font-bold text-slate-800">{data.total}</div></Card>
            <Card className="p-4"><div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Labor Cost</div><div className="text-xl font-bold text-slate-800">{fmtCurrency(totalAmount)}</div></Card>
          </div>
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-500">{data.total} records</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className={thCls}>#</th><th className={thCls}>Worker</th><th className={thCls}>Role</th>
                    <th className={thCls}>Date</th><th className={thCls}>Hours</th><th className={thCls}>Total</th>
                    <th className={thCls}>Payment</th><th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No labor records found.</td></tr>
                  ) : data.data.map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className={`${tdCls} text-indigo-600 font-medium`}>{r.laborRecordNumber}</td>
                      <td className={`${tdCls} font-medium`}>{r.workerName ?? '—'}</td>
                      <td className={tdCls}>{r.role ?? '—'}</td>
                      <td className={tdCls}>{r.laborDate ? fmtDate(r.laborDate) : '—'}</td>
                      <td className={tdCls}>{r.hoursWorked ?? '—'}</td>
                      <td className={`${tdCls} font-medium`}>{fmtCurrency(Number(r.totalAmount ?? 0))}</td>
                      <td className={tdCls}><Badge status={r.paymentStatus} /></td>
                      <td className={tdCls}>
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(r)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                          <button onClick={() => setDeleteId(r.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">{editing ? 'Edit Labor Record' : 'New Labor Record'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-600">{error}</div>}
              {divisions.length > 1 && (
                <div><label className={labelCls}>Division</label>
                  <select value={divisionId} onChange={e => setDivisionId(e.target.value)} className={inputCls}>
                    {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelCls}>Worker Name *</label><input value={form.workerName} onChange={e => setForm(p => ({ ...p, workerName: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Role</label><input value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} placeholder="Harvester, Weeder…" className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Crop Season (optional)</label>
                <select value={form.laborContextId} onChange={e => setForm(p => ({ ...p, laborContextId: e.target.value }))} className={inputCls}>
                  <option value="">— None —</option>
                  {seasons.map(s => <option key={s.id} value={s.id}>{s.seasonName}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Labor Date *</label><input type="date" value={form.laborDate} onChange={e => setForm(p => ({ ...p, laborDate: e.target.value }))} className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelCls}>Hours Worked</label><input type="number" value={form.hoursWorked} onChange={e => setForm(p => ({ ...p, hoursWorked: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Day Rate</label><input type="number" value={form.dayRate} onChange={e => setForm(p => ({ ...p, dayRate: e.target.value }))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelCls}>Total Amount *</label><input type="number" value={form.totalAmount} onChange={e => setForm(p => ({ ...p, totalAmount: e.target.value }))} className={inputCls} /></div>
                <div><label className={labelCls}>Currency</label><input value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} placeholder="TZS" className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Payment Status</label>
                <select value={form.paymentStatus} onChange={e => setForm(p => ({ ...p, paymentStatus: e.target.value }))} className={inputCls}>
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} /></div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-60 font-medium">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="text-3xl">⚠️</div>
            <p className="text-sm text-slate-700 font-medium">Delete this labor record? This action cannot be undone.</p>
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
