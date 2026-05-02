'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner } from '@/components/ui';

function fmtCurrency(n: number) {
  return `TZS ${new Intl.NumberFormat('en-US').format(n)}`;
}

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Summary {
  projects?: {
    total: number;
    active: number;
    planned?: number;
    onHold?: number;
    completed: number;
    overdue?: number;
    completionRate?: number;
  };
  activeSites?: number;
  inactiveSites?: number;
  activeSubcontractors?: number;
  pendingProgressApprovals?: number;
  totalBillings?: number;
  billingsSent?: number;
  materialIssuesPending?: number;
  financials?: {
    contractValue?: number;
    budgetAmount?: number;
    actualCost?: number;
    billedAmount?: number;
    receivedAmount?: number;
    billingCoverageRate?: number;
    collectionRate?: number;
  };
  subcontractors?: { outstandingAmount?: number };
  progress?: { averagePercentComplete?: number; approved?: number };
  billing?: { totalAmount?: number };
  recentProjects?: any[];
}

const thCls = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide';
const tdCls = 'px-3 py-3 text-[13px]';

export default function ConstructionDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/construction/dashboard?companyId=${companyId}`);
      if (!res.ok) throw new Error('Failed to load dashboard');
      const json = await res.json();
      setSummary(json.data ?? json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const quickLinks = [
    { href: '/construction/projects', label: 'Projects', desc: 'Portfolio & contracts' },
    { href: '/construction/sites', label: 'Sites', desc: 'Site registry' },
    { href: '/construction/boq', label: 'BOQ / Budget', desc: 'Bill of quantities' },
    { href: '/construction/materials', label: 'Material Issues', desc: 'Material workflow' },
    {
      href: '/construction/subcontractors',
      label: 'Subcontractors',
      desc: 'Subcontractor contracts',
    },
    { href: '/construction/progress', label: 'Progress Reports', desc: 'Progress & approvals' },
    { href: '/construction/billing', label: 'Project Billing', desc: 'Billing & invoicing' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Construction Dashboard"
          subtitle="Projects, Sites & Project Operations"
        />
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          style={{ color: 'var(--aurora-text)' }}
        >
          <option value="">— Select Company —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {!companyId && (
        <div className="text-center py-10 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Select a company to view the construction dashboard.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <PageSpinner />}

      {summary && !loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Projects" value={summary.projects?.total ?? 0} />
          <StatCard label="Active Projects" value={summary.projects?.active ?? 0} />
          <StatCard label="Completed Projects" value={summary.projects?.completed ?? 0} />
          <StatCard label="Overdue Projects" value={summary.projects?.overdue ?? 0} />
          <StatCard label="Active Sites" value={summary.activeSites ?? 0} />
          <StatCard label="Material Issues" value={summary.materialIssuesPending ?? 0} />
          <StatCard label="Active Subcontractors" value={summary.activeSubcontractors ?? 0} />
          <StatCard label="Pending Approvals" value={summary.pendingProgressApprovals ?? 0} />
          <StatCard
            label="Contract Value"
            value={fmtCurrency(summary.financials?.contractValue ?? 0)}
          />
          <StatCard label="Actual Cost" value={fmtCurrency(summary.financials?.actualCost ?? 0)} />
          <StatCard
            label="Billed Amount"
            value={fmtCurrency(summary.financials?.billedAmount ?? 0)}
          />
          <StatCard label="Collection Rate" value={`${summary.financials?.collectionRate ?? 0}%`} />
          <StatCard
            label="Avg Progress"
            value={`${summary.progress?.averagePercentComplete ?? 0}%`}
          />
        </div>
      )}

      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Quick Navigation
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickLinks.map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="font-medium text-sm" style={{ color: 'var(--aurora-text)' }}>
                  {l.label}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>
                  {l.desc}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {summary?.recentProjects && summary.recentProjects.length > 0 && (
        <Card className="overflow-hidden">
          <div
            className="px-4 py-3 border-b border-slate-100 font-semibold text-sm"
            style={{ color: 'var(--aurora-text)' }}
          >
            Recent / Active Projects
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Code
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Name
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Type
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Status
                  </th>
                  <th className={thCls} style={{ color: 'var(--aurora-text-muted)' }}>
                    Contract Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.recentProjects.map((p: any) => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`} style={{ color: 'var(--aurora-text)' }}>
                      {p.projectCode}
                    </td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                      {p.projectName}
                    </td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                      {p.projectType?.replace(/_/g, ' ') ?? '—'}
                    </td>
                    <td className={tdCls}>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className={tdCls} style={{ color: 'var(--aurora-text)' }}>
                      {p.contractValue != null ? fmtCurrency(p.contractValue) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
