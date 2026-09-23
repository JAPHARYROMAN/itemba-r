'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { FilePenLine, RotateCcw, Trash2 } from 'lucide-react';
import { Btn, Modal } from '@/components/ui';
import { useFormGuard, useUnsavedWork } from './unsaved-work-provider';
import './workspace-drafts.css';
import { backendGet } from '@/lib/api-client';
import { createDraftSync, type DraftSyncStatus } from './draft-sync';
import { draftFormType } from './draft-serializers';

export interface WorkspaceDraft {
  id: string;
  appId: string;
  title: string;
  summary?: string;
  context: Record<string, string>;
  values: unknown;
  requestId: string | null;
  needsReview: boolean;
  updatedAt: number;
  revision?: number;
}
const EMPTY: readonly WorkspaceDraft[] = [];
function createDraftStore(synchronize = false) {
  let rows: readonly WorkspaceDraft[] = EMPTY;
  const leases = new Map<string, { owner: symbol; opening: boolean }>();
  let locked: readonly string[] = [];
  const listeners = new Set<() => void>();
  let version = 0;
  let loadError = '';
  const publish = () => {
    version += 1;
    locked = [...leases.keys()];
    listeners.forEach((listener) => listener());
  };
  const sync = synchronize ? createDraftSync(publish) : null;
  return {
    sync,
    error: () => loadError,
    setError: (message:string) => { loadError=message; publish(); },
    version: () => version,
    hydrate: (loaded: WorkspaceDraft[]) => {
      sync?.hydrate(loaded);
      rows = [...rows.filter(row => leases.has(row.id) || !loaded.some(current => current.id === row.id)), ...loaded.filter(row => !leases.has(row.id))];
      publish();
    },
    unsynced: () => (synchronize ? !!sync?.unsynced() : rows.length > 0),
    read: () => rows,
    readLocked: () => locked,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginOpen: (id: string, owner: symbol) => {
      if (!rows.some((row) => row.id === id)) throw new Error('This draft is no longer available.');
      if (leases.has(id)) throw new Error('This draft is already open in another window.');
      leases.set(id, { owner, opening: true });
      publish();
    },
    claim: (id: string, owner: symbol, retained: boolean) => {
      if (retained && !rows.some((row) => row.id === id)) return false;
      const lease = leases.get(id);
      if (lease && !lease.opening && lease.owner !== owner) return false;
      leases.set(id, { owner, opening: false });
      void sync?.claim(id).catch(() => { publish(); });
      publish();
      return true;
    },
    owns: (id: string, owner: symbol) => leases.get(id)?.owner === owner,
    release: (id: string, owner: symbol) => {
      if (leases.get(id)?.owner !== owner) return;
      leases.delete(id);
      void sync?.release(id);
      publish();
    },
    put: (draft: WorkspaceDraft, owner: symbol) => {
      if (leases.get(draft.id)?.owner !== owner) return;
      rows = [draft, ...rows.filter((row) => row.id !== draft.id)];
      sync?.queue(draft);
      publish();
    },
    remove: (id: string, owner?: symbol) => {
      if (leases.has(id) && leases.get(id)?.owner !== owner) return false;
      if (sync) {
        void sync
          .discard(id)
          .then(() => {
            rows = rows.filter((row) => row.id !== id);
            publish();
          })
          .catch(() => {
            publish();
          });
      } else rows = rows.filter((row) => row.id !== id);
      publish();
      return true;
    },
    clear: () => {
      rows = EMPTY;
      publish();
    },
  };
}
const Context = createContext<ReturnType<typeof createDraftStore> | null>(null);
const noSubscribe = () => () => {};
const NO_LOCKS: readonly string[] = [];

/** Lives inside the account-bound session. No business drafts are written to disk. */
export function WorkspaceDraftsProvider({
  children,
  synchronize = false,
}: {
  children: ReactNode;
  synchronize?: boolean;
}) {
  const [store] = useState(() => createDraftStore(synchronize));
  const { register } = useUnsavedWork();
  useEffect(() => {
    if (!synchronize) return;
    store.sync?.activate();
    const controller = new AbortController();
    backendGet<WorkspaceDraft[]>('/workspace/drafts', { signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) store.hydrate(rows);
      })
      .catch(() => { if(!controller.signal.aborted)store.setError('Saved drafts could not be loaded. Reconnect and reload before resuming earlier work.'); });
    const retry = () => store.sync?.retry();
    window.addEventListener('online', retry);
    return () => {
      controller.abort();
      store.sync?.dispose();
      store.clear();
      window.removeEventListener('online', retry);
    };
  }, [store, synchronize]);
  useEffect(
    () =>
      register(Symbol('retained-workspace-drafts'), {
        dirty: store.unsynced,
        reset: store.clear,
        exitOnly: true,
      }),
    [register, store],
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useWorkspaceDrafts(appId?: string) {
  const store = useContext(Context);
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.version ?? (() => 0), () => 0);
  const rows = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.read ?? (() => EMPTY),
    () => EMPTY,
  );
  const locked = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.readLocked ?? (() => NO_LOCKS),
    () => NO_LOCKS,
  );
  return {
    available: !!store,
    error: store?.error() ?? '',
    drafts: appId ? rows.filter((row) => row.appId === appId) : rows,
    locked,
    remove: (id: string) => store?.remove(id),
  };
}

/** Retains user input and the request identity, never replaying a transaction automatically. */
export function useWorkspaceDraftForm<T>(
  initial: T | (() => T),
  options: {
    appId: string;
    title: string;
    describe?: (values: T) => string;
    context: Record<string, string> | ((values: T) => Record<string, string>);
    draftId?: string;
    needsReview?: boolean;
    reviewKey?: string;
    busy: boolean;
    onClose: () => void;
  },
) {
  const store = useContext(Context);
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.version ?? (() => 0), () => 0);
  const [id] = useState(() => options.draftId ?? crypto.randomUUID());
  const [owner] = useState(() => Symbol('draft-editor'));
  const [availabilityError, setAvailabilityError] = useState('');
  useLayoutEffect(() => {
    if (!store) return;
    if (
      (options.draftId &&
        !store.read().some((row) => row.id === id && row.appId === options.appId)) ||
      !store.claim(id, owner, !!options.draftId)
    )
      setAvailabilityError(
        'This draft is open in another window or is no longer available. Close this form and resume it from the draft list.',
      );
    return () => store.release(id, owner);
  }, [store, id, owner, options.draftId, options.appId]);
  const ownsDraft = () => !store || store.owns(id, owner);
  const [source] = useState(() =>
    store?.read().find((row) => row.id === id && row.appId === options.appId),
  );
  const [form, setForm] = useState<T>(() =>
    source
      ? (source.values as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial,
  );
  const requestId = useRef<string | null>(source?.requestId ?? null);
  const requestContext = useRef<Record<string, string> | null>(
    source?.requestId ? source.context : null,
  );
  const needsReview = !!options.needsReview || !!source?.needsReview;
  const reviewKey = needsReview ? (options.reviewKey ?? 'source') : '';
  const [reviewedKey, setReviewedKey] = useState('');
  const reviewed = !needsReview || reviewedKey === reviewKey;
  const setReviewed = (accepted: boolean) => setReviewedKey(accepted ? reviewKey : '');
  const context = () =>
    typeof options.context === 'function' ? options.context(form) : options.context;
  const retain = () =>
    store?.put(
      {
        id,
        appId: options.appId,
        title: options.title,
        summary: options.describe?.(form).trim().slice(0, 160),
        context: requestContext.current ?? context(),
        values: form,
        requestId: requestId.current,
        needsReview: !reviewed,
        updatedAt: Date.now(),
      },
      owner,
    );
  const guard = useFormGuard(
    form,
    (baseline) => {
      store?.remove(id, owner);
      setForm(baseline);
    },
    store
      ? {
          keep: retain,
          canKeep: () => !options.busy && ownsDraft(),
          enabled: ownsDraft,
          initiallyDirty: !!source,
        }
      : undefined,
  );
  const actions = useRef({retain,ownsDraft,isDirty:guard.isDirty});
  useLayoutEffect(() => { actions.current = {retain,ownsDraft,isDirty:guard.isDirty}; });
  useEffect(() => {
    if (!store?.sync || options.busy || !actions.current.isDirty() || !actions.current.ownsDraft()) return;
    const timer = setTimeout(() => actions.current.retain(), 1000);
    return () => clearTimeout(timer);
  }, [form, options.busy, store]);
  useEffect(() => {
    if (!store?.sync) return;
    const timer = setInterval(() => {
      if (actions.current.ownsDraft()) void store.sync?.claim(id).catch(() => { setAvailabilityError(store.sync?.error(id) ?? 'Draft lease could not be renewed.'); });
    }, 20000);
    return () => clearInterval(timer);
  }, [store, id, owner]);
  const saveNow = async () => {
    if (!store?.sync || !draftFormType(options.appId, context())) return;
    retain();
    await store.sync.flush(id);
  };
  return {
    form,
    setForm,
    requestId,
    requestContext,
    beginRequest: () => {
      if (!ownsDraft()) return;
      requestId.current ??= crypto.randomUUID();
      requestContext.current ??= context();
      return saveNow();
    },
    saveNow,
    syncStatus: store?.sync?.status(id),
    syncError: store?.sync?.error(id),
    guard,
    availabilityError,
    needsReview,
    reviewed,
    setReviewed,
    canRetain: !!store && !availabilityError,
    keep: () => {
      if (!store || options.busy || !ownsDraft()) return;
      retain();
      guard.markSaved();
      options.onClose();
    },
    markSaved: () => {
      if (!ownsDraft()) return;
      guard.markSaved();
      store?.remove(id, owner);
    },
    validateReview: () => {
      if (!ownsDraft())
        throw new Error(availabilityError || 'This draft is no longer available in this window.');
      if (!reviewed)
        throw new Error('Review the latest record and confirm below before saving this draft.');
    },
  };
}

export function DraftFormNotice({
  draft,
  children,
}: {
  draft: {
    canRetain: boolean;
    availabilityError?: string;
    needsReview: boolean;
    reviewed: boolean;
    setReviewed: (value: boolean) => void;
    syncStatus?: DraftSyncStatus;
    syncError?: string;
  };
  children?: ReactNode;
}) {
  return (
    <>
      {draft.availabilityError && (
        <p role="alert" className="workspace-notice">
          {draft.availabilityError}
        </p>
      )}
      {draft.canRetain && (
        <p className="workspace-draft-hint" role="status">
          {draft.syncStatus
            ? `${draft.syncStatus}${draft.syncError ? ` · ${draft.syncError}` : ' · Private draft'}`
            : 'Your unfinished work stays here. Supported forms save privately after you pause typing.'}
        </p>
      )}
      {draft.needsReview && (
        <div className="workspace-draft-review" role="note">
          {/* Every caller raises needsReview only when its reviewKey stops matching
              the version the draft was aligned to, so this block always means the
              record moved underneath the draft rather than merely that work was
              restored. The heading states that fact; the line below is the part
              that reassures. */}
          <strong>The source record has changed.</strong>
          <p>
            Your entered values are preserved. Check them against the latest balance and record
            details before saving.
          </p>
          {children}
          <label>
            <input
              type="checkbox"
              checked={draft.reviewed}
              onChange={(event) => draft.setReviewed(event.target.checked)}
            />
            I have reviewed the latest record and my draft values.
          </label>
        </div>
      )}
    </>
  );
}

export function WorkspaceDraftShelf({
  appId,
  onResume,
  activeDraftId,
  filter,
}: {
  appId: string;
  onResume: (draft: WorkspaceDraft) => void | Promise<void>;
  activeDraftId?: string;
  filter?: (draft: WorkspaceDraft) => boolean;
}) {
  const store = useContext(Context);
  const { drafts: allDrafts, locked, remove } = useWorkspaceDrafts(appId);
  const drafts = allDrafts.filter((row) => row.id !== activeDraftId && (!filter || filter(row)));
  const [discard, setDiscard] = useState<WorkspaceDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function resume(draft: WorkspaceDraft) {
    if (pending.current) return;
    pending.current = true;
    setBusy(draft.id);
    setError('');
    const reservation = Symbol('draft-opening');
    try {
      const current = store?.sync ? await store.sync.fresh(draft.id) : draft;
      if (store?.sync) {
        store.hydrate([current]);
        await store.sync.claim(draft.id);
      }
      store?.beginOpen(draft.id, reservation);
      await onResume(current);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : 'Could not resume this draft. Please try again.',
        );
    } finally {
      store?.release(draft.id, reservation);
      pending.current = false;
      if (mounted.current) setBusy('');
    }
  }
  if (!drafts.length) return null;
  return (
    <section className="workspace-draft-shelf" aria-label="Unfinished drafts">
      <header>
        <FilePenLine size={18} aria-hidden="true" />
        <div>
          <strong>Pick up where you left off</strong>
          <p>Private unfinished work · not yet submitted to company records</p>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id}>
            <span>
              {draft.title}
              {draft.summary && <small>{draft.summary}</small>}
              <small>
                Kept at{' '}
                {new Date(draft.updatedAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </span>
            <button
              type="button"
              disabled={!!busy || locked.includes(draft.id)}
              onClick={() => void resume(draft)}
              aria-label={`Resume ${draft.title}`}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {busy === draft.id
                ? 'Opening…'
                : locked.includes(draft.id)
                  ? 'Open in another window'
                  : 'Resume'}
            </button>
            <button
              type="button"
              disabled={!!busy || locked.includes(draft.id)}
              onClick={() => setDiscard(draft)}
              aria-label={`Discard ${draft.title}`}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>Discard</span>
            </button>
          </li>
        ))}
      </ul>
      <Modal
        open={!!discard}
        title="Discard draft?"
        size="sm"
        onClose={() => setDiscard(null)}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setDiscard(null)}>
              Keep draft
            </Btn>
            <Btn
              onClick={() => {
                if (discard && !remove(discard.id))
                  setError(
                    'This draft is open in another window. Close it there before discarding it.',
                  );
                setDiscard(null);
              }}
            >
              Discard draft
            </Btn>
          </>
        }
      >
        <p>
          This removes your unfinished {discard?.title.toLowerCase()}. It does not change any saved
          company record.
        </p>
      </Modal>
    </section>
  );
}
