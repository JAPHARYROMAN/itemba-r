'use client';
import { useCallback, useEffect, useState } from 'react';
import { backendAllPages } from '@/lib/backend-all-pages';

/** Complete selectors: an obsolete scope or failed later page never supplies partial choices. */
export function useWorkspaceChoices<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  enabled = true,
) {
  const key = JSON.stringify({ path, query });
  const [state, setState] = useState<{ key: string; rows: T[]; loading: boolean; error: string }>({
    key: '',
    rows: [],
    loading: false,
    error: '',
  });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) {
      setState({ key, rows: [], loading: false, error: '' });
      return () => controller.abort();
    }
    const request = JSON.parse(key) as { path: string; query: typeof query };
    setState({ key, rows: [], loading: true, error: '' });
    backendAllPages<T>(request.path, request.query, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setState({ key, rows, loading: false, error: '' });
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setState({
            key,
            rows: [],
            loading: false,
            error: err instanceof Error ? err.message : 'Unable to load choices.',
          });
      });
    return () => controller.abort();
  }, [key, enabled, revision]);
  const current = enabled && state.key === key;
  return {
    rows: current ? state.rows : [],
    loading: enabled && (!current || state.loading),
    error: current ? state.error : '',
    retry,
  };
}
