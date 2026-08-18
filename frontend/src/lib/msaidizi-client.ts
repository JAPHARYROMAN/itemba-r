/**
 * Everything Msaidizi exposes that is not the stream.
 *
 * All of it goes through `backendGet`/`backendPost`/`backendDelete`, which hit
 * `/api/backend/…` and therefore the proxy that holds the httpOnly token. The
 * bare `apiFetch()` must never appear in this feature: `API_URL` falls back to
 * the proxy only when `NEXT_PUBLIC_API_URL` is unset, and in production it is
 * set to the public API origin, so `apiFetch` would leave the browser carrying
 * no credential at all. It is used by zero files today and this is not the
 * feature that changes that.
 *
 * Envelope discipline, because the two halves differ: `POST /ask` goes through
 * `TransformInterceptor` and arrives as `{success, data, timestamp}`, which
 * `backendPost` unwraps. `POST /ask/stream` is `@Res()`-decorated and bypasses
 * the interceptor entirely — that one belongs to `msaidizi-stream.ts` and is not
 * here.
 */

import { backendDelete, backendGet, backendPost, normalizePaginated } from './api-client';
import type { PaginatedResult } from './api-client';
import type {
  MsaidiziAskRequest,
  MsaidiziCapabilities,
  MsaidiziConversationDetail,
  MsaidiziConversationPage,
  MsaidiziConversationSummary,
  MsaidiziRunResult,
} from './msaidizi-types';

/**
 * What this caller's agent can reach, and under what ceilings.
 *
 * Two things the UI cannot know any other way, and both are load-bearing:
 *
 *   - `writeMode` drives the standing line about what Msaidizi can do. Hardcode
 *     "it cannot change anything" and the deployment that moves to amber ships a
 *     lie without anyone editing a file.
 *   - `capabilities` is the lookup from tool name to a plain-language
 *     description, so a step row can read "Looking at supplier invoices" instead
 *     of `SupplierInvoices_findAll`. Without it the only honest fallback is
 *     splitting the identifier, which works and is ugly.
 *
 * Deliberately answerable while the module is switched off, so a client can find
 * that out without firing a run and reading a 503.
 */
export function fetchMsaidiziCapabilities(): Promise<MsaidiziCapabilities> {
  return backendGet<MsaidiziCapabilities>('/msaidizi/capabilities');
}

/**
 * Turn the capability list into the lookup a step row needs.
 *
 * Built here rather than in the renderer so there is one map per load instead of
 * a linear scan per row, and so the fallback lives next to the data that makes
 * it unnecessary.
 */
export function capabilityIndex(
  capabilities: MsaidiziCapabilities | null,
): Map<string, MsaidiziCapabilities['capabilities'][number]> {
  const index = new Map<string, MsaidiziCapabilities['capabilities'][number]>();
  for (const capability of capabilities?.capabilities ?? []) index.set(capability.name, capability);
  return index;
}

/**
 * The honest fallback when the capabilities endpoint has not answered yet.
 *
 * `SupplierInvoices_findAll` → `Supplier invoices · find all`. A manager should
 * never see the raw identifier, and this at least reads as words.
 */
export function describeToolName(toolName: string): string {
  const [controller, ...handler] = toolName.split('_');
  const words = (value: string) =>
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLowerCase();
  const subject = words(controller ?? toolName);
  const action = words(handler.join('_'));
  const sentence = subject.charAt(0).toUpperCase() + subject.slice(1);
  return action ? `${sentence} · ${action}` : sentence;
}

/**
 * The caller's own conversations, newest first.
 *
 * Author-scoped on the server — `userId = me`, not the house company scope —
 * because a transcript holds exactly what its author was entitled to see, and a
 * peer in the same company reading it would be reading past their own
 * permissions. There is no admin read of somebody else's transcript, and that is
 * a decision rather than a gap.
 */
export function listMsaidiziConversations(
  params: { page?: number; limit?: number } = {},
): Promise<MsaidiziConversationPage> {
  return backendGet<MsaidiziConversationPage>('/msaidizi/conversations', {
    query: { page: params.page, limit: params.limit },
  });
}

/** One conversation with its decrypted turns. A non-author gets a 404, not a 403. */
export function fetchMsaidiziConversation(id: string): Promise<MsaidiziConversationDetail> {
  return backendGet<MsaidiziConversationDetail>(
    `/msaidizi/conversations/${encodeURIComponent(id)}`,
  );
}

/**
 * Removes a conversation.
 *
 * Soft-delete plus an immediate destruction of the resume state, so say
 * "removed" rather than "permanently deleted" — the transcript survives until
 * the sweeper reaches it. It deletes no evidence either way: whatever the agent
 * changed is in `audit_logs` under the user's own id, joined only by
 * `agentSessionId`, and is untouched by this.
 */
export function deleteMsaidiziConversation(id: string): Promise<{ id: string; removed: boolean }> {
  return backendDelete<{ id: string; removed: boolean }>(
    `/msaidizi/conversations/${encodeURIComponent(id)}`,
  );
}

/**
 * What the agent actually did during this conversation.
 *
 * Requires `audit-logs.read` on top of `msaidizi.use`, and returns nothing at
 * all under a read-only deployment — reads are not audited, by construction. A
 * UI that implies otherwise is lying about the one property the design was built
 * to have.
 */
export function fetchMsaidiziConversationAudit<T = Record<string, unknown>>(
  id: string,
): Promise<PaginatedResult<T>> {
  return backendGet<unknown>(`/msaidizi/conversations/${encodeURIComponent(id)}/audit`).then(
    (payload) => normalizePaginated<T>(payload),
  );
}

/**
 * The non-streaming run. Present for completeness and for a caller that cannot
 * stream; prefer `streamMsaidiziAsk`.
 *
 * A silent `POST /ask` is indistinguishable from a hang, and a run has no
 * ceiling on total duration — 40 tool calls at a 30 s invoke timeout each can
 * hold a connection for minutes with nothing on screen.
 */
export function askMsaidizi(request: MsaidiziAskRequest): Promise<MsaidiziRunResult> {
  return backendPost<MsaidiziRunResult>('/msaidizi/ask', request);
}

export type { MsaidiziConversationSummary };
