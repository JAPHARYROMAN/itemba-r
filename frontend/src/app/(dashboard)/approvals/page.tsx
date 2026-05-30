'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, PageSpinner, StatCard } from '@/components/ui';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface ReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

interface ApprovalReadiness {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  checks: ReadinessCheck[];
}

const statusClasses: Record<ReadinessStatus, string> = {
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
};

function StatusPill({ status }: { status: ReadinessStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase leading-none ${statusClasses[status]}`}
    >
      {status === 'READY' ? 'Production ready' : status === 'WARNING' ? 'Needs review' : 'Blocked'}
    </span>
  );
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function detailPreview(details: ReadinessCheck['details']) {
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${value}`);
}

function formatDateTime(value?: string) {
  if (!value) return 'Not loaded';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function ApprovalsDashboardPage() {
  const [readiness, setReadiness] = useState<ApprovalReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadReadiness = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const response = await fetch('/api/backend/approvals/requests/readiness');
      if (!response.ok) throw new Error(`Approvals readiness failed (${response.status})`);
      const result = await response.json();
      setReadiness(result.data ?? result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval readiness');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  if (loading) return <PageSpinner />;

  const indicators = readiness?.indicators ?? {};
  const score = readiness?.score ?? 0;
  const status = readiness?.status ?? 'WARNING';

  const quickLinks = [
    {
      label: 'Workflows',
      href: '/approvals/workflows',
      desc: 'Manage approval workflow definitions',
    },
    { label: 'Requests', href: '/approvals/requests', desc: 'View all approval requests' },
    {
      label: 'Pending Approvals',
      href: '/approvals/pending',
      desc: 'Requests awaiting your approval',
    },
    {
      label: 'Delegations',
      href: '/approvals/delegations',
      desc: 'Approval continuity and cover assignments',
    },
    {
      label: 'Data Quality',
      href: '/bi/data-quality',
      desc: 'Resolve quality blockers before sign-off',
    },
    { label: 'Tasks', href: '/tasks', desc: 'Follow-up actions and workflow remediation' },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Approvals and Data Quality"
        subtitle="Workflow governance, approval SLA, maker-checker evidence, and data-quality gates"
        actions={
          <button
            type="button"
            onClick={() => void loadReadiness()}
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Readiness Score"
          value={`${score}%`}
          variant={score >= 90 ? 'green' : 'amber'}
        />
        <StatCard label="Active Workflows" value={indicators.activeWorkflows ?? 0} variant="blue" />
        <StatCard
          label="Pending Requests"
          value={indicators.pendingRequests ?? 0}
          variant="amber"
        />
        <StatCard
          label="Open DQ Issues"
          value={indicators.openDataQualityIssues ?? 0}
          variant="red"
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Workflow and Quality Readiness
              </h2>
              <StatusPill status={status} />
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
                {score}%
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
                  score >= 90
                    ? 'h-full bg-emerald-500'
                    : score >= 70
                      ? 'h-full bg-amber-500'
                      : 'h-full bg-red-500'
                }
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="p-0 overflow-hidden">
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Readiness Checks
            </h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
            {(readiness?.checks ?? []).map((check) => (
              <div key={check.key} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_92px]">
                <div>
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
                    {detailPreview(check.details).map((detail) => (
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
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Control Indicators
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {[
              ['No-Step Workflows', indicators.workflowsWithoutSteps ?? 0],
              ['Overdue Requests', indicators.overduePendingRequests ?? 0],
              ['Action Trail', indicators.actionTrailEntries ?? 0],
              ['Attachments', indicators.attachmentCount ?? 0],
              ['Delegations', indicators.activeDelegations ?? 0],
              ['Critical DQ', indicators.criticalDataQualityIssues ?? 0],
              ['High DQ', indicators.highDataQualityIssues ?? 0],
              ['Stale DQ', indicators.staleOpenDataQualityIssues ?? 0],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div
                  className="text-[11px] uppercase"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  {label}
                </div>
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Workflow Links
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
