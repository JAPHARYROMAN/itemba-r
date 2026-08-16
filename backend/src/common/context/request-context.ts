/**
 * Per-request ambient context, carried on an AsyncLocalStorage store.
 *
 * Exists for one reason: channel attribution has to reach ~100 existing
 * `auditLogs.log(...)` call sites without editing any of them. When Msaidizi
 * invokes an endpoint, that endpoint's service writes its audit entry through
 * the same code path it always did — the difference is that the entry now knows
 * it was reached by an agent.
 *
 * Threading a channel argument through every service instead would touch every
 * caller, and would silently mis-attribute any caller that was missed. An
 * ambient default means a service that knows nothing about Msaidizi still
 * records the truth.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { AuditChannel } from '@prisma/client';

export interface RequestContextStore {
  /** What drove this request. */
  channel: AuditChannel;
  /** Present only on the agent path; correlates one agent run. */
  agentSessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Runs `fn` with the given ambient context. */
export function runWithRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** The current ambient context, or undefined outside a request. */
export function currentRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}

/**
 * The channel to attribute an audit entry to when the caller did not say.
 *
 * Falls back to WEB rather than throwing: an unattributed entry is far better
 * than a lost one, and `log()` is explicitly a never-throws path.
 */
export function ambientChannel(): AuditChannel {
  return storage.getStore()?.channel ?? AuditChannel.WEB;
}

/** The current agent run id, when this request is on the agent path. */
export function ambientAgentSessionId(): string | undefined {
  return storage.getStore()?.agentSessionId;
}
