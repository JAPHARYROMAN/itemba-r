'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface Obligation {
  id: string;
  obligationCode: string;
  companyId: string;
  company?: { name: string };
  obligationType: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function daysUntil(d: string) {
  const ms = new Date(d).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function ComplianceCalendarPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('compliance_calendar.view');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [items, setItems] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'overdue' | 'upcoming'>('all');
  const [companyId, setCompanyId] = useState('');
  const [priority, setPriority] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(j.data?.data ?? j.data ?? []));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (companyId) params.set('companyId', companyId);
    if (priority) params.set('priority', priority);
    setLoading(true);
    fetch(`/api/backend/compliance/obligations?${params}`).then((r) => r.json())
      .then((j) => setItems(j.data?.data ?? j.data ?? []))
      .finally(() => setLoading(false));
  }, [companyId, priority]);

  const filtered = useMemo(() => {
    if (tab === 'overdue') return items.filter((o) => o.status === 'OVERDUE' || (o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && daysUntil(o.dueDate) < 0));
    if (tab === 'upcoming') return items.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && daysUntil(o.dueDate) >= 0 && daysUntil(o.dueDate) <= 30);
    return items;
  }, [items, tab]);

  const stats = useMemo(() => ({
    total: items.length,
    overdue: items.filter((o) => o.status === 'OVERDUE' || (o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && daysUntil(o.dueDate) < 0)).length,
    upcoming: items.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && daysUntil(o.dueDate) >= 0 && daysUntil(o.dueDate) <= 30).length,
  }), [items]);

  if (!canView) return <div className="p-6"><PageHeader title="Compliance Calendar" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Compliance Calendar" subtitle="Upcoming filings, renewals, and deadlines" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Overdue" value={stats.overdue} hint="Past due" />
        <StatCard label="Due in 30 Days" value={stats.upcoming} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-2">
          {(['all', 'overdue', 'upcoming'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs uppercase tracking-wide px-3 py-1.5 rounded-lg border ${tab === t ? 'bg-brand-600 text-white border-brand-600' : ''}`}
              style={tab === t ? {} : { borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
          <option value="">All Companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? <PageSpinner /> : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No obligations</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)', borderBottom: '1px solid var(--aurora-border)' }}>
                  <th className="p-3">Code</th>
                  <th className="p-3">Title</th>
                  <th className="p-3">Company</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Due</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const d = daysUntil(o.dueDate);
                  const overdue = o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && d < 0;
                  const soon = !overdue && o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && d <= 30;
                  return (
                    <tr key={o.id} className="border-t" style={{ borderColor: 'var(--aurora-border)', background: overdue ? 'rgba(239,68,68,0.06)' : soon ? 'rgba(245,158,11,0.06)' : undefined }}>
                      <td className="p-3 font-mono text-xs">{o.obligationCode}</td>
                      <td className="p-3">{o.title}</td>
                      <td className="p-3">{o.company?.name ?? '—'}</td>
                      <td className="p-3 text-xs">{o.obligationType}</td>
                      <td className="p-3">{new Date(o.dueDate).toLocaleDateString()} <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>({d}d)</span></td>
                      <td className="p-3"><StatusBadge status={o.priority} /></td>
                      <td className="p-3"><StatusBadge status={o.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
