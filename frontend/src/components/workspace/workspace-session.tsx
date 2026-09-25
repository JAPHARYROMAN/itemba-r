'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  isDesktopViewValue,
  parseDesktopViewState,
  type DesktopViewState,
} from '@/lib/desktop-view-state';

function createSession() {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    read<T>(key: string, fallback: T): T {
      return values.has(key) ? (values.get(key) as T) : fallback;
    },
    write<T>(key: string, value: T) {
      if (Object.is(values.get(key), value)) return;
      values.set(key, value);
      listeners.get(key)?.forEach((listener) => listener());
    },
    subscribe(key: string, listener: () => void) {
      const group = listeners.get(key) ?? new Set();
      group.add(listener);
      listeners.set(key, group);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(key);
      };
    },
  };
}
const Context = createContext<ReturnType<typeof createSession> | null>(null);
const InstanceContext = createContext('');
const ViewContext = createContext<{
  initial: DesktopViewState;
  save: (key: string, value: unknown) => void;
} | null>(null);

/** Each desktop window owns its view state; drafts remain account-scoped. */
export function WorkspaceInstanceProvider({
  id,
  appId = '',
  viewState,
  onViewChange,
  children,
}: {
  id: string;
  appId?: string;
  viewState?: DesktopViewState;
  onViewChange?: (id: string, viewState: DesktopViewState) => void;
  children: ReactNode;
}) {
  const [initial] = useState(() => parseDesktopViewState(appId, viewState));
  const snapshot = useRef(initial);
  const notify = useRef(onViewChange);
  useLayoutEffect(() => {
    notify.current = onViewChange;
  }, [onViewChange]);
  const value = useMemo(
    () => ({
      initial,
      save: (key: string, next: unknown) => {
        if (!isDesktopViewValue(appId, key, next)) return;
        snapshot.current = { version: 1, values: { ...snapshot.current.values, [key]: next } };
        notify.current?.(id, snapshot.current);
      },
    }),
    [appId, id, initial],
  );
  return (
    <InstanceContext.Provider value={id}>
      <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
    </InstanceContext.Provider>
  );
}
export function useWorkspaceInstanceId() {
  return useContext(InstanceContext);
}

/** Account changes remount this boundary. Business view state never goes to disk. */
export function WorkspaceSessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const boundary = JSON.stringify([
    user?.id,
    user?.companyId,
    user?.permissions,
    user?.companyAccess,
    user?.divisionAccess,
    user?.branchAccess,
  ]);
  return <Session key={boundary}>{children}</Session>;
}

function Session({ children }: { children: ReactNode }) {
  const [session] = useState(createSession);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

/** Keep explicit view state across app navigation without caching server responses. */
export function useWorkspaceState<T>(
  stateKey: string | undefined,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(Context);
  const instanceId = useContext(InstanceContext);
  const view = useContext(ViewContext);
  const key = stateKey && instanceId ? `${instanceId}:${stateKey}` : stateKey;
  const [fallback, setFallback] = useState<T>(() =>
    stateKey && Object.hasOwn(view?.initial.values ?? {}, stateKey)
      ? (view!.initial.values[stateKey] as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial,
  );
  const subscribe = useCallback(
    (listener: () => void) => (session && key ? session.subscribe(key, listener) : () => {}),
    [session, key],
  );
  const read = useCallback(
    () => (session && key ? session.read(key, fallback) : fallback),
    [session, key, fallback],
  );
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (!session || !key) {
        setFallback(next);
        return;
      }
      const previous = session.read(key, fallback);
      const updated = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      session.write(key, updated);
      if (stateKey) view?.save(stateKey, updated);
    },
    [session, key, fallback, stateKey, view],
  );
  return [value, set];
}
