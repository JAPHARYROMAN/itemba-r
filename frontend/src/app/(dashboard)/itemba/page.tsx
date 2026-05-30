'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard } from '@/components/ui';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface SectorReadiness {
  key: string;
  title: string;
  scope: string;
  href: string;
  score: number;
  status: ReadinessStatus;
  maturity: string;
  primaryMetric: string;
  secondaryMetric: string;
  modules: string[];
  alerts: string[];
}

interface SectorAlert {
  sectorKey: string;
  sectorTitle: string;
  message: string;
  href: string;
}

interface SectorReadinessSummary {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  configuredSectors: number;
  totalSectors: number;
  openAlerts: number;
  sectors: SectorReadiness[];
  alerts: SectorAlert[];
  standards: string[];
  readinessImpact: {
    sectorModules: number;
    uxConsistency: number;
  };
}

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  READY: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 dark:text-emerald-200',
  WARNING: 'border-amber-500/40 bg-amber-500/10 text-amber-200 dark:text-amber-200',
  CRITICAL: 'border-red-500/40 bg-red-500/10 text-red-200 dark:text-red-200',
};

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  );
}

function normalizeCompanies(payload: unknown): Company[] {
  const data = (payload as { data?: unknown })?.data;
  if (Array.isArray((data as { data?: unknown })?.data)) {
    return (data as { data: Company[] }).data;
  }
  if (Array.isArray(data)) return data as Company[];
  if (Array.isArray(payload)) return payload as Company[];
  return [];
}

function formatDateTime(value: string) {
  if (!value) return 'Not loaded';
  return new Intl.DateTimeFormat('en-TZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function ItembaDashboardPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [readiness, setReadiness] = useState<SectorReadinessSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    fetch('/api/backend/companies?limit=100')
      .then((response) => response.json())
      .then((json) => {
        if (cancelled) return;
        const nextCompanies = normalizeCompanies(json);
        setCompanies(nextCompanies);
        setCompanyId((current) => current || nextCompanies[0]?.id || '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load companies');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadReadiness = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ companyId });
      const response = await fetch(`/api/backend/itemba/dashboard/sector-readiness?${params}`);
      if (!response.ok) throw new Error('Failed to load sector readiness');
      const json = await response.json();
      const payload = (json?.data ?? json) as SectorReadinessSummary;
      setReadiness(payload && typeof payload === 'object' ? payload : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sector readiness');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === companyId),
    [companies, companyId],
  );

  const sectors = readiness?.sectors ?? [];
  const visibleAlerts = readiness?.alerts ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Sector Command Centre"
        subtitle="One operating view for petroleum, logistics, agriculture, construction, retail, rentals, parking, and hospitality."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className="h-10 min-w-[260px] rounded-lg border px-3 text-sm outline-none"
              style={{
                background: 'var(--aurora-card)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text)',
              }}
            >
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name} ({company.code})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadReadiness()}
              className="h-10 rounded-lg border px-4 text-sm font-semibold transition hover:opacity-90"
              style={{
                background: 'var(--aurora-bg-subtle)',
                borderColor: 'var(--aurora-border)',
                color: 'var(--aurora-text)',
              }}
            >
              Refresh
            </button>
          </div>
        }
      />

      {selectedCompany && (
        <div className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          Current scope: {selectedCompany.name}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && <Spinner />}

      {readiness && !loading && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Sector modules"
              value={`${readiness.readinessImpact.sectorModules}/100`}
              hint={`Target ${readiness.target}+`}
              variant={readiness.readinessImpact.sectorModules >= 90 ? 'green' : 'amber'}
            />
            <StatCard
              label="UX consistency"
              value={`${readiness.readinessImpact.uxConsistency}/100`}
              hint="Unified command view"
              variant={readiness.readinessImpact.uxConsistency >= 90 ? 'green' : 'amber'}
            />
            <StatCard
              label="Configured sectors"
              value={`${readiness.configuredSectors}/${readiness.totalSectors}`}
              hint={readiness.maturity}
              variant="blue"
            />
            <StatCard
              label="Open actions"
              value={readiness.openAlerts}
              hint={`Updated ${formatDateTime(readiness.updatedAt)}`}
              variant={readiness.openAlerts > 0 ? 'amber' : 'green'}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card className="p-0" padding="none">
              <div
                className="flex items-center justify-between gap-3 border-b px-5 py-4"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    Sector Readiness
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                    Scores combine configuration, live activity, and unresolved operational
                    exceptions.
                  </p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[readiness.status]}`}
                >
                  {readiness.status}
                </span>
              </div>

              <div className="grid gap-3 p-5 md:grid-cols-2">
                {sectors.map((sector) => (
                  <Link key={sector.key} href={sector.href} className="group block">
                    <div
                      className="h-full rounded-lg border p-4 transition group-hover:-translate-y-0.5 group-hover:border-blue-500/60"
                      style={{
                        background: 'var(--aurora-bg-subtle)',
                        borderColor: 'var(--aurora-border)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className="text-[11px] font-semibold uppercase"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {sector.maturity}
                          </div>
                          <h3
                            className="mt-1 text-base font-semibold"
                            style={{ color: 'var(--aurora-text)' }}
                          >
                            {sector.title}
                          </h3>
                        </div>
                        <div className="text-right">
                          <div
                            className="text-2xl font-bold"
                            style={{ color: 'var(--aurora-text)' }}
                          >
                            {sector.score}
                          </div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[sector.status]}`}
                          >
                            {sector.status}
                          </span>
                        </div>
                      </div>

                      <p className="mt-3 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                        {sector.scope}
                      </p>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                        <div style={{ color: 'var(--aurora-text)' }}>{sector.primaryMetric}</div>
                        <div style={{ color: 'var(--aurora-text-secondary)' }}>
                          {sector.secondaryMetric}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {sector.modules.slice(0, 5).map((moduleName) => (
                          <span
                            key={moduleName}
                            className="rounded-full border px-2 py-1 text-[11px]"
                            style={{
                              borderColor: 'var(--aurora-border)',
                              color: 'var(--aurora-text-secondary)',
                            }}
                          >
                            {moduleName}
                          </span>
                        ))}
                        {sector.modules.length > 5 && (
                          <span
                            className="rounded-full border px-2 py-1 text-[11px]"
                            style={{
                              borderColor: 'var(--aurora-border)',
                              color: 'var(--aurora-text-muted)',
                            }}
                          >
                            +{sector.modules.length - 5} more
                          </span>
                        )}
                      </div>

                      {sector.alerts.length > 0 && (
                        <div className="mt-4 space-y-1">
                          {sector.alerts.slice(0, 2).map((alert) => (
                            <div key={alert} className="text-xs text-amber-200">
                              {alert}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  Operating Standards
                </h2>
                <div className="mt-3 space-y-3">
                  {readiness.standards.map((standard) => (
                    <div key={standard} className="flex gap-3 text-sm">
                      <span className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                      <span style={{ color: 'var(--aurora-text-secondary)' }}>{standard}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
                    Action Queue
                  </h2>
                  <span
                    className="rounded-full border px-2 py-1 text-xs"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      color: 'var(--aurora-text-secondary)',
                    }}
                  >
                    {readiness.openAlerts} open
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {visibleAlerts.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                      No sector exceptions are currently surfaced for this scope.
                    </p>
                  ) : (
                    visibleAlerts.map((alert) => (
                      <Link
                        key={`${alert.sectorKey}-${alert.message}`}
                        href={alert.href}
                        className="block rounded-lg border px-3 py-2 text-sm transition hover:border-blue-500/60"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          color: 'var(--aurora-text-secondary)',
                        }}
                      >
                        <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                          {alert.sectorTitle}
                        </div>
                        <div className="mt-0.5">{alert.message}</div>
                      </Link>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
