'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, SkeletonCardGrid, StatCard, showToast } from '@/components/ui';

type FinanceReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface FinanceReadinessCheck {
  key: string;
  title: string;
  status: FinanceReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string | string[]>;
}

interface FinanceReadiness {
  score: number;
  target: number;
  status: FinanceReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  missingCoreRoles: string[];
  missingAdvancedRoles: string[];
  checks: FinanceReadinessCheck[];
}

interface AccountingEngineSummary {
  pendingPostingRuns: number;
  openAccountingLocks: number;
  pendingPeriodCloses: number;
  pendingAuditAdjustments: number;
  readiness?: FinanceReadiness;
}

const statusClasses: Record<FinanceReadinessStatus, string> = {
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
};

const readinessCopy: Record<FinanceReadinessStatus, string> = {
  READY: 'Production ready',
  WARNING: 'Needs setup review',
  CRITICAL: 'Blocked',
};

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value?: string) {
  if (!value) return 'Not loaded';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDetails(details: FinanceReadinessCheck['details']) {
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => {
      const display = Array.isArray(value)
        ? value.length > 0
          ? value.map(humanize).join(', ')
          : 'None'
        : value;
      return `${humanize(key)}: ${display}`;
    });
}

function StatusPill({ status }: { status: FinanceReadinessStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase leading-none ${statusClasses[status]}`}
    >
      {readinessCopy[status]}
    </span>
  );
}

export default function AccountingEngineDashboardPage() {
  const [stats, setStats] = useState<AccountingEngineSummary>({
    pendingPostingRuns: 0,
    openAccountingLocks: 0,
    pendingPeriodCloses: 0,
    pendingAuditAdjustments: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const response = await fetch('/api/backend/accounting-engine/summary');
      if (!response.ok) throw new Error(`Accounting summary failed (${response.status})`);
      const result = await response.json();
      const data = result.data ?? result;
      setStats({
        pendingPostingRuns: data.pendingPostingRuns ?? 0,
        openAccountingLocks: data.openAccountingLocks ?? data.openLocks ?? 0,
        pendingPeriodCloses: data.pendingPeriodCloses ?? data.pendingCloses ?? 0,
        pendingAuditAdjustments: data.pendingAuditAdjustments ?? data.pendingAdjustments ?? 0,
        readiness: data.readiness,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load accounting summary';
      setError(message);
      showToast('error', 'Accounting engine unavailable', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const readiness = stats.readiness;
  const readinessStatus = readiness?.status ?? 'WARNING';
  const readinessScore = readiness?.score ?? 0;

  const quickLinks = [
    {
      label: 'Chart of Accounts',
      href: '/finance/chart-of-accounts',
      desc: 'Semantic account roles and ledger structure',
    },
    {
      label: 'Fiscal Years',
      href: '/finance/fiscal-years',
      desc: 'Year setup and fiscal boundaries',
    },
    {
      label: 'Accounting Periods',
      href: '/finance/accounting-periods',
      desc: 'Open periods for posting and close',
    },
    {
      label: 'Cash Accounts',
      href: '/finance/cash-accounts',
      desc: 'Operational cash, bank, and mobile money accounts',
    },
    {
      label: 'Journal Entries',
      href: '/finance/journal-entries',
      desc: 'Manual and automatic accounting entries',
    },
    {
      label: 'Financial Reports',
      href: '/finance/reports',
      desc: 'Trial balance, statements, aging, and drill-down reports',
    },
    {
      label: 'Posting Runs',
      href: '/accounting-engine/posting-runs',
      desc: 'Automation runs and posting outcomes',
    },
    {
      label: 'Period Close',
      href: '/accounting-engine/period-close',
      desc: 'Close workflow, review, and sign-off',
    },
    {
      label: 'Accounting Locks',
      href: '/accounting-engine/accounting-locks',
      desc: 'Period and module lock controls',
    },
    {
      label: 'Bank Reconciliations',
      href: '/accounting-engine/bank-reconciliations',
      desc: 'Bank statement matching and approvals',
    },
    {
      label: 'Depreciation Schedules',
      href: '/accounting-engine/depreciation',
      desc: 'Fixed asset depreciation posting',
    },
    {
      label: 'Audit Adjustments',
      href: '/accounting-engine/audit-adjustments',
      desc: 'Audit corrections and review queue',
    },
  ];

  if (loading)
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Accounting Engine"
          subtitle="Finance setup readiness, posting controls, close workflow, and ledger automation"
        />
        <SkeletonCardGrid count={4} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" />
        <Card className="p-5">
          <div className="aurora-skeleton h-36 rounded-lg" aria-hidden />
        </Card>
      </div>
    );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Accounting Engine"
        subtitle="Finance setup readiness, posting controls, close workflow, and ledger automation"
        actions={
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={refreshing}
            className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="aurora-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending Posting Runs" value={stats.pendingPostingRuns} variant="blue" />
        <StatCard label="Open Accounting Locks" value={stats.openAccountingLocks} variant="red" />
        <StatCard label="Pending Period Closes" value={stats.pendingPeriodCloses} variant="amber" />
        <StatCard
          label="Pending Audit Adjustments"
          value={stats.pendingAuditAdjustments}
          variant="purple"
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Finance Setup Readiness
              </h2>
              <StatusPill status={readinessStatus} />
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              {readiness?.maturity ?? 'Readiness diagnostics have not loaded.'}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Last checked {formatDateTime(readiness?.updatedAt)}
            </p>
          </div>
          <div className="w-full lg:w-72">
            <div className="flex items-end justify-between">
              <div className="text-4xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                {readinessScore}%
              </div>
              <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                Target {readiness?.target ?? 90}%
              </div>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full"
              style={{ background: 'var(--aurora-bg-subtle)' }}
            >
              <div
                className={
                  readinessScore >= 90
                    ? 'h-full bg-emerald-500'
                    : readinessScore >= 70
                      ? 'h-full bg-amber-500'
                      : 'h-full bg-red-500'
                }
                style={{ width: `${Math.max(0, Math.min(100, readinessScore))}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.45fr_0.9fr]">
        <Card className="p-0 overflow-hidden">
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Production Checks
            </h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
            {(readiness?.checks ?? []).map((check) => (
              <div key={check.key} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_92px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                      {check.title}
                    </h3>
                    <StatusPill status={check.status} />
                  </div>
                  <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {check.message}
                  </p>
                  <div
                    className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {formatDetails(check.details).map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </div>
                </div>
                <div className="text-left lg:text-right">
                  <div className="text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                    {check.score}%
                  </div>
                </div>
              </div>
            ))}
            {!readiness?.checks?.length && (
              <div className="px-5 py-8 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                No readiness checks returned.
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Setup Indicators
            </h2>
            <div className="aurora-stagger mt-4 grid grid-cols-2 gap-3 text-sm">
              {Object.entries(readiness?.indicators ?? {})
                .slice(0, 12)
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-lg border p-3"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <div
                      className="text-[11px] uppercase"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      {humanize(key)}
                    </div>
                    <div
                      className="mt-1 text-lg font-semibold"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Gaps
            </h2>
            <div
              className="mt-3 space-y-3 text-sm"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              <div>
                <div
                  className="text-xs font-semibold uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Core roles
                </div>
                <div>
                  {readiness?.missingCoreRoles?.length
                    ? readiness.missingCoreRoles.map(humanize).join(', ')
                    : 'None'}
                </div>
              </div>
              <div>
                <div
                  className="text-xs font-semibold uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  Advanced roles
                </div>
                <div>
                  {readiness?.missingAdvancedRoles?.length
                    ? readiness.missingAdvancedRoles.map(humanize).join(', ')
                    : 'None'}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Finance Setup & Control Links
        </h2>
        <div className="aurora-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <Card className="h-full p-4 transition-shadow hover:shadow-md">
                <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {link.label}
                </div>
                <div className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                  {link.desc}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
