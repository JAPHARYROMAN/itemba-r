'use client';

import { useEffect } from 'react';
import { Btn, Card } from '@/components/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application route error', error);
  }, [error]);

  return (
    <div className="min-h-screen p-6 flex items-center justify-center bg-slate-950 text-white">
      <Card className="max-w-lg w-full p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-400">
            The page failed to render. Try again, or return to the dashboard.
          </p>
        </div>
        {error.digest && <p className="text-xs text-slate-500">Error ID: {error.digest}</p>}
        <div className="flex gap-2">
          <Btn variant="primary" onClick={reset}>
            Try again
          </Btn>
          <Btn variant="secondary" onClick={() => (window.location.href = '/dashboard')}>
            Dashboard
          </Btn>
        </div>
      </Card>
    </div>
  );
}
