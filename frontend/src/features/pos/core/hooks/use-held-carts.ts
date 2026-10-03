'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clearActiveCart,
  holdActiveCart,
  listHeldCarts,
  readActiveCart,
  resumeHeldCart,
  saveActiveCart,
  updateHeldCart,
  type PosCartDraft,
} from '../pos-workspace-store';

export type CartInputs = Pick<
  PosCartDraft,
  'cart' | 'customer' | 'paymentMethod' | 'paymentReference' | 'receivedValue'
>;
export function useHeldCarts({
  scope,
  instance,
  enabled,
  inputs,
  editable,
  restore,
  resolveSubmitted,
}: {
  scope: string | null;
  instance: string;
  enabled: boolean;
  inputs: CartInputs;
  editable: boolean;
  restore: (inputs: CartInputs) => void | Promise<void>;
  resolveSubmitted: (requestId: string) => Promise<'done' | 'editable' | 'blocked'>;
}) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<'saving' | 'saved' | 'attention'>('saved');
  const [held, setHeld] = useState<PosCartDraft[]>([]);
  const [restored, setRestored] = useState(false);
  const [retry, setRetry] = useState(0);
  const draft = useRef<PosCartDraft | null>(null);
  const activeScope = useRef<string | null>(null);
  const latest = useRef({ inputs, restore, editable, resolveSubmitted, scope, enabled });
  useLayoutEffect(() => {
    latest.current = { inputs, restore, editable, resolveSubmitted, scope, enabled };
  });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const serial = useCallback(<T>(action: () => Promise<T>): Promise<T> => {
    const pending = queue.current.catch(() => undefined).then(action);
    queue.current = pending;
    return pending;
  }, []);
  const refresh = useCallback(async () => {
    if (scope && enabled) {
      const items = await listHeldCarts(scope);
      if (latest.current.scope === scope && latest.current.enabled) setHeld(items);
    }
  }, [scope, enabled]);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setHeld([]);
    setStatus('saved');
    draft.current = null;
    setRestored(false);
    const clearPrivate = activeScope.current !== null;
    activeScope.current = scope && enabled ? scope : null;
    if (activeScope.current || clearPrivate)
      latest.current.restore({
        cart: [],
        customer: null,
        paymentMethod: 'CASH',
        paymentReference: '',
        receivedValue: '',
      });
    if (!scope || !enabled) return;
    void serial(async () => {
      let saved = await readActiveCart(scope, instance);
      if (cancelled) return;
      if (saved?.state === 'submitted') {
        const state = await latest.current.resolveSubmitted(saved.requestId);
        if (cancelled) return;
        if (state === 'done') {
          await clearActiveCart(scope, instance, saved.id, saved.revision);
          saved = null;
        } else if (state === 'editable')
          saved = await saveActiveCart({ ...saved, state: 'active' }, saved.revision);
        else {
          setStatus('attention');
          return;
        }
      }
      if (cancelled) return;
      draft.current = saved;
      if (saved?.state === 'active') {
        await latest.current.restore(saved);
        if (cancelled) return;
        setRestored(saved.cart.length > 0);
      }
      await refresh();
      if (!cancelled) setReady(true);
    }).catch(() => {
      if (!cancelled) setStatus('attention');
    });
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [scope, instance, enabled, refresh, serial, retry]);

  const persist = useCallback(async () => {
    if (
      !scope ||
      !enabled ||
      scope !== latest.current.scope ||
      !latest.current.enabled ||
      draft.current?.state === 'submitted'
    )
      return;
    const current = draft.current ?? {
      schemaVersion: 1 as const,
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      revision: 0,
      scope,
      instance,
      state: 'active' as const,
      name: '',
      note: '',
      updatedAt: new Date().toISOString(),
      ...latest.current.inputs,
    };
    // Empty fresh carts need no device record and must not block a held-cart claim.
    if (!current.cart.length && !latest.current.inputs.cart.length && !draft.current) {
      setStatus('saved');
      return;
    }
    const saved = await saveActiveCart(
      { ...current, ...structuredClone(latest.current.inputs) },
      current.revision,
    );
    draft.current = saved;
    setStatus('saved');
  }, [scope, instance, enabled]);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    setStatus('saving');
    try {
      await serial(persist);
    } catch (error) {
      setStatus('attention');
      throw error;
    }
  }, [persist, serial]);
  useEffect(() => {
    if (!ready || !editable || !enabled) return;
    setStatus('saving');
    timer.current = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer.current);
  }, [inputs, editable, ready, enabled, flush]);
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (enabled && status !== 'saved' && latest.current.inputs.cart.length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [enabled, status]);
  // Notifications carry no cart contents. Re-read the owner/scope-filtered store.
  useEffect(() => {
    if (!scope || !enabled) return;
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('itemba-pos-held') : null;
    const changed = () => {
      void refresh().catch(() => setStatus('attention'));
    };
    channel?.addEventListener('message', changed);
    window.addEventListener('itemba-pos-held', changed);
    return () => {
      channel?.close();
      window.removeEventListener('itemba-pos-held', changed);
    };
  }, [scope, enabled, refresh]);
  const notify = () => {
    window.dispatchEvent(new Event('itemba-pos-held'));
    if (typeof BroadcastChannel !== 'undefined') {
      const c = new BroadcastChannel('itemba-pos-held');
      c.postMessage('changed');
      c.close();
    }
  };
  const assertScope = (item?: PosCartDraft) => {
    if (
      !scope ||
      !enabled ||
      !latest.current.enabled ||
      latest.current.scope !== scope ||
      (item && item.scope !== scope)
    )
      throw new Error('This workspace is no longer authorised.');
  };
  return {
    ready: !enabled || ready,
    status,
    held,
    restored,
    review: () => setRestored(false),
    retry: async () => {
      if (ready) await flush();
      else setRetry((value) => value + 1);
    },
    flush,
    hold: async (name: string, note: string) => {
      await flush();
      await serial(async () => {
        assertScope(draft.current ?? undefined);
        if (!draft.current?.cart.length || draft.current.state !== 'active')
          throw new Error('No unpaid cart to hold.');
        await holdActiveCart(
          { ...draft.current, name: name.trim().slice(0, 80), note: note.trim().slice(0, 500) },
          draft.current.revision,
        );
        draft.current = null;
      });
      notify();
      await refresh();
      setRestored(false);
    },
    resume: async (item: PosCartDraft) => {
      clearTimeout(timer.current);
      await serial(async () => {
        assertScope(item);
        if (!scope || latest.current.inputs.cart.length)
          throw new Error('Hold or discard the current unpaid cart first.');
        if (draft.current)
          await clearActiveCart(scope, instance, draft.current.id, draft.current.revision);
        const claimed = await resumeHeldCart(scope, instance, item.id, item.revision);
        draft.current = claimed;
        setReady(false);
        try {
          await latest.current.restore(claimed);
          setReady(true);
        } catch (error) {
          setStatus('attention');
          throw error;
        }
        setRestored(true);
      });
      notify();
      await refresh();
    },
    rename: async (item: PosCartDraft, name: string) => {
      assertScope(item);
      await updateHeldCart({ ...item, name });
      notify();
      await refresh();
    },
    discard: async (item: PosCartDraft) => {
      assertScope(item);
      await updateHeldCart(item, true);
      notify();
      await refresh();
    },
    clear: async () => {
      clearTimeout(timer.current);
      await serial(async () => {
        assertScope(draft.current ?? undefined);
        if (draft.current && scope)
          await clearActiveCart(scope, instance, draft.current.id, draft.current.revision);
        draft.current = null;
      });
      setRestored(false);
      setStatus('saved');
    },
    protect: async () => {
      await flush();
      return serial(async () => {
        assertScope(draft.current ?? undefined);
        if (!draft.current) throw new Error('Cart is not saved.');
        draft.current = await saveActiveCart(
          { ...draft.current, state: 'submitted' },
          draft.current.revision,
        );
        return draft.current.requestId;
      });
    },
    unlock: async () =>
      serial(async () => {
        assertScope(draft.current ?? undefined);
        if (draft.current?.state === 'submitted')
          draft.current = await saveActiveCart(
            { ...draft.current, state: 'active' },
            draft.current.revision,
          );
      }),
  };
}
