'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface ProductionReadiness {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  checks: ReadinessCheck[];
}

interface ProductionReadinessRecord {
  id: string;
  checkCode: string;
  category: string;
  title: string;
  priority: string;
  status: string;
  dueDate?: string | null;
  responsibleUser?: { fullName?: string; email?: string } | null;
}

interface ProductionSummary {
  readiness: ProductionReadiness;
  records: ProductionReadinessRecord[];
}

const statusClasses: Record<ReadinessStatus, string> = {
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
};

const checklistStatusClasses: Record<string, string> = {
  PASSED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
  NOT_STARTED: 'border-slate-200 bg-slate-50 text-slate-600',
  IN_PROGRESS: 'border-blue-200 bg-blue-50 text-blue-700',
  WAIVED: 'border-amber-200 bg-amber-50 text-amber-700',
  NOT_APPLICABLE: 'border-slate-200 bg-slate-50 text-slate-500',
};

const priorityClasses: Record<string, string> = {
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  LOW: 'border-blue-200 bg-blue-50 text-blue-700',
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

function formatDate(value?: string | null) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value?: string) {
  if (!value) return 'Not loaded';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function detailPreview(details: ReadinessCheck['details']) {
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${value}`);
}

export default function ReadinessChecklistPage() {
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const response = await fetch('/api/backend/production-readiness/summary');
      if (!response.ok) throw new Error(`Production readiness failed (${response.status})`);
      const result = await response.json();
      setSummary(result.data ?? result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load production readiness');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/backend/production-readiness/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  if (loading) return <PageSpinner />;

  const readiness = summary?.readiness;
  const indicators = readiness?.indicators ?? {};
  const records = summary?.records ?? [];
  const score = readiness?.score ?? 0;
  const status = readiness?.status ?? 'WARNING';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Production Readiness"
        subtitle="Production, admin, governance, backup, monitoring, and release controls"
        actions={
          <button
            type="button"
            onClick={() => void load()}
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
        <StatCard
          label="Open Critical Checks"
          value={indicators.criticalOpenChecks ?? 0}
          variant="red"
        />
        <StatCard
          label="Config Failures"
          value={indicators.failedRequiredConfigChecks ?? 0}
          variant="amber"
        />
        <StatCard
          label="Active Health Checks"
          value={indicators.activeHealthChecks ?? 0}
          variant="blue"
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Admin and Governance Readiness
              </h2>
              <Pill label={status} className={statusClasses[status]} />
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

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.75fr]">
        <Card className="p-0 overflow-hidden">
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Production Control Checks
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
            Governance Indicators
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {[
              ['Users Without Roles', indicators.usersWithoutRoles ?? 0],
              ['System Roles', indicators.systemRoles ?? 0],
              ['Permissions', indicators.permissions ?? 0],
              ['Security Events', indicators.unresolvedCriticalSecurityEvents ?? 0],
              ['Active Backups', indicators.activeBackupJobs ?? 0],
              ['DR Plans', indicators.activeDrPlans ?? 0],
              ['Open Critical Errors', indicators.openCriticalErrors ?? 0],
              ['Retention Policies', indicators.activeRetentionPolicies ?? 0],
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
            Checklist Records
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
              <tr
                className="text-left text-xs uppercase"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Update</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No production readiness checklist records have been created yet.
                  </td>
                </tr>
              ) : (
                records.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t"
                    style={{ borderColor: 'var(--aurora-border)' }}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{row.checkCode}</td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--aurora-text)' }}>
                      {row.title}
                    </td>
                    <td className="px-4 py-3">{row.category}</td>
                    <td className="px-4 py-3">
                      <Pill
                        label={row.priority}
                        className={priorityClasses[row.priority] ?? priorityClasses.MEDIUM}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        label={row.status}
                        className={
                          checklistStatusClasses[row.status] ?? checklistStatusClasses.NOT_STARTED
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      {row.responsibleUser?.fullName ?? row.responsibleUser?.email ?? '-'}
                    </td>
                    <td className="px-4 py-3">{formatDate(row.dueDate)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={row.status}
                        onChange={(event) => void updateStatus(row.id, event.target.value)}
                        className="rounded-md border px-2 py-1 text-xs"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-surface)',
                          color: 'var(--aurora-text)',
                        }}
                      >
                        {Object.keys(checklistStatusClasses).map((option) => (
                          <option key={option} value={option}>
                            {option.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
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
