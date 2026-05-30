'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageSpinner, StatCard } from '@/components/ui';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface DataQualityIssue {
  id: string;
  issueNumber: string;
  entityType: string;
  issueType: string;
  severity: string;
  status: string;
  title?: string;
  detectedAt: string;
}

interface ReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

interface DataQualityReadiness {
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

const severityClasses: Record<string, string> = {
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  LOW: 'border-slate-200 bg-slate-50 text-slate-600',
};

const issueStatusClasses: Record<string, string> = {
  OPEN: 'border-amber-200 bg-amber-50 text-amber-700',
  ACKNOWLEDGED: 'border-blue-200 bg-blue-50 text-blue-700',
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DISMISSED: 'border-slate-200 bg-slate-50 text-slate-600',
};

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase leading-none ${className}`}
    >
      {label.replace(/_/g, ' ')}
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

function formatDate(value?: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

export default function DataQualityPage() {
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [readiness, setReadiness] = useState<DataQualityReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningChecks, setRunningChecks] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [issuesResponse, readinessResponse] = await Promise.all([
        fetch('/api/backend/bi/data-quality?limit=50'),
        fetch('/api/backend/bi/data-quality/readiness'),
      ]);
      if (!issuesResponse.ok)
        throw new Error(`Data-quality list failed (${issuesResponse.status})`);
      if (!readinessResponse.ok)
        throw new Error(`Data-quality readiness failed (${readinessResponse.status})`);
      const [issuesResult, readinessResult] = await Promise.all([
        issuesResponse.json(),
        readinessResponse.json(),
      ]);
      const issuesPayload = issuesResult.data ?? issuesResult;
      setIssues(Array.isArray(issuesPayload) ? issuesPayload : (issuesPayload.data ?? []));
      setReadiness(readinessResult.data ?? readinessResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data-quality controls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function runChecks() {
    setRunningChecks(true);
    try {
      await fetch('/api/backend/bi/data-quality/run-checks', { method: 'POST' });
      await loadData();
    } finally {
      setRunningChecks(false);
    }
  }

  async function updateIssue(id: string, action: 'resolve' | 'acknowledge' | 'dismiss') {
    await fetch(`/api/backend/bi/data-quality/${id}/${action}`, { method: 'PATCH' });
    await loadData();
  }

  if (loading) return <PageSpinner />;

  const indicators = readiness?.indicators ?? {};
  const score = readiness?.score ?? 0;
  const status = readiness?.status ?? 'WARNING';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Data Quality"
        subtitle="Data integrity, workflow trust, and operational issue lifecycle"
        actions={
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={runningChecks}
            className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
          >
            {runningChecks ? 'Running...' : 'Run Checks'}
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
        <StatCard label="Open Issues" value={indicators.openIssues ?? 0} variant="amber" />
        <StatCard
          label="Critical Issues"
          value={indicators.criticalOpenIssues ?? 0}
          variant="red"
        />
        <StatCard
          label="Resolved This Week"
          value={indicators.resolvedLastSevenDays ?? 0}
          variant="green"
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Data-Quality Readiness
              </h2>
              <Pill label={status} className={statusClasses[status]} />
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              {readiness?.maturity ?? 'Readiness diagnostics have not loaded.'}
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

      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.85fr]">
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
                    <Pill label={check.status} className={statusClasses[check.status]} />
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
            Quality Indicators
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {[
              ['Acknowledged', indicators.acknowledgedIssues ?? 0],
              ['High', indicators.highOpenIssues ?? 0],
              ['Stale', indicators.staleOpenIssues ?? 0],
              ['Entity Types', indicators.entityTypesAffected ?? 0],
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

      <Card className="p-0 overflow-hidden">
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Open Quality Issues
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
              <tr
                className="text-left text-xs uppercase"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Issue</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Detected</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No data-quality issues found.
                  </td>
                </tr>
              ) : (
                issues.map((issue) => (
                  <tr
                    key={issue.id}
                    className="border-t"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">{issue.issueNumber}</div>
                      {issue.title && (
                        <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {issue.title}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{issue.entityType}</td>
                    <td className="px-4 py-3">{issue.issueType}</td>
                    <td className="px-4 py-3">
                      <Pill
                        label={issue.severity}
                        className={severityClasses[issue.severity] ?? severityClasses.LOW}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        label={issue.status}
                        className={issueStatusClasses[issue.status] ?? issueStatusClasses.OPEN}
                      />
                    </td>
                    <td className="px-4 py-3">{formatDate(issue.detectedAt)}</td>
                    <td className="px-4 py-3">
                      {issue.status === 'OPEN' ? (
                        <div className="flex flex-wrap gap-2">
                          {(['acknowledge', 'resolve', 'dismiss'] as const).map((action) => (
                            <button
                              key={action}
                              type="button"
                              onClick={() => void updateIssue(issue.id, action)}
                              className="rounded-md border px-2 py-1 text-xs"
                              style={{
                                borderColor: 'var(--aurora-border)',
                                color: 'var(--aurora-text)',
                              }}
                            >
                              {humanize(action)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--aurora-text-muted)' }}>No action</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
