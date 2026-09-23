'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { NAV, isGroup } from '@/components/layout/sidebar';
import { APP_REGISTRY } from '@/lib/apps';
import './unsaved-work.css';

type Intent = 'navigate' | 'close' | 'exit';
type WorkScope = {
  id: string;
  /** An explicitly mounted app may stay open while the main route changes. */
  survivesNavigation?: (href: string) => boolean;
};
type RequestOptions = { scope?: string; href?: string };
const ScopeContext = createContext<WorkScope | undefined>(undefined);

export function UnsavedWorkScope({ children, ...scope }: WorkScope & { children: ReactNode }) {
  const value = useMemo(
    () => ({ id: scope.id, survivesNavigation: scope.survivesNavigation }),
    [scope.id, scope.survivesNavigation],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

type Draft = {
  dirty: () => boolean;
  reset: () => void;
  keep?: () => void;
  canKeep?: () => boolean;
  exitOnly?: boolean;
  scope?: WorkScope;
};

function affected(draft: Draft, intent: Intent, options?: RequestOptions) {
  if (options?.scope && draft.scope?.id !== options.scope) return false;
  if (intent === 'exit') return true;
  if (draft.exitOnly) return false;
  return !(
    intent === 'navigate' &&
    options?.href &&
    draft.scope?.survivesNavigation?.(options.href)
  );
}
// Only known workspace routes can retain drafts across client navigation.
function workspaceDestination(href: string) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return false;
  const paths = [
    ...APP_REGISTRY.map((app) => app.href),
    '/apps',
    '/desktop',
    ...NAV.flatMap((item) =>
      isGroup(item) ? item.children.map((child) => child.href) : [item.href],
    ),
  ];
  return paths.some(
    (path) =>
      path.startsWith('/') &&
      path !== '/' &&
      (url.pathname === path.split('?')[0] || url.pathname.startsWith(`${path.split('?')[0]}/`)),
  );
}
type Guard = {
  register: (id: symbol, draft: Draft) => () => void;
  request: (action: () => void, id?: symbol, intent?: Intent, options?: RequestOptions) => void;
};
const Context = createContext<Guard>({ register: () => () => {}, request: (action) => action() });
const HISTORY_INDEX = '__itembaWorkspaceIndex';
type WorkspaceNavigateEvent = Event & {
  navigationType: string;
  canIntercept: boolean;
  destination: { key: string; url?: string };
};
type WorkspaceNavigation = EventTarget & { traverseTo: (key: string) => unknown };

export function UnsavedWorkProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const drafts = useRef(new Map<symbol, Draft>());
  const pendingRef = useRef<{ action: () => void; drafts: Draft[]; canKeep: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const register = useCallback((id: symbol, draft: Draft) => {
    drafts.current.set(id, draft);
    return () => {
      drafts.current.delete(id);
    };
  }, []);
  const request = useCallback(
    (action: () => void, id?: symbol, intent: Intent = 'exit', options?: RequestOptions) => {
      if (pendingRef.current) return;
      const changed = [...drafts.current.entries()]
        .filter(
          ([key, draft]) =>
            (!id || key === id) && affected(draft, intent, options) && draft.dirty(),
        )
        .map(([, draft]) => draft);
      if (!changed.length) {
        action();
        return;
      }
      pendingRef.current = {
        action,
        drafts: changed,
        canKeep:
          intent !== 'exit' &&
          changed.every((draft) => draft.keep && (!draft.canKeep || draft.canKeep())),
      };
      setPending(true);
    },
    [],
  );
  const resolve = useCallback((choice: 'stay' | 'discard' | 'keep') => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(false);
    dialog.current?.close();
    if (choice !== 'stay' && current) {
      if (choice === 'keep' && !current.canKeep) return;
      current.drafts.forEach((draft) => (choice === 'keep' ? draft.keep?.() : draft.reset()));
      current.action();
    }
  }, []);
  useEffect(() => {
    if (!pending) return;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, [pending]);

  useEffect(() => {
    const dirty = (intent: Intent = 'exit', options?: RequestOptions) =>
      [...drafts.current.values()].some(
        (draft) => affected(draft, intent, options) && draft.dirty(),
      );
    const navigation = (window as Window & { navigation?: WorkspaceNavigation }).navigation;
    const onNavigate = (event: Event) => {
      const traversal = event as WorkspaceNavigateEvent;
      const intent =
        traversal.navigationType === 'traverse' &&
        traversal.destination.url &&
        workspaceDestination(traversal.destination.url)
          ? 'navigate'
          : 'exit';
      if (
        !['traverse', 'reload'].includes(traversal.navigationType) ||
        !traversal.cancelable ||
        !traversal.canIntercept ||
        !dirty(intent, { href: traversal.destination.url })
      )
        return;
      traversal.preventDefault();
      request(
        () => {
          if (traversal.navigationType === 'reload') location.reload();
          else navigation?.traverseTo(traversal.destination.key);
        },
        undefined,
        intent,
        { href: traversal.destination.url },
      );
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!dirty()) return;
      event.preventDefault();
      event.returnValue = 'You have unsaved changes.';
    };
    const onClick = (event: MouseEvent) => {
      if (
        !dirty() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (
        !target ||
        target.hasAttribute('download') ||
        target.dataset.preserveWorkspace !== undefined ||
        (target.target && target.target !== '_self')
      )
        return;
      const url = new URL(target.href, location.href);
      const intent = workspaceDestination(url.href) ? 'navigate' : 'exit';
      if (!dirty(intent, { href: url.href })) return;
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        (url.pathname === location.pathname &&
          url.search === location.search &&
          url.origin === location.origin)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      request(
        () => {
          if (url.origin === location.origin) router.push(url.pathname + url.search + url.hash);
          else location.assign(url.href);
        },
        undefined,
        intent,
        { href: url.href },
      );
    };
    window.addEventListener('beforeunload', onUnload);
    navigation?.addEventListener('navigate', onNavigate);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      navigation?.removeEventListener('navigate', onNavigate);
      document.removeEventListener('click', onClick, true);
    };
  }, [request, router]);

  useEffect(() => {
    // Keep Next's own history state intact. An index lets us undo a cancelled
    // traversal before its popstate reaches Next and unmounts the current form.
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    let active = true;
    let index = Number.isSafeInteger(history.state?.[HISTORY_INDEX])
      ? (history.state[HISTORY_INDEX] as number)
      : 0;
    let currentUrl = location.href;
    let currentState = { ...history.state, [HISTORY_INDEX]: index };
    let restoring = false;
    let afterRestore: (() => void) | null = null;
    originalReplace.call(history, currentState, '', currentUrl);
    const push: History['pushState'] = function (this: History, data, unused, url) {
      if (!active) return originalPush.call(this, data, unused, url);
      index += 1;
      originalPush.call(this, { ...data, [HISTORY_INDEX]: index }, unused, url);
      currentUrl = location.href;
      currentState = history.state;
    };
    const replace: History['replaceState'] = function (this: History, data, unused, url) {
      if (!active) return originalReplace.call(this, data, unused, url);
      originalReplace.call(this, { ...data, [HISTORY_INDEX]: index }, unused, url);
      currentUrl = location.href;
      currentState = history.state;
    };
    history.pushState = push;
    history.replaceState = replace;
    const onPop = (event: PopStateEvent) => {
      const target = event.state?.[HISTORY_INDEX];
      if (restoring) {
        event.stopImmediatePropagation();
        if (target === index) {
          restoring = false;
          const resume = afterRestore;
          afterRestore = null;
          resume?.();
        } else if (Number.isSafeInteger(target)) history.go(index - target);
        return;
      }
      const intent = workspaceDestination(location.href) ? 'navigate' : 'exit';
      const changed = [...drafts.current.values()].filter(
        (draft) => affected(draft, intent, { href: location.href }) && draft.dirty(),
      );
      if (changed.length) {
        event.stopImmediatePropagation();
        if (Number.isSafeInteger(target) && target !== index) {
          const delta = target - index;
          restoring = true;
          history.go(-delta);
          request(
            () => {
              const resume = () => history.go(delta);
              if (restoring) afterRestore = resume;
              else resume();
            },
            undefined,
            intent,
            { href: location.href },
          );
        } else {
          // Entries created before this shell mounted have no index. Preserve
          // the draft and offer navigation to that URL after an explicit discard.
          const targetUrl = location.href;
          originalPush.call(history, currentState, '', currentUrl);
          request(() => router.push(targetUrl), undefined, intent, { href: targetUrl });
        }
        return;
      }
      changed.forEach((draft) => draft.reset());
      index = Number.isSafeInteger(target) ? target : index - 1;
      currentUrl = location.href;
      currentState = { ...event.state, [HISTORY_INDEX]: index };
    };
    window.addEventListener('popstate', onPop, true);
    return () => {
      active = false;
      window.removeEventListener('popstate', onPop, true);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
    };
  }, [request, router]);
  const value = useMemo(() => ({ register, request }), [register, request]);
  return (
    <Context.Provider value={value}>
      {children}
      <dialog
        ref={dialog}
        className="unsaved-work-dialog"
        aria-labelledby="unsaved-work-title"
        onCancel={(event) => {
          event.preventDefault();
          resolve('stay');
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <h2 id="unsaved-work-title">Keep your changes?</h2>
        <p>
          {pendingRef.current?.canKeep
            ? 'Keep a draft to return to in this session, or stay here to finish. Drafts are lost when you close or reload this tab or sign out.'
            : 'Your changes haven’t been saved. Stay here to finish, or discard them to continue.'}
        </p>
        <div>
          <button autoFocus onClick={() => resolve('stay')}>
            Stay here
          </button>
          {pendingRef.current?.canKeep && (
            <button className="unsaved-keep" onClick={() => resolve('keep')}>
              Keep draft and continue
            </button>
          )}
          <button className="unsaved-discard" onClick={() => resolve('discard')}>
            Discard changes
          </button>
        </div>
      </dialog>
    </Context.Provider>
  );
}

export const useUnsavedWork = () => useContext(Context);
export const useUnsavedWorkScopeId = () => useContext(ScopeContext)?.id;

function snapshot(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    typeof File !== 'undefined' && item instanceof File
      ? { name: item.name, size: item.size, type: item.type, lastModified: item.lastModified }
      : item,
  );
}

/** Async defaults stay pristine until the first user edit. Reverting values is clean again. */
export function useFormGuard<T>(
  value: T,
  onDiscard?: (baseline: T) => void,
  retention?: {
    keep: () => void;
    canKeep?: () => boolean;
    initiallyDirty?: boolean;
    enabled?: () => boolean;
  },
) {
  const guard = useUnsavedWork();
  const scope = useContext(ScopeContext);
  const id = useRef(Symbol('draft'));
  const state = useRef({
    current: snapshot(value),
    baseline: snapshot(value),
    baselineValue: value,
    value,
    onDiscard,
    touched: false,
    retention,
    forceDirty: !!retention?.initiallyDirty,
  });
  useLayoutEffect(() => {
    state.current.current = snapshot(value);
    state.current.value = value;
    state.current.onDiscard = onDiscard;
    state.current.retention = retention;
    if (!state.current.touched) {
      state.current.baseline = state.current.current;
      state.current.baselineValue = value;
    }
  });
  const markSaved = useCallback(() => {
    state.current.baseline = state.current.current;
    state.current.baselineValue = state.current.value;
    state.current.touched = false;
    state.current.forceDirty = false;
  }, []);
  const discard = useCallback(() => {
    state.current.onDiscard?.(state.current.baselineValue);
    markSaved();
  }, [markSaved]);
  useEffect(
    () =>
      guard.register(id.current, {
        scope,
        dirty: () =>
          (state.current.retention?.enabled?.() ?? true) &&
          (state.current.forceDirty ||
            (state.current.touched && state.current.current !== state.current.baseline)),
        keep: () => {
          state.current.retention?.keep();
          markSaved();
        },
        canKeep: () => !!state.current.retention && (state.current.retention.canKeep?.() ?? true),
        reset: discard,
      }),
    [guard, discard, markSaved, scope],
  );
  const touch = useCallback(() => {
    state.current.touched = true;
  }, []);
  const requestClose = useCallback(
    (close: () => void) =>
      guard.request(
        () => {
          markSaved();
          close();
        },
        id.current,
        'close',
      ),
    [guard, markSaved],
  );
  return {
    touch,
    isDirty: () =>
      state.current.forceDirty ||
      (state.current.touched && state.current.current !== state.current.baseline),
    markSaved,
    requestClose,
    capture: { onChangeCapture: touch, onInputCapture: touch },
    change: (action: () => void) => {
      touch();
      action();
    },
  };
}

export function useGuardedRouter() {
  const router = useRouter();
  const { request } = useUnsavedWork();
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) =>
        request(
          () => router.push(...args),
          undefined,
          workspaceDestination(args[0]) ? 'navigate' : 'exit',
          { href: args[0] },
        ),
      replace: (...args: Parameters<typeof router.replace>) =>
        request(
          () => router.replace(...args),
          undefined,
          workspaceDestination(args[0]) ? 'navigate' : 'exit',
          { href: args[0] },
        ),
      back: () => request(() => router.back()),
      forward: () => request(() => router.forward()),
    }),
    [router, request],
  );
}
