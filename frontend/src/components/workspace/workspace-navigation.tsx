'use client';

import NextLink from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useGuardedRouter, useUnsavedWork, useUnsavedWorkScopeId } from './unsaved-work-provider';
import { useWorkspaceState } from './workspace-session';

type History = { entries: string[]; index: number };
type Navigation = {
  href: string;
  owns: (href: string) => boolean;
  navigate: (href: string, replace?: boolean) => boolean;
  readSearch: () => URLSearchParams;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
};
const Context = createContext<Navigation | null>(null);

/** Explicit app navigation, independent of the main Next route and scoped to this session. */
export function WorkspaceNavigationProvider({
  appId,
  initialHref,
  ownsPath,
  children,
  onHrefChange,
}: {
  appId: string;
  initialHref: string;
  ownsPath: (pathname: string) => boolean;
  children: ReactNode;
  onHrefChange?: (href: string) => void;
}) {
  const [history, setHistory] = useWorkspaceState<History>(`${appId}.navigation`, {
    entries: [initialHref],
    index: 0,
  });
  const current = useRef(history);
  const notify = useRef(onHrefChange);
  useLayoutEffect(() => {
    notify.current = onHrefChange;
  }, [onHrefChange]);
  const previousHref = useRef(initialHref);
  useLayoutEffect(() => {
    if (previousHref.current === initialHref) return;
    previousHref.current = initialHref;
    if (initialHref !== current.current.entries[current.current.index])
      setHistory({ entries: [initialHref], index: 0 });
  }, [initialHref, setHistory]);
  useLayoutEffect(() => {
    current.current = history;
  }, [history]);
  const { request } = useUnsavedWork();
  const scope = useUnsavedWorkScopeId();
  const resolve = useCallback(
    (href: string) => {
      const url = new URL(
        href,
        `${window.location.origin}${current.current.entries[current.current.index]}`,
      );
      return url.origin === window.location.origin && ownsPath(url.pathname)
        ? `${url.pathname}${url.search}${url.hash}`
        : null;
    },
    [ownsPath],
  );
  const commit = useCallback(
    (next: History) => {
      // Debounced searches must read the latest app scope even before React commits.
      current.current = next;
      setHistory(next);
      notify.current?.(next.entries[next.index]);
    },
    [setHistory],
  );
  const navigate = useCallback(
    (href: string, replace = false) => {
      const target = resolve(href);
      if (target === null) return false;
      if (target === current.current.entries[current.current.index]) return true;
      request(
        () => {
          const previous = current.current;
          const entries = replace
            ? [...previous.entries]
            : previous.entries.slice(0, previous.index + 1);
          if (replace) entries[previous.index] = target;
          else entries.push(target);
          const bounded = entries.slice(-40);
          commit({ entries: bounded, index: replace ? previous.index : bounded.length - 1 });
        },
        undefined,
        'close',
        { scope },
      );
      return true;
    },
    [resolve, request, scope, commit],
  );
  const traverse = useCallback(
    (step: number) => {
      const nextIndex = current.current.index + step;
      if (nextIndex < 0 || nextIndex >= current.current.entries.length) return;
      request(() => commit({ ...current.current, index: nextIndex }), undefined, 'close', {
        scope,
      });
    },
    [request, scope, commit],
  );
  const readSearch = useCallback(
    () =>
      new URL(current.current.entries[current.current.index], window.location.origin).searchParams,
    [],
  );
  const value = useMemo<Navigation>(
    () => ({
      href: history.entries[history.index],
      owns: (href) => resolve(href) !== null,
      navigate,
      readSearch,
      back: () => traverse(-1),
      forward: () => traverse(1),
      canBack: history.index > 0,
      canForward: history.index < history.entries.length - 1,
    }),
    [history, resolve, navigate, readSearch, traverse],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspacePathname() {
  const pathname = usePathname();
  const navigation = useContext(Context);
  return navigation ? navigation.href.split(/[?#]/)[0] : pathname;
}
export function useWorkspaceSearchParams() {
  const params = useSearchParams();
  const navigation = useContext(Context);
  return useMemo(
    () =>
      navigation ? new URLSearchParams(navigation.href.split('?')[1]?.split('#')[0] ?? '') : params,
    [navigation, params],
  );
}
export function useWorkspaceSearchReader() {
  const navigation = useContext(Context);
  return useCallback(
    () => (navigation ? navigation.readSearch() : new URLSearchParams(window.location.search)),
    [navigation],
  );
}
export function useWorkspaceRouter() {
  const router = useGuardedRouter();
  const navigation = useContext(Context);
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        if (!navigation?.navigate(args[0])) router.push(...args);
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        if (!navigation?.navigate(args[0], true)) router.replace(...args);
      },
      back: () => (navigation ? navigation.back() : router.back()),
      forward: () => (navigation ? navigation.forward() : router.forward()),
    }),
    [router, navigation],
  );
}
export function useWorkspaceHistory() {
  return useContext(Context);
}

/** Same links/deep URLs in the main route; app-local history inside an explicit companion. */
export function WorkspaceLink({ href, onClick, ...props }: ComponentProps<typeof NextLink>) {
  const navigation = useContext(Context);
  const local =
    typeof href === 'string' &&
    navigation &&
    typeof window !== 'undefined' &&
    navigation.owns(href);
  return (
    <NextLink
      {...props}
      href={href}
      prefetch={local ? false : props.prefetch}
      data-preserve-workspace={local ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (
          !local ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.download ||
          (props.target && props.target !== '_self')
        )
          return;
        event.preventDefault();
        navigation.navigate(href as string, props.replace);
      }}
    />
  );
}
