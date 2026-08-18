'use client';

/**
 * `/msaidizi` — the assistant's own page.
 *
 * A dedicated route rather than a docked panel, for three reasons the plan
 * records: a chat is a place you return to and wants a URL; runs are long (40
 * tool calls at a 30s invoke timeout each can occupy a connection for minutes)
 * and a long-running thing you come back to should not live in a layer that
 * closes when you navigate; and the thread is the bulk of the work, so it gets
 * built once and hosted once.
 *
 * The `?ask=` parameter is how the launcher hands its question over. It is read
 * once, on mount, and never written back — a question that stayed in the URL
 * would re-run itself on every refresh.
 *
 * A user without `msaidizi.use` never reaches this from the UI at all: the nav
 * leaf carries the permission, so the sidebar entry, the command-palette command
 * and the launcher are all absent for them. Someone who types the path anyway
 * gets the standard not-authorised treatment here, and `POST /ask` would 403
 * regardless — the page is a courtesy, not the control.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { MsaidiziChat } from '@/components/msaidizi/msaidizi-chat';
import { MSAIDIZI_ASK_PARAM, MSAIDIZI_PERMISSION } from '@/components/msaidizi/msaidizi-launcher';

function MsaidiziPageBody() {
  const params = useSearchParams();
  return <MsaidiziChat initialQuestion={params.get(MSAIDIZI_ASK_PARAM)} />;
}

export default function MsaidiziPage() {
  const { hasPermission, loading } = useAuth();

  if (loading) return null;

  if (!hasPermission(MSAIDIZI_PERMISSION)) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader
          title="Msaidizi"
          subtitle="The assistant that works with your own permissions"
        />
        <PermissionDeniedState
          title="Msaidizi is not available to your role"
          description="Msaidizi acts with the permissions of whoever is using it, so access to it is granted deliberately, one role at a time. Ask an administrator if you need it."
        />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col px-4 py-6 sm:px-6 lg:px-8"
      style={{ height: 'calc(100vh - 8.5rem)', minHeight: '30rem' }}
    >
      <PageHeader title="Msaidizi" subtitle="Ask about your business. It shows its working." />
      <Suspense
        fallback={
          <p className="text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Opening…
          </p>
        }
      >
        <MsaidiziPageBody />
      </Suspense>
    </div>
  );
}
