'use client';
import { useCallback, useEffect, useState } from 'react';
import { backendPage } from '@/lib/api-client';
import { useRequestGuard } from './use-request-guard';

/** Shared paginated read state. Filters stay with each page's business workflow. */
export function useWorkspaceRecords<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  enabled: boolean,
) {
  const startRequest = useRequestGuard();
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const queryKey = JSON.stringify(query);
  const reload = useCallback(async () => {
    const request = startRequest();
    if (!enabled) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<T>(path, {
        query: JSON.parse(queryKey),
        signal: request.signal,
      });
      if (!request.current()) return;
      setRows(result.data);
      setTotal(result.total);
    } catch (err) {
      if (request.current())
        setError(err instanceof Error ? err.message : 'Unable to load records.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [path, queryKey, enabled, startRequest]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows, total, loading, error, reload };
}
