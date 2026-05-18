'use client';

import { useEffect } from 'react';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[auth error boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-slate-950 text-white">
      <div className="max-w-md w-full rounded-lg border border-slate-800 bg-slate-900 p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold mb-2">Sign-in error</h2>
        <p className="text-sm text-slate-300 mb-4">
          We could not complete that action. Try again, or contact your administrator if it keeps
          happening.
        </p>
        {error?.digest ? (
          <p className="text-xs text-slate-500 mb-4">
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
