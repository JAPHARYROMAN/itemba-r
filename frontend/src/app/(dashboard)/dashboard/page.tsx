'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { AppIcon, type AppIconName, showToast } from '@/components/ui';
import {
  AuroraPage,
  AuroraPageHeader,
  AuroraToolbar,
  AuroraSection,
  AuroraCard,
  AuroraButton,
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
import { getStatusVariant } from '@/lib/design-system';
import { useCountUp } from '@/hooks/use-count-up';

/** Count-up treatment for the operational-focus strip numbers. */
function PulseValue({ value }: { value: number }) {
  const counted = useCountUp(value);
  return <>{Math.round(counted).toLocaleString()}</>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Division {
  id: string;
  name: string;
  code: string;
}

interface DashCompany {
  id: string;
  name: string;
  code: string;
  status: string;
  industryType: string | null;
  divisions: Division[];
}

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
  overview: {
    companies: number;
    divisions: number;
    branches: number;
    activeUsers: number;
  };
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
  companies: DashCompany[];
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
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(d: Date | null) {
  if (!d) return 'Not loaded yet';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Company meta ─────────────────────────────────────────────────────────────

const COMPANY_META: Record<string, { icon: AppIconName; links: { label: string; href: string }[] }> = {
  default: { icon: 'company', links: [] },
  mwanjalisi: {
    icon: 'cash',
    links: [{ label: 'Fixed Assets', href: '/group-control/fixed-assets' }],
  },
  itemba: {
    icon: 'delivery',
    links: [{ label: 'Contracts', href: '/group-control/contracts' }],
  },
  westsides: {
    icon: 'sale',
    links: [{ label: 'Documents', href: '/group-control/documents' }],
  },
};

function companyMeta(name: string) {
  const n = name.toLowerCase();
  if (n.includes('mwanjalisi')) return COMPANY_META.mwanjalisi;
  if (n.includes('itemba')) return COMPANY_META.itemba;
  if (n.includes('west')) return COMPANY_META.westsides;
  return COMPANY_META.default;
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, loading: authLoading, hasPermission } = useAuth();
  const canViewControl = hasPermission('group-control.view');

  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/backend/dashboard/executive-summary');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: Summary };
      setData(json.data);
      setLastUpdated(new Date());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      showToast('error', 'Executive dashboard unavailable', message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (!canViewControl) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    void loadSummary();
  }, [authLoading, user, canViewControl, loadSummary]);

  const now = new Date();
  const greeting =
    now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const totalAlerts = !data
    ? 0
    : data.alerts.expiringContracts.length +
      data.alerts.upcomingMaturities.length +
      data.alerts.expiringDocuments.length +
      data.alerts.highRiskLoans.length;

  const operationalFocus = useMemo(() => {
    if (!data) return [];

    return [
      {
        label: 'Immediate alerts',
        value: totalAlerts,
        detail: 'items need review',
        status: totalAlerts > 0 ? 'ACTION_REQUIRED' : 'CLEAR',
        href: '#alerts',
      },
      {
        label: 'Critical audit',
        value: data.groupControl.audit.critical24h,
        detail: 'critical events in 24h',
        status: data.groupControl.audit.critical24h > 0 ? 'CRITICAL' : 'CLEAR',
        href: '/audit-logs?severity=CRITICAL',
      },
      {
        label: 'Pending contracts',
        value: data.groupControl.contracts.pendingApproval,
        detail: 'contracts awaiting action',
        status: data.groupControl.contracts.pendingApproval > 0 ? 'PENDING' : 'CLEAR',
        href: '/group-control/contracts',
      },
      {
        label: 'Control gaps',
        value:
          data.groupControl.fixedAssets.uninsured +
          data.groupControl.loans.overdue +
          data.groupControl.documents.expiring,
        detail: 'asset, loan, and document exceptions',
        status:
          data.groupControl.fixedAssets.uninsured +
            data.groupControl.loans.overdue +
            data.groupControl.documents.expiring >
          0
            ? 'REVIEW'
            : 'CLEAR',
        href: '/group-control',
      },
    ];
  }, [data, totalAlerts]);

  return (
    <AuroraPage>
      <AuroraPageHeader
        title={
          user?.fullName
            ? `${greeting}, ${user.fullName.split(' ')[0]}`
            : `${greeting} — Command Centre`
        }
        subtitle={dateStr}
        eyebrow="Live"
        live
        actions={
          <div className="flex gap-2">
            <Link
              href="/group-control"
              className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              style={{ background: 'var(--aurora-primary)', color: '#fff' }}
            >
              Group Control →
            </Link>
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
          </div>
        }
      />

      <AuroraToolbar
        title="Today's operation"
        description="Live session, dashboard freshness, and the most important control signals."
        meta={
          <>
            <StatusBadge status={user ? 'ACTIVE' : 'PENDING'} size="sm" />
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {user ? user.fullName : 'Waiting for session'}
            </span>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Updated {fmtDateTime(lastUpdated)}
            </span>
          </>
        }
        actions={
          <AuroraButton
            size="sm"
            variant="secondary"
            onClick={loadSummary}
            loading={loading && Boolean(data)}
            disabled={authLoading || !user || !canViewControl}
          >
            Refresh
          </AuroraButton>
        }
        className="mt-5"
      >
        {data && (
          <div className="aurora-stagger grid grid-cols-1 gap-3 animate-fade-up md:grid-cols-4">
            {operationalFocus.map((item) => {
              const edgeColor =
                item.status === 'CRITICAL'
                  ? 'var(--aurora-danger)'
                  : item.status === 'ACTION_REQUIRED'
                    ? 'var(--aurora-warning, #f59e0b)'
                    : item.status === 'CLEAR'
                      ? 'var(--aurora-success, #10b981)'
                      : 'var(--aurora-border)';
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="rounded-aurora border px-4 py-3 aurora-transition hover:shadow-sm hover:-translate-y-0.5"
                  style={{
                    background: 'var(--aurora-bg-subtle)',
                    borderColor: 'var(--aurora-border)',
                    borderLeft: `3px solid ${edgeColor}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className="text-xs font-semibold uppercase"
                        style={{ color: 'var(--aurora-text-muted)' }}
                      >
                        {item.label}
                      </p>
                      <p
                        className="mt-2 aurora-metric text-2xl"
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        <PulseValue value={item.value} />
                      </p>
                      <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                        {item.detail}
                      </p>
                    </div>
                    <StatusBadge status={item.status} size="sm" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </AuroraToolbar>

      {loading && <LoadingState title="Loading executive summary…" />}
      {error && (
        <ErrorState
          title="Dashboard Unavailable"
          description={`Failed to load: ${error}`}
          className="mx-6 mt-6"
        />
      )}
      {!loading && !error && user && !canViewControl && (
        <RestrictedDataState requiredPermission="group-control.view" className="mx-6 mt-6" />
      )}

      {data && (
        <div className="space-y-8">
          {/* ── 1. Group Overview ───────────────────────────────────────────── */}
          <AuroraSection title="Group Overview">
            <div className="p-5">
              <SummaryGrid cols={4} className="aurora-stagger">
                <StatCard
                  title="Companies"
                  value={data.overview.companies}
                  subtitle="BRELA-registered"
                />
                <StatCard title="Divisions" value={data.overview.divisions} />
                <StatCard title="Branches / Sites" value={data.overview.branches} />
                <StatCard title="Active Users" value={data.overview.activeUsers} />
              </SummaryGrid>
            </div>
          </AuroraSection>

          {/* ── 2. Alerts ───────────────────────────────────────────────────── */}
          {totalAlerts > 0 && (
            <AuroraSection id="alerts" title={`Alerts (${totalAlerts})`} className="scroll-mt-6">
              <div className="aurora-stagger grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
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

          {/* ── 3. Group Control Summary ─────────────────────────────────────── */}
          <AuroraSection
            title="Group Control Summary"
            actions={
              <Link
                href="/group-control"
                className="text-xs font-medium"
                style={{ color: 'var(--aurora-primary)' }}
              >
                Open Group Control →
              </Link>
            }
          >
            {!canViewControl ? (
              <RestrictedDataState requiredPermission="group-control.view" />
            ) : (
              <div className="p-5 space-y-4">
                <SummaryGrid cols={4} className="aurora-stagger">
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
                <SummaryGrid cols={4} className="aurora-stagger">
                  <StatCard title="Active Contracts" value={data.groupControl.contracts.active} />
                  <StatCard
                    title="Expiring in 30 Days"
                    value={data.groupControl.contracts.expiringIn30}
                    variant={data.groupControl.contracts.expiringIn30 > 0 ? 'danger' : 'default'}
                  />
                  <StatCard
                    title="Expiring in 60 Days"
                    value={data.groupControl.contracts.expiringIn60}
                    variant={data.groupControl.contracts.expiringIn60 > 0 ? 'warning' : 'default'}
                  />
                  <StatCard
                    title="Pending Approval"
                    value={data.groupControl.contracts.pendingApproval}
                    variant={
                      data.groupControl.contracts.pendingApproval > 0 ? 'warning' : 'default'
                    }
                  />
                </SummaryGrid>
                <SummaryGrid cols={4} className="aurora-stagger">
                  <StatCard
                    title="Fixed Assets"
                    value={data.groupControl.fixedAssets.total}
                    subtitle={`TZS ${fmt(data.groupControl.fixedAssets.totalValue, true)} book value`}
                  />
                  <StatCard
                    title="Assets as Collateral"
                    value={data.groupControl.fixedAssets.collateral}
                    variant={data.groupControl.fixedAssets.collateral > 0 ? 'warning' : 'default'}
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
                <SummaryGrid cols={4} className="aurora-stagger">
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
            )}
          </AuroraSection>

          {/* ── 4. Group Companies ───────────────────────────────────────────── */}
          <AuroraSection
            title="Group Companies"
            actions={
              <Link
                href="/companies"
                className="text-xs font-medium"
                style={{ color: 'var(--aurora-primary)' }}
              >
                Company Registry →
              </Link>
            }
          >
            <div className="aurora-stagger grid grid-cols-1 gap-5 p-5 md:grid-cols-3">
              {data.companies.map((c) => {
                const meta = companyMeta(c.name);
                return (
                  <AuroraCard key={c.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <AppIcon
                          name={meta.icon}
                          size={24}
                          className="mt-0.5"
                          strokeWidth={1.8}
                        />
                        <h3
                          className="mt-1 font-bold text-sm"
                          style={{ color: 'var(--aurora-text)' }}
                        >
                          {c.name}
                        </h3>
                        {c.industryType && (
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {c.industryType}
                          </p>
                        )}
                      </div>
                      <StatusBadge
                        status={c.status}
                        variant={getStatusVariant(c.status)}
                        size="sm"
                      />
                    </div>
                    {c.divisions.length > 0 && (
                      <div>
                        <p
                          className="text-xs font-semibold mb-1.5"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          Divisions
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {c.divisions.map((d) => (
                            <span
                              key={d.id}
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{
                                background: 'var(--aurora-bg-muted)',
                                color: 'var(--aurora-text-secondary)',
                                border: '1px solid var(--aurora-border)',
                              }}
                            >
                              {d.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div
                      className="flex gap-3 mt-auto pt-3 border-t"
                      style={{ borderColor: 'var(--aurora-border)' }}
                    >
                      <Link
                        href={`/companies/${c.id}`}
                        className="text-xs font-medium"
                        style={{ color: 'var(--aurora-primary)' }}
                      >
                        View Profile →
                      </Link>
                      {meta.links.map((l) => (
                        <Link
                          key={l.label}
                          href={l.href}
                          className="text-xs font-medium"
                          style={{ color: 'var(--aurora-text-muted)' }}
                        >
                          {l.label}
                        </Link>
                      ))}
                    </div>
                  </AuroraCard>
                );
              })}
            </div>
          </AuroraSection>

          {/* ── 5. Recent Sensitive Activity ─────────────────────────────────── */}
          {canViewControl && data.recentActivity.length > 0 && (
            <AuroraSection
              title="Recent Sensitive Activity"
              actions={
                <Link
                  href="/audit-logs?severity=HIGH"
                  className="text-xs font-medium"
                  style={{ color: 'var(--aurora-primary)' }}
                >
                  Full Audit Trail →
                </Link>
              }
            >
              <DataTable<AuditEntry & Record<string, unknown>>
                columns={auditColumns as Column<AuditEntry & Record<string, unknown>>[]}
                data={data.recentActivity as (AuditEntry & Record<string, unknown>)[]}
                keyField="id"
                compact
              />
            </AuroraSection>
          )}
        </div>
      )}
    </AuroraPage>
  );
}
