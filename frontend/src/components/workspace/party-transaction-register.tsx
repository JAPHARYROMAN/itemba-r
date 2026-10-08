'use client';

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { backendGet, buildQuery } from '@/lib/api-client';
import { consolidateTransactions, type TransactionSnapshot } from '@/lib/account-consolidation';
import { ConsolidatedAccounts } from './consolidated-accounts';

type Query = Record<string, string | number | boolean | null | undefined>;

export async function loadAllTransactions<T extends { id: string }>(
  endpoint: string,
  query: Query,
  signal: AbortSignal,
  requestLimit: number | null = 20,
): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string>();
  for (let page = 1; ; page += 1) {
    signal.throwIfAborted();
    const result = await backendGet<
      | T[]
      | {
          data?: T[];
          items?: T[];
          rows?: T[];
          total?: number;
          totalPages?: number;
          pageSize?: number;
          limit?: number;
        }
    >(endpoint, {
      query: { ...query, page, ...(requestLimit === null ? {} : { limit: requestLimit }) },
      signal,
    });
    const items = Array.isArray(result) ? result : (result.data ?? result.items ?? result.rows);
    if (!items) throw new Error('Unable to read the complete transaction register.');
    for (const item of items) {
      if (ids.has(item.id))
        throw new Error('The register changed while loading. Refresh to recalculate accounts.');
      ids.add(item.id);
      rows.push(item);
    }
    if (Array.isArray(result)) return rows;
    const totalPages =
      result.totalPages ??
      Math.ceil((result.total ?? items.length) / (result.pageSize ?? result.limit ?? 20));
    if (page >= totalPages) {
      if (result.total !== undefined && rows.length !== Number(result.total))
        throw new Error('The register changed while loading. Refresh to recalculate accounts.');
      return rows;
    }
    if (!items.length) throw new Error('Unable to load every transaction. Refresh to try again.');
  }
}

/** Loads every matching page; partial or stale results never become account totals. */
export function PartyTransactionRegister<T extends { id: string }>({
  endpoint,
  query,
  revision,
  snapshot,
  requestLimit = 20,
  ...props
}: Omit<
  ComponentProps<typeof ConsolidatedAccounts<T>>,
  'accounts' | 'loading' | 'error' | 'onRetry'
> & {
  endpoint: string;
  query: Query;
  revision?: unknown;
  snapshot: (record: T) => TransactionSnapshot;
  requestLimit?: number | null;
}) {
  const queryKey = buildQuery(query);
  const [result, setResult] = useState<{
    key: string;
    revision: unknown;
    records: T[];
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const resourceKey = `${endpoint}${queryKey}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    const filters = Object.fromEntries(new URLSearchParams(queryKey.replace(/^\?/, '')));
    loadAllTransactions<T>(endpoint, filters, controller.signal, requestLimit)
      .then((records) => {
        if (!controller.signal.aborted) setResult({ key: resourceKey, revision, records });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key: resourceKey,
            revision,
            records: [],
            error: error instanceof Error ? error.message : 'Unable to consolidate accounts.',
          });
      });
    return () => controller.abort();
  }, [endpoint, queryKey, resourceKey, revision, requestLimit]);
  const current = result?.key === resourceKey && result.revision === revision;
  const consolidated = useMemo(() => {
    try {
      return { accounts: consolidateTransactions(result?.records ?? [], snapshot) };
    } catch (error) {
      return {
        accounts: [],
        error: error instanceof Error ? error.message : 'Unable to consolidate accounts.',
      };
    }
  }, [result, snapshot]);
  const pageSize = props.pageSize ?? 20;
  const page = Math.max(
    1,
    Math.min(props.page ?? 1, Math.ceil(consolidated.accounts.length / pageSize) || 1),
  );
  return (
    <ConsolidatedAccounts
      {...props}
      page={page}
      accounts={current ? consolidated.accounts.slice((page - 1) * pageSize, page * pageSize) : []}
      loading={!current}
      error={current ? (result?.error ?? consolidated.error) : undefined}
      total={current ? consolidated.accounts.length : 0}
      onRetry={() => setRetry((value) => value + 1)}
    />
  );
}
