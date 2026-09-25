'use client';
import { useCallback, useEffect } from 'react';
import { useWorkspaceState } from './workspace-session';
import { useWorkspaceHistory } from './workspace-navigation';

/** Section links participate in window-local history, while retaining saved view settings. */
export function useDeskSection<T extends string>(appId: string, allowed: readonly T[]) {
  const history = useWorkspaceHistory();
  const [stored, setStored] = useWorkspaceState<T>(`${appId}.section`, 'overview' as T);
  const requested = history
    ? new URL(history.href, 'http://desktop.local').searchParams.get('view')
    : null;
  const section = requested && allowed.includes(requested as T) ? (requested as T) : stored;
  useEffect(() => {
    if (section !== stored) setStored(section);
  }, [section, stored, setStored]);
  const setSection = useCallback(
    (next: T) => {
      setStored(next);
      if (history) {
        const url = new URL(history.href, 'http://desktop.local');
        url.searchParams.set('view', next);
        url.searchParams.delete('record');
        history.navigate(`${url.pathname}${url.search}`);
      }
    },
    [history, setStored],
  );
  return [section, setSection] as const;
}
