'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, SkeletonCardGrid, StatCard, Btn, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface DashboardStats {
  overdueObligations: number;
  upcomingObligations: number;
  missingDocuments: number;
  openTaxReturns: number;
  expiringDocuments: number;
  totalObligations?: number;
  criticalObligations?: number;
  completionRate?: number;
  documents?: {
    available?: number;
    expiring?: number;
    missing?: number;
  };
  taxReturns?: {
    open?: number;
    outstandingAmount?: number;
    totalDue?: number;
  };
  licenses?: {
    active?: number;
    expiringWithin60Days?: number;
    expired?: number;
  };
  osha?: {
    activeRegistrations?: number;
    expiringWithin60Days?: number;
  };
  events?: {
    last30Days?: number;
  };
}

function fmtCurrency(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`;
}

const SECTIONS = [
  { href: '/compliance/calendar', label: 'Calendar', desc: 'Obligation timeline' },
  { href: '/compliance/obligations', label: 'Obligations', desc: 'Filings, renewals, deadlines' },
  {
    href: '/compliance/document-requirements',
    label: 'Document Requirements',
    desc: 'Required documents catalog',
  },
  { href: '/compliance/document-status', label: 'Document Status', desc: 'Per-company tracking' },
  { href: '/compliance/events', label: 'Events Log', desc: 'Filings, payments, audits' },
  { href: '/compliance/evidence-packs', label: 'Evidence Packs', desc: 'Audit & tax bundles' },
  { href: '/compliance/exports', label: 'Exports', desc: 'Compliance data extracts' },
  { href: '/compliance/reports', label: 'Reports', desc: 'Summaries & analytics' },
  { href: '/compliance/statutory-rules', label: 'Statutory Rules', desc: 'NSSF, PAYE, SDL rules' },
  {
    href: '/compliance/tax-authorities',
    label: 'Tax Authorities',
    desc: 'TRA, councils, agencies',
  },
  { href: '/compliance/tax-types', label: 'Tax Types', desc: 'VAT, PAYE, WHT…' },
  { href: '/compliance/tax-codes', label: 'Tax Codes', desc: 'Company-level codes' },
  { href: '/compliance/tax-rates', label: 'Tax Rates', desc: 'Per-type rates & history' },
  { href: '/compliance/tax-registrations', label: 'Tax Registrations', desc: 'TIN, VRN, etc.' },
  {
    href: '/compliance/tax-filing-periods',
    label: 'Filing Periods',
    desc: 'Monthly, quarterly windows',
  },
  {
    href: '/compliance/tax-transactions',
    label: 'Tax Transactions',
    desc: 'Output / input / withheld',
  },
];

export default function CompliancePage() {
  const { hasPermission } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const canView = hasPermission('compliance.dashboard.view');

  useEffect(() => {
    let cancelled = false;

    async function loadComplianceDashboard() {
      try {
        const response = await fetch('/api/backend/compliance/dashboard');
        if (!response.ok) throw new Error(`Compliance dashboard failed (${response.status})`);
        const payload = await response.json();
        if (!cancelled) setStats(payload.data ?? null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load compliance dashboard';
        showToast('error', 'Compliance dashboard unavailable', message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadComplianceDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Compliance" subtitle="Statutory & tax governance" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  if (loading)
    return (
      <div className="p-6">
        <PageHeader title="Compliance" subtitle="Statutory & tax governance" />
        <div className="mt-6">
          <SkeletonCardGrid count={10} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5" />
        </div>
      </div>
    );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Compliance"
        subtitle="Statutory obligations, tax filings, document tracking, and audit evidence"
      />

      <div className="aurora-stagger grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Overdue Obligations"
          value={stats?.overdueObligations ?? 0}
          hint="Past due"
        />
        <StatCard
          label="Upcoming (30d)"
          value={stats?.upcomingObligations ?? 0}
          hint="Next month"
        />
        <StatCard label="Critical Open" value={stats?.criticalObligations ?? 0} />
        <StatCard label="Completion Rate" value={`${stats?.completionRate ?? 0}%`} />
        <StatCard label="Missing Documents" value={stats?.missingDocuments ?? 0} />
        <StatCard label="Open Tax Returns" value={stats?.openTaxReturns ?? 0} />
        <StatCard
          label="Tax Outstanding"
          value={fmtCurrency(stats?.taxReturns?.outstandingAmount ?? 0)}
        />
        <StatCard label="Expiring Docs" value={stats?.expiringDocuments ?? 0} hint="Within 60d" />
        <StatCard label="Active Licenses" value={stats?.licenses?.active ?? 0} />
        <StatCard label="Expiring Licenses" value={stats?.licenses?.expiringWithin60Days ?? 0} />
        <StatCard label="OSHA Expiring" value={stats?.osha?.expiringWithin60Days ?? 0} />
        <StatCard label="Events (30d)" value={stats?.events?.last30Days ?? 0} />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>
          Modules
        </h3>
        <div className="aurora-stagger grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer h-full">
                <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {s.label}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>
                  {s.desc}
                </div>
                <div className="mt-2">
                  <Btn variant="ghost" size="xs">
                    Open →
                  </Btn>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
