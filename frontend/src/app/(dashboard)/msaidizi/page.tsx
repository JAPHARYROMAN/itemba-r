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
 * once, on mount, and then STRIPPED from the URL, because a question that stayed
 * there would re-run itself on every refresh: runs are long and emit nothing for
 * the first model turn, so F5 on a run that looks stuck is the obvious thing to
 * do, and it would start a second billed run nobody asked for. Browser Back into
 * the same entry, and a link someone pasted to a colleague, do it again. Under
 * `MSAIDIZI_WRITE_MODE=amber` that is a re-executed change rather than a wasted
 * read. The parameter is a handover, not a piece of addressable state, and a
 * handover is spent the moment it is taken.
 *
 * A user without `msaidizi.use` never reaches this from the UI at all: the nav
 * leaf carries the permission, so the sidebar entry, the command-palette command
 * and the launcher are all absent for them. Someone who types the path anyway
 * gets the standard not-authorised treatment here, and `POST /ask` would 403
 * regardless — the page is a courtesy, not the control.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { MsaidiziChat } from '@/components/msaidizi/msaidizi-chat';
import {
  MSAIDIZI_WORKSPACES,
  MsaidiziTaskCenter,
  MsaidiziWorkspacePlaceholder,
} from '@/components/msaidizi/msaidizi-task-center';
import {
  MSAIDIZI_ASK_PARAM,
  MSAIDIZI_PERMISSION,
  MSAIDIZI_ROUTE,
} from '@/components/msaidizi/msaidizi-launcher';

type MsaidiziWorkspaceId = (typeof MSAIDIZI_WORKSPACES)[number]['id'];

const MSAIDIZI_WORKSPACE_IDS = new Set<MsaidiziWorkspaceId>(
  MSAIDIZI_WORKSPACES.map((workspace) => workspace.id),
);
const UUID_LIKE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function allowedWorkspace(value: string | null): MsaidiziWorkspaceId {
  return value && MSAIDIZI_WORKSPACE_IDS.has(value as MsaidiziWorkspaceId)
    ? (value as MsaidiziWorkspaceId)
    : 'conversations';
}

function allowedTargetId(value: string | null): string | null {
  return value && UUID_LIKE.test(value) ? value : null;
}

function addressAfterAsk(serialized: string): string {
  const next = new URLSearchParams(serialized);
  next.delete(MSAIDIZI_ASK_PARAM);

  const rawWorkspace = next.get('workspace');
  const workspace = allowedWorkspace(rawWorkspace);
  if (rawWorkspace !== null && workspace !== rawWorkspace) next.delete('workspace');
  if (workspace !== 'tasks' || !allowedTargetId(next.get('taskId'))) next.delete('taskId');
  if (workspace !== 'devices' || !allowedTargetId(next.get('deviceId'))) next.delete('deviceId');
  if (workspace !== 'devices' || !allowedTargetId(next.get('recoveryId')))
    next.delete('recoveryId');

  const query = next.toString();
  return query ? `${MSAIDIZI_ROUTE}?${query}` : MSAIDIZI_ROUTE;
}

function MsaidiziPageBody({ initialQuestion }: { initialQuestion: string | null }) {
  return <MsaidiziChat initialQuestion={initialQuestion} />;
}

/**
 * Durable work lives beside, rather than inside, a conversation. The selected
 * workspace is local UI state only: opening a task never changes its execution
 * mode, queues it, or turns prose from a chat into Autopilot authority.
 */
function MsaidiziWorkspaceBody() {
  const params = useSearchParams();
  const router = useRouter();
  const serializedParams = params.toString();
  const rawWorkspace = params.get('workspace');
  const requestedWorkspace = allowedWorkspace(rawWorkspace);
  const [workspace, setWorkspace] = useState<MsaidiziWorkspaceId>(requestedWorkspace);
  // Deep links are inspection-only. Even if someone appends `ask` to a task or
  // device incident URL, no prose is handed to chat or any execution surface.
  const [question] = useState(() =>
    rawWorkspace === null || rawWorkspace === 'conversations'
      ? params.get(MSAIDIZI_ASK_PARAM)
      : null,
  );

  useEffect(() => {
    setWorkspace(requestedWorkspace);
  }, [requestedWorkspace]);

  const asked = params.get(MSAIDIZI_ASK_PARAM);
  useEffect(() => {
    if (asked === null) return;
    // Keep validated inspection state and inert query parameters while spending
    // the one-shot question. `replace` prevents Back or refresh from replaying it.
    router.replace(addressAfterAsk(serializedParams), { scroll: false });
  }, [asked, router, serializedParams]);

  const taskId =
    requestedWorkspace === 'tasks' && workspace === 'tasks'
      ? allowedTargetId(params.get('taskId'))
      : null;
  const deviceId =
    requestedWorkspace === 'devices' && workspace === 'devices'
      ? allowedTargetId(params.get('deviceId'))
      : null;
  const recoveryId =
    requestedWorkspace === 'devices' && workspace === 'devices'
      ? allowedTargetId(params.get('recoveryId'))
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Msaidizi workspaces" className="mb-4 flex flex-wrap gap-1">
        {MSAIDIZI_WORKSPACES.map((item) => {
          const selected = workspace === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setWorkspace(item.id)}
              aria-current={selected ? 'page' : undefined}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-medium"
              style={{
                color: selected ? 'var(--aurora-accent-text)' : 'var(--aurora-text-secondary)',
                background: selected ? 'var(--aurora-accent-subtle)' : 'transparent',
                border: `1px solid ${selected ? 'var(--aurora-border-focus)' : 'transparent'}`,
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      {workspace === 'conversations' ? <MsaidiziPageBody initialQuestion={question} /> : null}
      {workspace === 'tasks' ? <MsaidiziTaskCenter initialTaskId={taskId} /> : null}
      {workspace === 'routines' || workspace === 'devices' || workspace === 'memory' ? (
        <MsaidiziWorkspacePlaceholder
          workspace={workspace}
          focusedDeviceId={deviceId}
          focusedRecoveryId={recoveryId}
        />
      ) : null}
    </div>
  );
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
        <MsaidiziWorkspaceBody />
      </Suspense>
    </div>
  );
}
