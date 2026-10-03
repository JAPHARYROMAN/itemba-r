'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ErrorState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

/**
 * Party linkage (Phase 2 PR-5): one canonical customer profile. This older Westsides route
 * keeps its permission gate and sends readers to the shared profile, so bookmarks and
 * printed documents that point here keep working.
 */
export default function WestsidesCustomerRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission, loading } = useAuth();
  const id = typeof params?.id === 'string' ? params.id : '';
  const canView = hasPermission('customers.view');
  useEffect(() => {
    if (loading || !canView || !id) return;
    const href = `/sales-desk/customers/${encodeURIComponent(id)}`;
    if (typeof router.replace === 'function') router.replace(href);
    else router.push(href);
  }, [canView, id, loading, router]);
  if (!loading && !canView) return <ErrorState message="Access Restricted" />;
  return <PageSpinner label="Opening the customer profile" />;
}
