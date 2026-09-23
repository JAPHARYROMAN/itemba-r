'use client';
import { useCallback } from 'react';
import { useWorkspaceRouter } from './workspace-navigation';
import { useWorkspaceState } from './workspace-session';

/** Route targets apply only to the main app; companion windows receive no target. */
export function useDeskRecordSelection(app: string, targetRecordId?: string) {
  const [retained, setRetained] = useWorkspaceState(`${app}.selected`, '');
  const router = useWorkspaceRouter();
  const select = useCallback(
    (id: string) => {
      setRetained(id);
      if (targetRecordId) router.replace(`/${app}`, { scroll: false });
    },
    [app, router, setRetained, targetRecordId],
  );
  return [targetRecordId || retained, select] as const;
}
