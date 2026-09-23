'use client';
import { useCallback, useEffect, useState } from 'react';
import { backendGet } from '@/lib/api-client';

/** A keyed read that never exposes another record's response while navigating. */
export function useWorkspaceResource<T>(
  path: string,
  query: Record<string, string | number> = {},
  enabled = true,
  read?: (signal: AbortSignal) => Promise<T>,
) {
  const key = JSON.stringify([path, query]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ key: '', data: null, error: '', loading: true });
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) {
      setState({ key: '', data: null, error: '', loading: false });
      return () => controller.abort();
    }
    const [requestPath, requestQuery] = JSON.parse(key);
    setState({ key, data: null, error: '', loading: true });
    (read
      ? read(controller.signal)
      : backendGet<T>(requestPath, { query: requestQuery, signal: controller.signal })
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: '', loading: false });
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error: err instanceof Error ? err.message : 'Unable to load this workspace.',
            loading: false,
          });
      });
    return () => controller.abort();
  }, [key, enabled, revision, read]);
  return {
    data: enabled && state.key === key ? state.data : null,
    error: enabled && state.key === key ? state.error : '',
    loading: enabled && (state.key !== key || state.loading),
    reload,
  };
}
