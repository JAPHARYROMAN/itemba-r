'use client';

import Link from 'next/link';
import { ErrorState, PageHeader } from '@/components/ui';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="p-6">
      <PageHeader
        title="This workspace couldn’t load"
        subtitle="Try loading it again, or return to Apps to continue your work."
      />
      <ErrorState message="Something interrupted this page." onRetry={reset} />
      <div className="text-center text-sm">
        <Link href="/apps" className="underline">
          Return to Apps
        </Link>
        {error.digest && <p className="mt-3 text-xs">Reference: {error.digest}</p>}
      </div>
    </section>
  );
}
