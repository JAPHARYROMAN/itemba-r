'use client';
import { useEffect, useState } from 'react';
import { backendGet } from '@/lib/api-client';
export type DraftScopes = {
  companies: Array<{ id: string; name: string }>;
  divisions: Array<{ id: string; name: string; companyId: string }>;
  branches: Array<{ id: string; name: string; companyId: string; divisionId: string }>;
};
const EMPTY: DraftScopes = { companies: [], divisions: [], branches: [] };
export function useDraftScopes(enabled = true) {
  const [value, setValue] = useState<DraftScopes>(EMPTY),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setValue(EMPTY);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void backendGet<DraftScopes>('/pos-drafts/scopes', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setValue(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Could not load your authorized branches.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, revision]);
  return { ...value, error, loading, retry: () => setRevision((value) => value + 1) };
}
