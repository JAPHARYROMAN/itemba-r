'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; branchCode: string }
interface FuelTank { id: string; tankName: string; tankCode: string }
interface Product { id: string; name: string; productCode: string }

interface TankDip {
  id: string;
  dipNumber: string;
  dipDate: string;
  tank?: { tankName: string } | null;
  physicalDipLitres: number;
  bookBalance: number;
  varianceLitres: number;
  varianceValue: number;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POSTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}

function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtNum(n: number) { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateDipModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [tankId, setTankId] = useState('');
  const [productId, setProductId] = useState('');
  const [dipDate, setDipDate] = useState(new Date().toISOString().split('T')[0]);
  const [physicalDipLitres, setPhysicalDipLitres] = useState<number | ''>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tanks, setTanks] = useState<FuelTank[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
      fetch(`/api/backend/products?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setProducts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    }
  }, [companyId]);

  useEffect(() => {
    if (branchId) fetch(`/api/backend/petroleum/fuel-tanks/branch/${branchId}`).then(r => r.json()).then(j => setTanks(j.data ?? j));
  }, [branchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !branchId || !tankId || !productId || physicalDipLitres === '') { setError('All fields required'); return; }
    setSaving(true); setError('');
    try {
      const body = { companyId, branchId, tankId, productId, dipDate, physicalDipLitres: Number(physicalDipLitres) };
      const res = await fetch('/api/backend/petroleum/tank-dips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
          <h2 className="text-base font-semibold text-slate-900">Record Tank Dip</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Company *</label>
              <select required value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Branch *</label>
              <select required value={branchId} onChange={e => setBranchId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select…</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tank *</label>
              <select required value={tankId} onChange={e => setTankId(e.target.value)} className={fieldCls} disabled={!branchId}>
                <option value="">Select…</option>
                {tanks.map(t => <option key={t.id} value={t.id}>{t.tankCode} – {t.tankName}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Product *</label>
              <select required value={productId} onChange={e => setProductId(e.target.value)} className={fieldCls} disabled={!companyId}>
                <option value="">Select…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.productCode} – {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Dip Date *</label>
              <input required type="date" value={dipDate} onChange={e => setDipDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Physical Dip (Litres) *</label>
              <input required type="number" step="0.01" value={physicalDipLitres} onChange={e => setPhysicalDipLitres(e.target.value === '' ? '' : Number(e.target.value))} className={fieldCls} placeholder="0.00" />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Saving…' : 'Record Dip'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TankDipsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dips, setDips] = useState<TankDip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    else { setBranches([]); setBranchId(''); }
  }, [companyId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/backend/petroleum/tank-dips?branchId=${branchId}`);
      if (!res.ok) throw new Error('Failed to load tank dips');
      const json = await res.json();
      setDips(json.data?.data ?? json.data ?? json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading dips');
    } finally { setLoading(false); }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: 'submit' | 'approve' | 'post') => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/backend/petroleum/tank-dips/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally { setActionLoading(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Tank Dips" subtitle="Record and manage physical tank dip readings" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + Record Dip
        </button>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
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
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {!loading && branchId && (
        <Card className="overflow-hidden">
          {dips.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No tank dips found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Dip #</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Tank</th>
                    <th className={`${thCls} text-right`}>Physical Dip (L)</th>
                    <th className={`${thCls} text-right`}>Book Balance (L)</th>
                    <th className={`${thCls} text-right`}>Variance (L)</th>
                    <th className={`${thCls} text-right`}>Variance Value</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dips.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{d.dipNumber}</td>
                      <td className={tdCls}>{fmtDate(d.dipDate)}</td>
                      <td className={tdCls}>{d.tank?.tankName ?? '—'}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(d.physicalDipLitres)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(d.bookBalance)}</td>
                      <td className={`${tdCls} text-right font-mono ${d.varianceLitres < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtNum(d.varianceLitres)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(d.varianceValue)}</td>
                      <td className={tdCls}><Badge status={d.status} /></td>
                      <td className="px-4 py-2 text-right space-x-2">
                        {d.status === 'DRAFT' && (
                          <button onClick={() => doAction(d.id, 'submit')} disabled={actionLoading === d.id} className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">Submit</button>
                        )}
                        {d.status === 'SUBMITTED' && (
                          <button onClick={() => doAction(d.id, 'approve')} disabled={actionLoading === d.id} className="text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-50">Approve</button>
                        )}
                        {d.status === 'APPROVED' && (
                          <button onClick={() => doAction(d.id, 'post')} disabled={actionLoading === d.id} className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50">Post</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!branchId && !loading && <div className="text-center py-10 text-sm text-slate-400">Select a company and branch to view tank dips.</div>}

      {modalOpen && (
        <CreateDipModal
          companies={companies}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
