'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';
import { CompanyBranchPicker } from '@/components/petroleum/CompanyBranchPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; branchCode: string }

interface DailyReconciliation {
  id: string;
  reconciliationNumber: string;
  reconciliationDate: string;
  totalLitresSold: number;
  totalExpectedSales: number;
  totalCollections: number;
  cashShortage: number;
  cashExcess: number;
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

// ─── Generate Modal ───────────────────────────────────────────────────────────

function GenerateModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reconciliationDate, setReconciliationDate] = useState(new Date().toISOString().split('T')[0]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    else { setBranches([]); setBranchId(''); }
  }, [companyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !branchId) { setError('Company and branch required'); return; }
    setSaving(true); setError('');
    try {
      const body = { companyId, branchId, reconciliationDate };
      const res = await fetch('/api/backend/petroleum/daily-reconciliations/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Generation failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating reconciliation');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Generate Daily Reconciliation</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className={labelCls}>Company *</label>
            <select required value={companyId} onChange={e => setCompanyId(e.target.value)} className={fieldCls}>
              <option value="">Select…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
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
            <label className={labelCls}>Reconciliation Date *</label>
            <input required type="date" value={reconciliationDate} onChange={e => setReconciliationDate(e.target.value)} className={fieldCls} />
          </div>
        </form>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving} className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium">
            {saving ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyReconciliationPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reconciliations, setReconciliations] = useState<DailyReconciliation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ companyId });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/backend/petroleum/daily-reconciliations?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load reconciliations');
      const json = await res.json();
      const list = Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
      setReconciliations(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading');
    } finally { setLoading(false); }
  }, [companyId, branchId]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: 'submit' | 'approve' | 'post') => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/backend/petroleum/daily-reconciliations/${id}/${action}`, { method: 'PATCH' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Action failed'); }
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally { setActionLoading(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Daily Reconciliation" subtitle="Generate and manage daily petroleum reconciliations" />
        <button onClick={() => setModalOpen(true)} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium">
          + Generate Reconciliation
        </button>
      </div>

      <Card className="p-4">
        <CompanyBranchPicker
          companyId={companyId}
          branchId={branchId}
          onCompanyChange={setCompanyId}
          onBranchChange={setBranchId}
          allBranchesLabel="All branches (every station)"
        />
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {!loading && companyId && (
        <Card className="overflow-hidden">
          {reconciliations.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No reconciliations found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Rec. #</th>
                    <th className={thCls}>Date</th>
                    <th className={`${thCls} text-right`}>Litres Sold</th>
                    <th className={`${thCls} text-right`}>Expected Sales</th>
                    <th className={`${thCls} text-right`}>Collections</th>
                    <th className={`${thCls} text-right`}>Shortage</th>
                    <th className={`${thCls} text-right`}>Excess</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reconciliations.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className={`${tdCls} font-medium`}>{r.reconciliationNumber}</td>
                      <td className={tdCls}>{fmtDate(r.reconciliationDate)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.totalLitresSold)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.totalExpectedSales)}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmtNum(r.totalCollections)}</td>
                      <td className={`${tdCls} text-right font-mono text-red-600`}>{r.cashShortage > 0 ? fmtNum(r.cashShortage) : '—'}</td>
                      <td className={`${tdCls} text-right font-mono text-emerald-600`}>{r.cashExcess > 0 ? fmtNum(r.cashExcess) : '—'}</td>
                      <td className={tdCls}><Badge status={r.status} /></td>
                      <td className="px-4 py-2 text-right space-x-2">
                        {r.status === 'DRAFT' && (
                          <button onClick={() => doAction(r.id, 'submit')} disabled={actionLoading === r.id} className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">Submit</button>
                        )}
                        {r.status === 'SUBMITTED' && (
                          <button onClick={() => doAction(r.id, 'approve')} disabled={actionLoading === r.id} className="text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-50">Approve</button>
                        )}
                        {r.status === 'APPROVED' && (
                          <button onClick={() => doAction(r.id, 'post')} disabled={actionLoading === r.id} className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50">Post</button>
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

      {!companyId && !loading && <div className="text-center py-10 text-sm text-slate-400">Select a company to view reconciliations.</div>}

      {modalOpen && (
        <GenerateModal
          companies={companies}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
