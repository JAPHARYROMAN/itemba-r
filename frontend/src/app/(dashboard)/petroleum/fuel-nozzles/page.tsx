'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; branchCode: string }
interface FuelPump { id: string; pumpName: string; pumpCode: string }

interface FuelNozzle {
  id: string;
  nozzleCode: string;
  nozzleName: string;
  pump?: { pumpName: string } | null;
  tank?: { tankName: string } | null;
  openingMeter: number;
  currentMeterReading: number;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  MAINTENANCE: 'bg-amber-50 text-amber-700 border-amber-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}

function fmtNum(n: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n); }

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function NozzleModal({ nozzle, companies, onClose, onSaved }: {
  nozzle: FuelNozzle | null; companies: Company[];
  onClose: () => void; onSaved: () => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [pumpId, setPumpId] = useState('');
  const [nozzleCode, setNozzleCode] = useState(nozzle?.nozzleCode ?? '');
  const [nozzleName, setNozzleName] = useState(nozzle?.nozzleName ?? '');
  const [openingMeter, setOpeningMeter] = useState<number | ''>(nozzle?.openingMeter ?? '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pumps, setPumps] = useState<FuelPump[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, [companyId]);

  useEffect(() => {
    if (branchId) fetch(`/api/backend/petroleum/fuel-pumps/branch/${branchId}`).then(r => r.json()).then(j => setPumps(j.data ?? j));
  }, [branchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pumpId || !nozzleCode || !nozzleName) { setError('Required fields missing'); return; }
    setSaving(true); setError('');
    try {
      const body = { nozzleCode, nozzleName, pumpId, openingMeter: Number(openingMeter) || 0 };
      const url = nozzle ? `/api/backend/petroleum/fuel-nozzles/${nozzle.id}` : '/api/backend/petroleum/fuel-nozzles';
      const res = await fetch(url, { method: nozzle ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{nozzle ? 'Edit Nozzle' : 'New Fuel Nozzle'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Company *</label>
              <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Branch *</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select…</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Pump *</label>
              <select required value={pumpId} onChange={e => setPumpId(e.target.value)} className={fieldCls} disabled={!branchId}>
                <option value="">Select pump…</option>
                {pumps.map(p => <option key={p.id} value={p.id}>{p.pumpCode} – {p.pumpName}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Nozzle Code *</label>
              <input required value={nozzleCode} onChange={e => setNozzleCode(e.target.value)} className={fieldCls} placeholder="NZL-001" />
            </div>
            <div>
              <label className={labelCls}>Nozzle Name *</label>
              <input required value={nozzleName} onChange={e => setNozzleName(e.target.value)} className={fieldCls} placeholder="Nozzle 1" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Opening Meter Reading</label>
              <input type="number" step="0.01" value={openingMeter} onChange={e => setOpeningMeter(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.00" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : nozzle ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FuelNozzlesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pumps, setPumps] = useState<FuelPump[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [pumpId, setPumpId] = useState('');
  const [nozzles, setNozzles] = useState<FuelNozzle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FuelNozzle | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    else { setBranches([]); setBranchId(''); }
  }, [companyId]);

  useEffect(() => {
    if (branchId) fetch(`/api/backend/petroleum/fuel-pumps/branch/${branchId}`).then(r => r.json()).then(j => setPumps(j.data ?? j));
    else { setPumps([]); setPumpId(''); }
  }, [branchId]);

  const load = useCallback(async () => {
    if (!pumpId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/petroleum/fuel-nozzles/pump/${pumpId}`);
      if (!res.ok) throw new Error('Failed to load nozzles');
      const json = await res.json();
      (Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading nozzles');
    } finally { setLoading(false); }
  }, [pumpId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this nozzle?')) return;
    await fetch(`/api/backend/petroleum/fuel-nozzles/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Fuel Nozzles" subtitle="Manage nozzles attached to each pump" />
        <button onClick={() => { setEditing(null); setModalOpen(true); }} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + New Nozzle
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Company</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
              <option value="">— Select Company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className={fieldCls} disabled={!companyId}>
              <option value="">— Select Branch —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pump</label>
            <select value={pumpId} onChange={e => setPumpId(e.target.value)} className={fieldCls} disabled={!branchId}>
              <option value="">— Select Pump —</option>
              {pumps.map(p => <option key={p.id} value={p.id}>{p.pumpCode} – {p.pumpName}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {!loading && pumpId && (
        <Card className="overflow-hidden">
          {nozzles.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No nozzles found for this pump.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Code</th>
                    <th className={thCls}>Name</th>
                    <th className={thCls}>Pump</th>
                    <th className={thCls}>Tank</th>
                    <th className={`${thCls} text-right`}>Opening Meter</th>
                    <th className={`${thCls} text-right`}>Current Meter</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {nozzles.map(n => (
                    <tr key={n.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{n.nozzleCode}</td>
                      <td className={tdCls}>{n.nozzleName}</td>
                      <td className={tdCls}>{n.pump?.pumpName ?? '—'}</td>
                      <td className={tdCls}>{n.tank?.tankName ?? '—'}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(n.openingMeter)}</td>
                      <td className={`${tdCls} text-right`}>{fmtNum(n.currentMeterReading)}</td>
                      <td className={tdCls}><Badge status={n.status} /></td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => { setEditing(n); setModalOpen(true); }} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">Edit</button>
                        <button onClick={() => handleDelete(n.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!pumpId && !loading && <div className="text-center py-10 text-sm text-slate-400">Select a company, branch, and pump to view nozzles.</div>}

      {modalOpen && (
        <NozzleModal
          nozzle={editing}
          companies={companies}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
