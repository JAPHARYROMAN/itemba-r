import { ApiError, backendGet, backendPost, backendPut } from '@/lib/api-client';
import { draftFormType, serializeDraftValues } from './draft-serializers';
import type { WorkspaceDraft } from './workspace-drafts';

export type DraftSyncStatus = 'Saving' | 'Saved' | 'Offline' | 'Needs attention';
type Entry = {
  revision: number;
  token: string;
  status: DraftSyncStatus;
  error: string;
  pending?: WorkspaceDraft;
  running?: Promise<void>;
  blocked: boolean;
  acknowledged?: WorkspaceDraft;
};
/** Memory-only queue. Revision/lease conflicts never replace the local edit or last server copy. */
export function createDraftSync(publish: () => void) {
  const entries = new Map<string, Entry>();
  let active = true;
  const entry = (id: string) => {
    let item = entries.get(id);
    if (!item) {
      item = {
        revision: 0,
        token: crypto.randomUUID(),
        status: 'Saving',
        error: '',
        blocked: false,
      };
      entries.set(id, item);
    }
    return item;
  };
  const fail = (item: Entry, error: unknown) => {
    item.blocked = error instanceof ApiError && error.status === 409;
    item.status = error instanceof ApiError ? 'Needs attention' : 'Offline';
    item.error = error instanceof Error ? error.message : 'Could not save this draft';
    publish();
  };
  const flush = async (id: string): Promise<void> => {
    const item = entry(id);
    if (item.running) {
      await item.running;
      if (item.pending) return flush(id);
      return;
    }
    if (!active || !item.pending) return;
    if (item.blocked) throw new Error(item.error);
    const run = async () => {
      while (active && item.pending) {
        const draft = item.pending;
        item.status = 'Saving';
        publish();
        try {
          if (item.revision)
            await backendPut(`/workspace/drafts/${id}/lease`, {
              leaseToken: item.token,
              expectedRevision: item.revision,
            });
          const values = serializeDraftValues(draft.values);
          const response = await backendPut<{ revision: number }>(`/workspace/drafts/${id}`, {
            appId: draft.appId,
            formType: draftFormType(draft.appId, draft.context),
            schemaVersion: 1,
            expectedRevision: item.revision,
            leaseToken: item.token,
            content: {
              title: draft.title,
              summary: draft.summary,
              context: draft.context,
              values,
              requestId: draft.requestId,
              needsReview: true,
            },
          });
          if (!active) return;
          item.revision = response.revision;
          item.acknowledged = draft;
          if (item.pending === draft) item.pending = undefined;
          item.status = item.pending ? 'Saving' : 'Saved';
          item.error = '';
          publish();
        } catch (error) {
          if (active) fail(item, error);
          throw error;
        }
      }
    };
    item.running = run();
    try {
      await item.running;
    } finally {
      item.running = undefined;
    }
  };
  return {
    status: (id: string) => entries.get(id)?.status,
    error: (id: string) => entries.get(id)?.error ?? '',
    unsynced: () => [...entries.values()].some((item) => !!item.pending),
    hydrate: (rows: WorkspaceDraft[]) => {
      for (const row of rows) {
        const item = entry(row.id);
        item.revision = row.revision ?? 0;
        item.status = 'Saved';
        item.acknowledged = row;
      }
    },
    queue: (draft: WorkspaceDraft) => {
      if (!draftFormType(draft.appId, draft.context)) return;
      const item = entry(draft.id);
      item.pending = draft;
      item.status = item.blocked ? 'Needs attention' : 'Saving';
      publish();
      void flush(draft.id).catch(() => { publish(); });
    },
    flush,
    claim: async (id: string) => {
      const item = entries.get(id);
      if (!item?.revision) return;
      try {
        await backendPut(`/workspace/drafts/${id}/lease`, {
          leaseToken: item.token,
          expectedRevision: item.revision,
        });
        if (item.blocked) throw new Error(item.error);
      } catch (error) {
        fail(item, error);
        throw error;
      }
    },
    fresh: async (id: string) => {
      const row = await backendGet<WorkspaceDraft>(`/workspace/drafts/${id}`);
      const item = entry(id);
      if (item.pending) throw new Error('Unsynchronised edits are still open here.');
      item.revision = row.revision ?? 0;
      item.blocked = false;
      return row;
    },
    release: async (id: string) => {
      const item = entries.get(id);
      if (!item) return;
      try {
        await item.running;
        if (item.revision)
          await backendPut(`/workspace/drafts/${id}/lease`, {
            leaseToken: item.token,
            expectedRevision: item.revision,
            release: true,
          });
      } catch {
        /* The short lease expires even when the connection is lost. */
        return;
      }
    },
    discard: async (id: string) => {
      const item = entries.get(id);
      if (!item) return;
      await item.running;
      item.pending = undefined;
      if (item.revision) {
        try {
          await backendPost(`/workspace/drafts/${id}/discard`, {
            leaseToken: item.token,
            expectedRevision: item.revision,
          });
        } catch (error) {
          fail(item, error);
          throw error;
        }
      }
      entries.delete(id);
      publish();
    },
    retry: () => {
      for (const [id, item] of entries)
        if (item.pending && !item.blocked) void flush(id).catch(() => { publish(); });
    },
    activate: () => { active = true; },
    dispose: () => {
      active = false;
      entries.clear();
    },
  };
}
