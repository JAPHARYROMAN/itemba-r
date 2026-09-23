'use client';

import { PageHeader } from '@/components/ui';

export function WestsidesGate({ title, loading }: { title: string; loading: boolean }) {
  return (
    <div className="p-6">
      <PageHeader title={title} subtitle={loading ? 'Loading' : 'Access restricted'} />
    </div>
  );
}
