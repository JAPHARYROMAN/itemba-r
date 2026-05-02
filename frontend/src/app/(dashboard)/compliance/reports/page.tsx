'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Btn, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }

type Tab = 'obligations-summary' | 'tax-transactions' | 'document-status';

const TABS: { id: Tab; label: string }[] = [
  { id: 'obligations-summary', label: 'Obligations Summary' },
  { id: 'tax-transactions', label: 'Tax Transactions' },
  { id: 'document-status', label: 'Document Status' },
];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const from = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0];
  return { from, to };
}

export default function ComplianceReportsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('compliance.reports.view');

  const [tab, setTab] = useState<Tab>('obligations-summary');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [{ from, to }, setRange] = useState(defaultRange);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<unknown>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
  }, []);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setReport(null);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (from) params.set('dateFrom', from);
      if (to) params.set('dateTo', to);
      const res = await fetch(`/api/backend/compliance/reports/${tab}?${params}`);
      if (!res.ok) throw new Error('Failed to load report');
      const j = await res.json();
      setReport(j.data ?? j);
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setLoading(false); }
  }, [tab, companyId, from, to]);

  useEffect(() => { if (canView) run(); }, [run, canView]);

  if (!canView) return <div className="p-6"><PageHeader title="Compliance Reports" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Compliance Reports" subtitle="Aggregated compliance reporting" />

      <div className="flex flex-wrap gap-2 border-b" style={{ borderColor: 'var(--aurora-border)' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-brand-500' : 'border-transparent'}`}
            style={{ color: tab === t.id ? 'var(--aurora-text)' : 'var(--aurora-text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>Company</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>From</label>
            <input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={filterSelectCls} style={filterStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--aurora-text-muted)' }}>To</label>
            <input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={filterSelectCls} style={filterStyle} />
          </div>
          <Btn variant="primary" onClick={run} loading={loading}>Run</Btn>
        </div>
      </Card>

      {error && <Card className="p-4"><div className="text-red-600 text-sm">{error}</div></Card>}

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : report == null ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No data</div>
        ) : (
          <pre className="p-4 text-xs overflow-x-auto" style={{ color: 'var(--aurora-text)' }}>{JSON.stringify(report, null, 2)}</pre>
        )}
      </Card>
    </div>
  );
}
