'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppIcon, Card, PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { canOpenApp, statusPath, type WorkspaceApp } from '@/lib/apps';
import type { AppConnectionStatus } from '@/lib/app-connections';
import '@/components/fuel-grid/fuel-grid-launcher.css';

type CheckState = 'idle' | 'checking' | 'online' | 'offline' | 'not-configured';

export function AppLauncher({
  app,
  appUrl,
  onBack,
}: {
  app: WorkspaceApp;
  appUrl: string | null;
  onBack?: () => void;
}) {
  const { hasPermission, loading } = useAuth();
  const canAccess = canOpenApp(app, hasPermission);
  const endpoint = statusPath(app);
  const controller = useRef<AbortController | null>(null);
  const [checkState, setCheckState] = useState<CheckState>(appUrl ? 'idle' : 'not-configured');
  const [status, setStatus] = useState<AppConnectionStatus | null>(null);

  const checkAvailability = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setStatus(null);
    if (!appUrl) {
      setCheckState('not-configured');
      return;
    }

    setCheckState('checking');
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('App status request failed');

      const nextStatus = (await response.json()) as AppConnectionStatus;
      if (request.signal.aborted) return;
      setStatus(nextStatus);
      setCheckState(
        !nextStatus.configured ? 'not-configured' : nextStatus.available ? 'online' : 'offline',
      );
    } catch {
      if (request.signal.aborted) return;
      setStatus(null);
      setCheckState('offline');
    }
  }, [appUrl, endpoint]);

  useEffect(() => {
    if (!loading && canAccess) void checkAvailability();
    return () => controller.current?.abort();
  }, [loading, canAccess, checkAvailability]);

  if (loading) return null;

  if (!canAccess) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title={app.label} subtitle={app.category} />
        <PermissionDeniedState
          title={`${app.label} is not available to your role`}
          description="Ask your administrator for access to this app."
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
    <div className="fuel-launcher" data-appearance={app.appearance}>
      <Link
        href="/apps"
        data-preserve-workspace={onBack ? '' : undefined}
        onClick={(e) => {
          if (onBack && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            onBack();
          }
        }}
        className="mb-4 inline-flex items-center gap-2 rounded text-sm font-medium text-[var(--aurora-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Back to Apps
      </Link>
      <div className="fuel-launcher-heading">
        <span className="fuel-launcher-icon">
          <AppIcon name={app.icon} size={39} strokeWidth={1.5} />
        </span>
        <h1>{app.label}</h1>
        <p>{app.description}</p>
      </div>

      <Card padding="none" className="overflow-hidden">
        {checkState === 'offline' && (
          <p
            role="status"
            className="px-6 pt-5 text-sm"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {app.label} cannot be reached right now. You can check again or return to your ITEMBA OS
            workspace.
          </p>
        )}
        <section className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Your {app.label} workspace
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--aurora-text-secondary)' }}>
                Sign in with your{' '}
                {app.launch.kind === 'external' ? app.launch.authentication : 'app account'}. Opens
                in a new tab.
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
              Open {app.label}
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
              {app.launch.kind === 'external' ? app.launch.authentication : 'ITEMBA OS account'}
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
            {appUrl ?? 'Ask your administrator to connect this app to your workspace.'}
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
    </div>
  );
}
