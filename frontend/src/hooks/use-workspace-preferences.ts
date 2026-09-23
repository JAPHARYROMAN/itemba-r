'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  DEFAULT_WORKSPACE,
  readWorkspace,
  subscribeWorkspace,
  updateWorkspace,
  type WorkspacePreferences,
  type RecordLayout,
} from '@/lib/workspace-preferences';

const serverSnapshot = () => DEFAULT_WORKSPACE;
export function useWorkspacePreferences(userId: string | undefined) {
  const [temporary, setTemporary] = useState(DEFAULT_WORKSPACE);
  const subscribe = useCallback(
    (callback: () => void) => (userId ? subscribeWorkspace(userId, callback) : () => {}),
    [userId],
  );
  const getSnapshot = useCallback(
    () => (userId ? readWorkspace(userId) : DEFAULT_WORKSPACE),
    [userId],
  );
  const stored = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const update = useCallback(
    (change: (current: WorkspacePreferences) => WorkspacePreferences) => {
      if (userId) updateWorkspace(userId, change);
      else setTemporary(change);
    },
    [userId],
  );
  return { preferences: userId ? stored : temporary, update };
}

export function useWorkspaceLayout(path: string): [RecordLayout, (layout: RecordLayout) => void] {
  const { user } = useAuth();
  const { preferences, update } = useWorkspacePreferences(user?.id);
  const setLayout = useCallback(
    (layout: RecordLayout) =>
      update((current) => ({ ...current, layouts: { ...current.layouts, [path]: layout } })),
    [path, update],
  );
  return [preferences.layouts[path] ?? 'focus', setLayout];
}
