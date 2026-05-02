'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; code: string }
interface Branch { id: string; name: string; branchCode: string }

type ReportTab = 'fuel-stock' | 'shift-summary' | 'deliveries' | 'credit-sales' | 'tank-dips' | 'reconciliation';

interface ReportRow { [key: string]: string | number | null | undefined }

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'fuel-stock', label: 'Fuel Stock' },
  { key: 'shift-summary', label: 'Shift Summary' },
  { key: 'deliveries', label: 'Deliveries' },
  { key: 'credit-sales', label: 'Credit Sales' },
  { key: 'tank-dips', label: 'Tank Dips' },
  { key: 'reconciliation', label: 'Reconciliation History' },
];

const TAB_ENDPOINTS: Record<ReportTab, string> = {
  'fuel-stock': '/api/backend/petroleum/reports/fuel-stock',
  'shift-summary': '/api/backend/petroleum/reports/shift-summary',
  'deliveries': '/api/backend/petroleum/reports/deliveries',
  'credit-sales': '/api/backend/petroleum/reports/credit-sales',
  'tank-dips': '/api/backend/petroleum/reports/tank-dips',
  'reconciliation': '/api/backend/petroleum/reports/reconciliation',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldCls = 'text-sm border border-slate-200 rounded-md px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

function Spinner() {
  return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;
}

function fmtVal(v: string | number | null | undefined): string {
  if (v == null) return '—';
  if (typeof v === 'number') {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);
  }
  if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return String(v);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PetroleumReportsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tab, setTab] = useState<ReportTab>('fuel-stock');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (companyId) fetch(`/api/backend/branches?companyId=${companyId}&limit=200`).then(r => r.json()).then(j => setBranches(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    else { setBranches([]); setBranchId(''); }
  }, [companyId]);

  const runReport = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError(''); setRows([]); setColumns([]);
    try {
      const params = new URLSearchParams({ companyId });
      if (branchId) params.set('branchId', branchId);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (statusFilter) params.set('status', statusFilter);

      const endpoint = TAB_ENDPOINTS[tab];
      const res = await fetch(`${endpoint}?${params}`);
      if (!res.ok) throw new Error('Failed to run report');
      const json = await res.json();
      const data: ReportRow[] = json.data?.data ?? json.data ?? json ?? [];
      setRows(data);
      if (data.length > 0) setColumns(Object.keys(data[0]));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error running report');
    } finally { setLoading(false); }
  }, [companyId, branchId, dateFrom, dateTo, statusFilter, tab]);

  function humanize(key: string) {
    return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Petroleum Reports" subtitle="Generate reports across all petroleum modules" />
        <button
          onClick={() => alert('Export functionality coming soon')}
          className="text-sm text-slate-600 px-4 py-2 rounded-md border border-slate-200 hover:bg-slate-50 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Export
        </button>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 flex-wrap border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setRows([]); setColumns([]); }}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              tab === t.key
                ? 'bg-white border border-b-white border-slate-200 text-indigo-600 -mb-px'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter panel */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
          <div>
            <label className={labelCls}>Company *</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={`${fieldCls} w-full`}>
              <option value="">— Select —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className={`${fieldCls} w-full`} disabled={!companyId}>
              <option value="">— All —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.branchCode} – {b.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>From Date</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={`${fieldCls} w-full`} />
          </div>
          <div>
            <label className={labelCls}>To Date</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={`${fieldCls} w-full`} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <input value={statusFilter} onChange={e => setStatusFilter(e.target.value)} placeholder="e.g. POSTED" className={`${fieldCls} w-full`} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={runReport}
            disabled={!companyId || loading}
            className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-md font-medium"
          >
            {loading ? 'Running…' : 'Run Report'}
          </button>
        </div>
      </Card>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <Spinner />}

      {!loading && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {columns.map(col => (
                    <th key={col} className={thCls}>{humanize(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {columns.map(col => (
                      <td key={col} className={tdCls}>{fmtVal(row[col])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && rows.length === 0 && companyId && !error && (
        <div className="text-center py-10 text-sm text-slate-400">
          {`Select filters and click "Run Report" to generate data.`}
        </div>
      )}

      {!companyId && !loading && (
        <div className="text-center py-10 text-sm text-slate-400">Select a company to run reports.</div>
      )}
    </div>
  );
}
