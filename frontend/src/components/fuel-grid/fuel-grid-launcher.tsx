'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppIcon, Card, PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { FUEL_GRID_PERMISSION, type FuelGridStatus } from '@/lib/fuel-grid';

type CheckState = 'idle' | 'checking' | 'online' | 'offline' | 'not-configured';

export function FuelGridLauncher({ appUrl }: { appUrl: string | null }) {
  const { hasPermission, loading } = useAuth();
  const canAccess = hasPermission(FUEL_GRID_PERMISSION);
  const [checkState, setCheckState] = useState<CheckState>(appUrl ? 'idle' : 'not-configured');
  const [status, setStatus] = useState<FuelGridStatus | null>(null);

  const checkAvailability = useCallback(async () => {
    if (!appUrl) {
      setCheckState('not-configured');
      return;
    }

    setCheckState('checking');
    try {
      const response = await fetch('/api/fuel-grid/status', {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Fuel Grid status request failed');

      const nextStatus = (await response.json()) as FuelGridStatus;
      setStatus(nextStatus);
      setCheckState(
        !nextStatus.configured ? 'not-configured' : nextStatus.available ? 'online' : 'offline',
      );
    } catch {
      setStatus(null);
      setCheckState('offline');
    }
  }, [appUrl]);

  useEffect(() => {
    if (canAccess) void checkAvailability();
  }, [canAccess, checkAvailability]);

  if (loading) return null;

  if (!canAccess) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="Fuel Grid" subtitle="Station operations platform" />
        <PermissionDeniedState
          title="Fuel Grid is not available to your role"
          description="Ask the group administrator to grant access to the Fuel Grid launcher."
        />
      </div>
    );
  }

  const statusLabel = {
    idle: 'Not checked',
    checking: 'Checking',
    online: 'Available',
    offline: 'Unavailable',
    'not-configured': 'Not configured',
  }[checkState];

  const statusColor =
    checkState === 'online'
      ? 'var(--aurora-success)'
      : checkState === 'offline' || checkState === 'not-configured'
        ? 'var(--aurora-danger)'
        : 'var(--aurora-text-muted)';

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Fuel Grid"
        subtitle="Station operations platform"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Fuel Grid' }]}
      />

      <Card padding="none" className="overflow-hidden">
        <section className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className="flex h-11 w-11 flex-none items-center justify-center rounded-lg"
              style={{ background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary)' }}
            >
              <AppIcon name="fuel" size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Fuel Grid workspace
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--aurora-text-secondary)' }}>
                Separate authentication and data. Opens in a new browser tab.
              </p>
            </div>
          </div>

          {appUrl ? (
            <a
              href={appUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-brand-600 bg-brand-600 px-4 py-2 text-[13px] font-medium text-white transition hover:-translate-y-px hover:bg-brand-700 hover:shadow-md"
            >
              Open Fuel Grid
              <AppIcon name="external" size={15} />
            </a>
          ) : (
            <span
              className="inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-[13px] font-medium"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}
            >
              Configuration required
            </span>
          )}
        </section>

        <dl
          className="grid grid-cols-1 border-t sm:grid-cols-3"
          style={{ borderColor: 'var(--aurora-border)' }}
        >
          <div className="px-5 py-4 sm:px-6">
            <dt
              className="text-[11px] font-medium uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Service status
            </dt>
            <dd
              className="mt-2 flex items-center gap-2 text-[13px] font-medium"
              style={{ color: statusColor }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: statusColor }} />
              {statusLabel}
            </dd>
          </div>
          <div
            className="border-t px-5 py-4 sm:border-l sm:border-t-0 sm:px-6"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <dt
              className="text-[11px] font-medium uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Authentication
            </dt>
            <dd className="mt-2 text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>
              Fuel Grid account
            </dd>
          </div>
          <div
            className="border-t px-5 py-4 sm:border-l sm:border-t-0 sm:px-6"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <dt
              className="text-[11px] font-medium uppercase"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              Data connection
            </dt>
            <dd className="mt-2 text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>
              Independent
            </dd>
          </div>
        </dl>

        <div
          className="flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
        >
          <p className="truncate text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {appUrl ?? 'Set FUELGRID_APP_URL in the Itemba-R frontend environment.'}
          </p>
          <button
            type="button"
            onClick={() => void checkAvailability()}
            disabled={!appUrl || checkState === 'checking'}
            className="flex-none text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: 'var(--aurora-primary)' }}
          >
            Check again
          </button>
        </div>
      </Card>

      {status?.checkedAt && (
        <p className="mt-3 text-right text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Last checked {new Date(status.checkedAt).toLocaleString()}
          {status.latencyMs !== null ? ` (${status.latencyMs} ms)` : ''}
        </p>
      )}
    </main>
  );
}
