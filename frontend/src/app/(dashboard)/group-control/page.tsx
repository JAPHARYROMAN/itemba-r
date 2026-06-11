'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AuroraPage,
  AuroraPageHeader,
  AuroraSection,
  AuroraCard,
  StatCard,
  AlertCard,
  SummaryGrid,
  LoadingState,
  ErrorState,
  RestrictedDataState,
  StatusBadge,
  DataTable,
} from '@/components/aurora';
import type { Column } from '@/components/aurora/data-display/DataTable';
import { AppIcon, type AppIconName } from '@/components/ui';
import { getStatusVariant } from '@/lib/design-system';
import { useAuth } from '@/hooks/use-auth';

// ─── Types (mirror dashboard's executive-summary payload) ─────────────────────

interface AlertContract {
  id: string;
  title: string;
  endDate: string | null;
  counterpartyName: string;
  contractType: string;
  daysLeft: number | null;
}
interface AlertLoan {
  id: string;
  lenderName: string;
  maturityDate: string | null;
  outstandingBalance: string | null;
  currency: string;
}
interface AlertDoc {
  id: string;
  title: string;
  category: string;
  expiryDate: string | null;
  daysLeft: number | null;
}
interface AlertLoanHighRisk {
  id: string;
  lenderName: string;
  riskLevel: string;
  outstandingBalance: string | null;
  currency: string;
  maturityDate: string | null;
}
interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  severity: string;
  createdAt: string;
  ipAddress: string | null;
  user: { fullName: string; email: string } | null;
  company: { name: string; code: string } | null;
}

interface Summary {
  groupControl: {
    bankAccounts: { total: number; active: number };
    loans: { active: number; outstanding: number; overdue: number };
    debts: { outstanding: number; totalAmount: number };
    contracts: {
      active: number;
      expiringIn30: number;
      expiringIn60: number;
      pendingApproval: number;
    };
    fixedAssets: {
      total: number;
      totalValue: number;
      collateral: number;
      uninsured: number;
      disposed: number;
    };
    documents: { total: number; sensitive: number; expiring: number };
    audit: { events24h: number; critical24h: number };
  };
  alerts: {
    expiringContracts: AlertContract[];
    upcomingMaturities: AlertLoan[];
    expiringDocuments: AlertDoc[];
    highRiskLoans: AlertLoanHighRisk[];
  };
  recentActivity: AuditEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, currency = false) {
  if (currency) {
    return new Intl.NumberFormat('en-TZ', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }
  return n.toLocaleString();
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Audit table columns ──────────────────────────────────────────────────────

type AuditRow = AuditEntry & Record<string, unknown>;

const auditColumns: Column<AuditRow>[] = [
  {
    key: 'createdAt',
    header: 'Time',
    accessor: (row) => (
      <span className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        {new Date(row.createdAt).toLocaleString()}
      </span>
    ),
  },
  {
    key: 'severity',
    header: 'Severity',
    accessor: (row) => (
      <StatusBadge status={row.severity} variant={getStatusVariant(row.severity)} size="sm" />
    ),
  },
  {
    key: 'action',
    header: 'Action',
    accessor: (row) => (
      <span className="text-xs font-medium" style={{ color: 'var(--aurora-text)' }}>
        {row.action.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    key: 'entityType',
    header: 'Entity',
    accessor: (row) => (
      <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
        {row.entityType}
      </span>
    ),
  },
  {
    key: 'user',
    header: 'User',
    accessor: (row) => (
      <span className="text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
        {row.user?.fullName ?? 'System'}
      </span>
    ),
  },
  {
    key: 'company',
    header: 'Company',
    accessor: (row) => (
      <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        {row.company?.name ?? '—'}
      </span>
    ),
  },
];

// ─── Module navigation cards ──────────────────────────────────────────────────

const SECTIONS: Array<{ href: string; label: string; desc: string; icon: AppIconName }> = [
  { href: '/group-control/bank-accounts', label: 'Bank Accounts', desc: 'Group-wide accounts & balances', icon: 'bank' },
  { href: '/group-control/loans-debts', label: 'Loans & Debts', desc: 'Obligations, schedules, exposure', icon: 'loan' },
  { href: '/group-control/contracts', label: 'Contracts', desc: 'Counterparties, expiry, risk', icon: 'document' },
  { href: '/group-control/fixed-assets', label: 'Fixed Assets', desc: 'Asset register & depreciation', icon: 'inventory' },
  { href: '/group-control/documents', label: 'Documents Vault', desc: 'Confidential files & renewals', icon: 'lock' },
  { href: '/audit-logs', label: 'Audit Trail', desc: 'Sensitive activity log', icon: 'report' },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GroupControlPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('group-control.view');

  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/backend/dashboard/executive-summary');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: Summary };
        setData(json.data);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [canView]);

  const totalAlerts = !data
    ? 0
    : data.alerts.expiringContracts.length +
      data.alerts.upcomingMaturities.length +
      data.alerts.expiringDocuments.length +
      data.alerts.highRiskLoans.length;

  return (
    <AuroraPage>
      <AuroraPageHeader
        title="Group Control"
        subtitle="Group-wide governance — banking, obligations, contracts, assets & documents"
        eyebrow="Restricted"
        actions={
          <Link
            href="/audit-logs"
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            style={{
              background: 'var(--aurora-bg-subtle)',
              color: 'var(--aurora-text)',
              border: '1px solid var(--aurora-border)',
            }}
          >
            Audit Trail
          </Link>
        }
      />

      {!canView ? (
        <div className="px-6">
          <RestrictedDataState requiredPermission="group-control.view" />
        </div>
      ) : (
        <>
          {loading && <LoadingState title="Loading group control summary…" />}
          {error && (
            <ErrorState
              title="Group Control Unavailable"
              description={`Failed to load: ${error}`}
              className="mx-6 mt-6"
            />
          )}

          {data && (
            <div className="space-y-8">
              {/* ── 1. Alerts ───────────────────────────────────────────────── */}
              {totalAlerts > 0 && (
                <AuroraSection title={`Alerts (${totalAlerts})`}>
                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.alerts.expiringContracts.length > 0 && (
                      <AlertCard
                        title={`Contracts Expiring Soon (${data.alerts.expiringContracts.length})`}
                        items={data.alerts.expiringContracts.map((c) => ({
                          id: c.id,
                          title: c.title,
                          description: `${c.counterpartyName} · expires ${fmtDate(c.endDate)} (${c.daysLeft != null ? `${c.daysLeft}d` : '—'})`,
                          severity: ((c.daysLeft ?? 999) <= 14 ? 'danger' : 'warning') as
                            | 'danger'
                            | 'warning',
                        }))}
                      />
                    )}
                    {data.alerts.upcomingMaturities.length > 0 && (
                      <AlertCard
                        title={`Loan Maturities Approaching (${data.alerts.upcomingMaturities.length})`}
                        items={data.alerts.upcomingMaturities.map((l) => ({
                          id: l.id,
                          title: l.lenderName,
                          description: `Matures ${fmtDate(l.maturityDate)} · Balance ${l.currency} ${fmt(Number(l.outstandingBalance ?? 0), true)}`,
                          severity: 'danger' as const,
                        }))}
                      />
                    )}
                    {data.alerts.expiringDocuments.length > 0 && (
                      <AlertCard
                        title={`Documents Expiring (${data.alerts.expiringDocuments.length})`}
                        items={data.alerts.expiringDocuments.map((d) => ({
                          id: d.id,
                          title: d.title,
                          description: `${d.category.replace(/_/g, ' ')} · expires ${fmtDate(d.expiryDate)} (${d.daysLeft != null ? `${d.daysLeft}d` : '—'})`,
                          severity: ((d.daysLeft ?? 999) <= 14 ? 'danger' : 'warning') as
                            | 'danger'
                            | 'warning',
                        }))}
                      />
                    )}
                    {data.alerts.highRiskLoans.length > 0 && (
                      <AlertCard
                        title={`High-Risk Obligations (${data.alerts.highRiskLoans.length})`}
                        items={data.alerts.highRiskLoans.map((l) => ({
                          id: l.id,
                          title: l.lenderName,
                          description: `Balance ${l.currency} ${fmt(Number(l.outstandingBalance ?? 0), true)} · Matures ${fmtDate(l.maturityDate)}`,
                          severity: 'danger' as const,
                        }))}
                      />
                    )}
                  </div>
                </AuroraSection>
              )}

              {/* ── 2. Group Control Summary (16 stat cards) ────────────────── */}
              <AuroraSection title="Group Control Summary">
                <div className="p-5 space-y-4">
                  <SummaryGrid cols={4}>
                    <StatCard
                      title="Bank Accounts"
                      value={data.groupControl.bankAccounts.active}
                      subtitle={`${data.groupControl.bankAccounts.total} total`}
                    />
                    <StatCard
                      title="Active Loans"
                      value={data.groupControl.loans.active}
                      subtitle={
                      data.groupControl.loans.overdue > 0
                          ? `${data.groupControl.loans.overdue} overdue`
                          : 'none overdue'
                      }
                      variant={data.groupControl.loans.overdue > 0 ? 'warning' : 'default'}
                    />
                    <StatCard
                      title="Loan Outstanding"
                      value={`TZS ${fmt(data.groupControl.loans.outstanding, true)}`}
                    />
                    <StatCard
                      title="Outstanding Debts"
                      value={data.groupControl.debts.outstanding}
                      subtitle={`TZS ${fmt(data.groupControl.debts.totalAmount, true)}`}
                    />
                  </SummaryGrid>
                  <SummaryGrid cols={4}>
                    <StatCard title="Active Contracts" value={data.groupControl.contracts.active} />
                    <StatCard
                      title="Expiring in 30 Days"
                      value={data.groupControl.contracts.expiringIn30}
                      variant={
                        data.groupControl.contracts.expiringIn30 > 0 ? 'danger' : 'default'
                      }
                    />
                    <StatCard
                      title="Expiring in 60 Days"
                      value={data.groupControl.contracts.expiringIn60}
                      variant={
                        data.groupControl.contracts.expiringIn60 > 0 ? 'warning' : 'default'
                      }
                    />
                    <StatCard
                      title="Pending Approval"
                      value={data.groupControl.contracts.pendingApproval}
                      variant={
                        data.groupControl.contracts.pendingApproval > 0 ? 'warning' : 'default'
                      }
                    />
                  </SummaryGrid>
                  <SummaryGrid cols={4}>
                    <StatCard
                      title="Fixed Assets"
                      value={data.groupControl.fixedAssets.total}
                      subtitle={`TZS ${fmt(data.groupControl.fixedAssets.totalValue, true)} book value`}
                    />
                    <StatCard
                      title="Assets as Collateral"
                      value={data.groupControl.fixedAssets.collateral}
                      variant={
                        data.groupControl.fixedAssets.collateral > 0 ? 'warning' : 'default'
                      }
                    />
                    <StatCard
                      title="Uninsured Assets"
                      value={data.groupControl.fixedAssets.uninsured}
                      variant={data.groupControl.fixedAssets.uninsured > 0 ? 'danger' : 'default'}
                    />
                    <StatCard
                      title="Sensitive Documents"
                      value={data.groupControl.documents.sensitive}
                      subtitle={`${data.groupControl.documents.expiring} expiring`}
                      variant={data.groupControl.documents.expiring > 0 ? 'warning' : 'default'}
                    />
                  </SummaryGrid>
                  <SummaryGrid cols={4}>
                    <StatCard title="Audit Events (24h)" value={data.groupControl.audit.events24h} />
                    <StatCard
                      title="Critical Events (24h)"
                      value={data.groupControl.audit.critical24h}
                      variant={data.groupControl.audit.critical24h > 0 ? 'danger' : 'default'}
                    />
                    <StatCard title="Total Documents" value={data.groupControl.documents.total} />
                    <StatCard
                      title="Disposed Assets"
                      value={data.groupControl.fixedAssets.disposed}
                    />
                  </SummaryGrid>
                </div>
              </AuroraSection>

              {/* ── 3. Module navigation ────────────────────────────────────── */}
              <AuroraSection title="Modules">
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {SECTIONS.map((s) => (
                    <Link key={s.href} href={s.href}>
                      <AuroraCard className="h-full hover:shadow-md transition-shadow cursor-pointer">
                        <div className="flex items-start gap-3">
                          <AppIcon name={s.icon} size={24} className="mt-0.5" />
                          <div>
                            <div
                              className="text-sm font-semibold"
                              style={{ color: 'var(--aurora-text)' }}
                            >
                              {s.label}
                            </div>
                            <div
                              className="text-xs mt-1"
                              style={{ color: 'var(--aurora-text-muted)' }}
                            >
                              {s.desc}
                            </div>
                          </div>
                        </div>
                      </AuroraCard>
                    </Link>
                  ))}
                </div>
              </AuroraSection>

              {/* ── 4. Recent Sensitive Activity ────────────────────────────── */}
              {data.recentActivity.length > 0 && (
                <AuroraSection
                  title="Recent Sensitive Activity"
                  actions={
                    <Link
                      href="/audit-logs"
                      className="text-xs font-medium"
                      style={{ color: 'var(--aurora-primary)' }}
                    >
                      View Audit Trail →
                    </Link>
                  }
                >
                  <DataTable
                    data={data.recentActivity as AuditRow[]}
                    columns={auditColumns}
                    keyField="id"
                  />
                </AuroraSection>
              )}
            </div>
          )}
        </>
      )}
    </AuroraPage>
  );
}
