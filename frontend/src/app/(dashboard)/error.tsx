'use client';

import { useEffect } from 'react';

/**
 * Dashboard segment error boundary. Catches render errors inside any
 * (dashboard) route without nuking the sidebar/shell. Logs to console so the
 * digest is visible in DevTools; in production this is where you'd push to
 * Sentry / Datadog.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[dashboard error boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-3 inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold mb-2">This page hit an error.</h2>
        <p className="text-sm text-slate-600 mb-4">
          The rest of the app is still running — only this view failed to render.
          Try again, or navigate to another page.
        </p>
        {error?.digest ? (
          <p className="text-xs text-slate-400 mb-4">Reference: <code>{error.digest}</code></p>
        ) : null}
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-md bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
