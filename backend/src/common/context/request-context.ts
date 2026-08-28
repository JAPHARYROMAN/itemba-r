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

/** Canonical audit actor type for task JWTs and the attempt rows they drive. */
export const MSAIDIZI_SERVICE_PRINCIPAL_TYPE = 'SERVICE' as const;

export interface RequestContextStore {
  /** What drove this request. */
  channel: AuditChannel;
  /** Present only on the agent path; correlates one agent run. */
  agentSessionId?: string;
  /** Human or non-human actor identity. Autonomous Msaidizi uses SERVICE. */
  principalType?: string;
  /** Stable actor id; distinct from the short-lived task token subject. */
  principalId?: string;
  /** Standing authority under which an unattended task was dispatched. */
  mandateId?: string;
  /** Human who initiated/delegated the work, when there is one. */
  initiatedByUserId?: string;
  /** Durable autonomous execution correlation. */
  taskId?: string;
  stepId?: string;
  deviceId?: string;
  /** Company boundary proven by application scope checks during this request. */
  validatedCompanyScope?: ValidatedCompanyScope;
}

export type ValidatedCompanyScopeKind = 'COMPANY' | 'MULTI_COMPANY' | 'GROUP' | 'GLOBAL';

export interface ValidatedCompanyScope {
  kind: ValidatedCompanyScopeKind;
  companyIds: string[];
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
 * Adds identity proven after middleware (for example by the JWT strategy) to
 * this request's existing store. The object is unique per request, so mutating
 * it cannot bleed attribution across concurrent requests.
 */
export function enrichRequestContext(patch: Partial<RequestContextStore>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
}

/**
 * Records only scope that application policy has already authorized. Repeated
 * checks are merged because one endpoint may legitimately touch two tenants.
 * Caller input must never be passed here before its access check succeeds.
 */
export function recordValidatedCompanyScope(
  kind: ValidatedCompanyScopeKind,
  companyIds: readonly string[] = [],
): void {
  const current = storage.getStore();
  if (!current) return;

  const ids = new Set([
    ...(current.validatedCompanyScope?.companyIds ?? []),
    ...companyIds.filter((id) => typeof id === 'string' && id.length > 0),
  ]);
  const previousKind = current.validatedCompanyScope?.kind;

  let mergedKind: ValidatedCompanyScopeKind;
  if (previousKind === 'GROUP' || kind === 'GROUP') {
    mergedKind = 'GROUP';
  } else if (
    (previousKind === 'GLOBAL' && ids.size > 0) ||
    (kind === 'GLOBAL' &&
      (ids.size > 0 || previousKind === 'COMPANY' || previousKind === 'MULTI_COMPANY'))
  ) {
    // Combining tenant and group-level records is a group scope, not a
    // globally-unattributed action.
    mergedKind = 'GROUP';
  } else if (kind === 'GLOBAL' || previousKind === 'GLOBAL') {
    mergedKind = 'GLOBAL';
  } else {
    mergedKind = ids.size > 1 ? 'MULTI_COMPANY' : 'COMPANY';
  }

  current.validatedCompanyScope = { kind: mergedKind, companyIds: [...ids].sort() };
}

/** Scope proven by company-policy code in the current request, if any. */
export function ambientValidatedCompanyScope(): ValidatedCompanyScope | undefined {
  const scope = storage.getStore()?.validatedCompanyScope;
  return scope ? { kind: scope.kind, companyIds: [...scope.companyIds] } : undefined;
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

/**
 * Extended execution attribution copied into append-only audit records.
 *
 * These values never grant authority; they describe authority already proven by
 * the caller's authentication/policy path. Autonomous workers establish this
 * context directly around a step rather than accepting identity headers from a
 * workstation or browser.
 */
export function ambientExecutionAttribution(): Omit<
  RequestContextStore,
  'channel' | 'agentSessionId' | 'validatedCompanyScope'
> {
  const context = storage.getStore();
  return {
    principalType: context?.principalType,
    principalId: context?.principalId,
    mandateId: context?.mandateId,
    initiatedByUserId: context?.initiatedByUserId,
    taskId: context?.taskId,
    stepId: context?.stepId,
    deviceId: context?.deviceId,
  };
}
