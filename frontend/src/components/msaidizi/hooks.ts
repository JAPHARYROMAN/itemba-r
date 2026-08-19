'use client';

/**
 * The two loads the page makes before it can say anything honest.
 *
 * Both are here rather than in the components that use them so the components
 * stay pure and testable against fixtures — a banner that fetches cannot be shown
 * in four states without four network stubs — and so the page has one place to
 * put them.
 *
 * ─── A React Compiler note, because this repo has been bitten twice ─────────
 *
 * Every dependency array below lists plain locals. An optional chain inside a
 * dependency array (`props.thing?.id`) is a compiler error here, so scope values
 * are read into named constants first even where that reads slightly longer than
 * it needs to.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  deleteMsaidiziConversation,
  fetchMsaidiziCapabilities,
  listMsaidiziConversations,
} from '@/lib/msaidizi-client';
import type { MsaidiziCapabilities, MsaidiziConversationSummary } from '@/lib/msaidizi-types';

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface UseMsaidiziCapabilitiesResult {
  capabilities: MsaidiziCapabilities | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * What this deployment lets the caller do.
 *
 * Loaded once and held, because it changes at the speed of an environment
 * variable rather than at the speed of a conversation. It is deliberately fetched
 * even when the module is switched off — the endpoint answers in that state, and
 * learning the feature is unavailable without firing a run into a 503 is the
 * whole reason it exists.
 */
export function useMsaidiziCapabilities(): UseMsaidiziCapabilitiesResult {
  const [capabilities, setCapabilities] = useState<MsaidiziCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchMsaidiziCapabilities().then(
      (result) => {
        if (cancelled) return;
        setCapabilities(result);
        setLoading(false);
      },
      (failure: unknown) => {
        if (cancelled) return;
        // Not defaulted to a read-only shape. Guessing here would put the
        // sentence "it cannot change anything" on screen without having asked,
        // which is the exact lie this endpoint was added to prevent.
        setCapabilities(null);
        setError(messageFrom(failure, 'Could not load what Msaidizi can do.'));
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { capabilities, loading, error, reload };
}

export interface UseMsaidiziConversationsOptions {
  page?: number;
  limit?: number;
  /** False while the module is known to be off — nothing to list, nothing to ask. */
  enabled?: boolean;
}

export interface UseMsaidiziConversationsResult {
  conversations: MsaidiziConversationSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Soft-deletes one and refreshes the list. Resolves either way; check `error`. */
  remove: (id: string) => Promise<void>;
}

/**
 * The caller's own conversations, newest first.
 *
 * Author-scoped on the server, which is the whole of the access control: there is
 * no company-wide variant of this list and no admin read of a transcript, because
 * deciding whether a second reader may see one would mean re-checking every
 * record inside it against their permissions, and the transcript stores prose
 * rather than record identities. There is nothing to re-check.
 */
export function useMsaidiziConversations(
  options: UseMsaidiziConversationsOptions = {},
): UseMsaidiziConversationsResult {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const enabled = options.enabled ?? true;

  const [conversations, setConversations] = useState<MsaidiziConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // `{ data, meta }`, not the house `PaginatedResult` — `normalizePaginated`
      // reads `pagination` and would zero the totals out silently.
      const listed = await listMsaidiziConversations({ page, limit });
      setConversations(listed.data ?? []);
      setTotal(listed.meta ? listed.meta.total : 0);
    } catch (failure: unknown) {
      setError(messageFrom(failure, 'Could not load your conversations.'));
    } finally {
      setLoading(false);
    }
  }, [enabled, page, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteMsaidiziConversation(id);
      } catch (failure: unknown) {
        setError(messageFrom(failure, 'Could not remove that conversation.'));
        return;
      }
      await reload();
    },
    [reload],
  );

  return { conversations, total, loading, error, reload, remove };
}
