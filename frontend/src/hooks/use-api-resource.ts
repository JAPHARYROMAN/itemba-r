'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { backendGet, normalizePaginated, type PaginatedResult } from '@/lib/api-client';

type QueryValue = string | number | boolean | null | undefined;

interface UseApiListOptions {
  query?: Record<string, QueryValue>;
  enabled?: boolean;
}

export function useApiList<T>(
  path: string,
  { query, enabled = true }: UseApiListOptions = {},
) {
  const [response, setResponse] = useState<PaginatedResult<T> | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(() => JSON.stringify(query ?? {}), [query]);
  const stableQuery = useMemo(
    () => (JSON.parse(queryKey) as Record<string, QueryValue>),
    [queryKey],
  );

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await backendGet<unknown>(path, { query: stableQuery });
      setResponse(normalizePaginated<T>(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, [enabled, path, stableQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data: response?.data ?? [],
    response,
    loading,
    error,
    reload,
  };
}
