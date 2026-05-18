'use client';

import { useEffect } from 'react';

/**
 * Auth segment error boundary. Keeps login/forgot-password/reset-password
 * recoverable when something inside them throws (e.g. a network-layer failure
 * during 2FA challenge). Does NOT depend on auth state since auth itself is
 * what just failed.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[auth error boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-slate-200 p-6 text-center">
        <h2 className="text-lg font-semibold mb-2">Sign-in error</h2>
        <p className="text-sm text-slate-600 mb-4">
          We couldn&apos;t complete that action. Please try again, or contact your
          administrator if the problem persists.
        </p>
        {error?.digest ? (
          <p className="text-xs text-slate-400 mb-4">Reference: <code>{error.digest}</code></p>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          className="w-full px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
