'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, PageSpinner, StatCard } from '@/components/ui';
import { backendGet } from '@/lib/api-client';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface SecurityReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string | boolean>;
}

interface SecurityReadiness {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  checks: SecurityReadinessCheck[];
}

interface SecurityStats {
  totalEvents: number;
  activeSessions: number;
  lockedAccounts: number;
  failedLogins24h: number;
  twoFactorAdoptionRate: number;
  readiness?: SecurityReadiness;
}

interface SecurityEvent {
  id: string;
  eventNumber: string;
  eventType: string;
  severity: string;
  status: string;
  ipAddress: string | null;
  createdAt: string;
}

const severityClasses: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-blue-100 text-blue-700',
  INFO: 'bg-gray-100 text-gray-600',
};

const statusClasses: Record<ReadinessStatus, string> = {
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-700',
  CRITICAL: 'border-red-200 bg-red-50 text-red-700',
};

const statusCopy: Record<ReadinessStatus, string> = {
  READY: 'Production ready',
  WARNING: 'Needs review',
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

function StatusPill({ status }: { status: ReadinessStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase leading-none ${statusClasses[status]}`}
    >
      {statusCopy[status]}
    </span>
  );
}

function detailPreview(details: SecurityReadinessCheck['details']) {
  return Object.entries(details)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${String(value)}`);
}

export default function SecurityDashboardPage() {
  const [stats, setStats] = useState<SecurityStats>({
    totalEvents: 0,
    activeSessions: 0,
    lockedAccounts: 0,
    failedLogins24h: 0,
    twoFactorAdoptionRate: 0,
  });
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setRefreshing(true);
    try {
      const data = await backendGet<any>('security/dashboard');
      const totalEvents = Array.isArray(data.eventsBySeverity)
        ? data.eventsBySeverity.reduce(
            (sum: number, row: any) => sum + Number(row._count?.id ?? 0),
            0,
          )
        : 0;
      setStats({
        totalEvents,
        activeSessions: data.activeSessionsCount ?? 0,
        lockedAccounts: data.lockedAccountsCount ?? 0,
        failedLogins24h: data.failedLoginsLast24h ?? 0,
        twoFactorAdoptionRate: data.twoFactorAdoptionRate ?? 0,
        readiness: data.readiness,
      });
      setEvents(Array.isArray(data.recentCriticalEvents) ? data.recentCriticalEvents : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = stats.readiness;
  const readinessStatus = readiness?.status ?? 'WARNING';
  const readinessScore = readiness?.score ?? 0;

  const quickLinks = [
    {
      label: 'Security Policies',
      href: '/security/policies',
      desc: 'Password, lockout, and protection policy configuration',
    },
    {
      label: 'User Security Profiles',
      href: '/security/user-profiles',
      desc: '2FA, risk level, and forced security actions',
    },
    {
      label: 'Security Events',
      href: '/security/events',
      desc: 'Review, resolve, and audit security events',
    },
    {
      label: 'Active Sessions',
      href: '/security/sessions',
      desc: 'Monitor and revoke active user sessions',
    },
    {
      label: 'Two-Factor Auth',
      href: '/security/two-factor',
      desc: 'MFA adoption and setup controls',
    },
    { label: 'Roles', href: '/roles', desc: 'Role scope and permission assignment' },
    { label: 'Users', href: '/users', desc: 'User access, status, and company assignments' },
  ];

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Security Dashboard"
        subtitle="Auth, session continuity, role-based access control, MFA, and security event response"
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
        <StatCard label="Security Events (30d)" value={stats.totalEvents} variant="purple" />
        <StatCard label="Active Sessions" value={stats.activeSessions} variant="blue" />
        <StatCard label="Locked Accounts" value={stats.lockedAccounts} variant="red" />
        <StatCard label="MFA Adoption" value={`${stats.twoFactorAdoptionRate}%`} variant="green" />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Auth / Session / Access Readiness
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
              Access-Control Checks
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

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Security Indicators
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
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
              Recent Critical Events
            </h2>
            <div className="mt-3 space-y-3">
              {events.slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border p-3"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs" style={{ color: 'var(--aurora-text)' }}>
                      {event.eventNumber}
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${severityClasses[event.severity] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {event.severity}
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {humanize(event.eventType)}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                    {event.createdAt ? new Date(event.createdAt).toLocaleString() : 'No timestamp'}
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <div className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                  No recent high or critical security events.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Security & Access Links
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
