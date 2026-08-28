/**
 * Executes a capability by calling the API over HTTP, as a client, carrying the
 * requesting user's own credential.
 *
 * The obvious alternative — resolve the controller from the DI container and
 * call the handler directly — is faster and wrong. It would skip the guards
 * (permissions, roles, JWT), the global ValidationPipe, every interceptor, and
 * the exception filter, and then the tool layer would have to re-implement those
 * checks. Two sources of truth about who may do what is precisely the failure
 * this whole design is trying to avoid.
 *
 * Going over the wire means the agent is subject to exactly what a browser is
 * subject to. It cannot bypass a guard because there is no path around one.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import { MsaidiziConfig } from './msaidizi.config';
import {
  encodeErpEgressRequestContext,
  ERP_EGRESS_CONTEXT_HEADER,
  ERP_EGRESS_MEASUREMENT_HEADER,
  ErpEgressInvocationBinding,
  ErpEgressMeteringReceipt,
  issueErpEgressMeteringReceipt,
} from './erp-egress-metering';

/** Header the audit interceptor reads to attribute an action to an agent run. */
export const AGENT_SESSION_HEADER = 'x-msaidizi-session';
export const INPUT_PROVENANCE_HEADER = 'x-msaidizi-input-provenance-sha256';

export interface InvocationRequest {
  capability: Capability;
  /**
   * Model-supplied `{ path, query, body }` envelope. Legacy top-level fields
   * remain accepted so resumable turns and saved procedures keep working.
   */
  args: Record<string, unknown>;
  /** The caller's own `Authorization` header value, passed through unchanged. */
  authorization: string;
  /** Correlates this call to its agent run in the audit trail. */
  agentSessionId: string;
  /** Exact value-free resolved-input graph digest for durable task dispatch. */
  inputProvenanceSha256?: string;
  /** Parent-reserved response budget. The invoker never buffers beyond it. */
  maxResponseBytes?: number;
  /** Durable-task-only binding for an explicitly classified external capability. */
  egressBinding?: ErpEgressInvocationBinding;
}

export interface InvocationResult {
  ok: boolean;
  status: number;
  body: unknown;
  /** Present when the call failed, in a form safe to show the model. */
  error?: string;
  /** Exact raw HTTP response bytes retained by the bounded reader. */
  responseBytes?: number;
  /** SHA-256 of the exact raw HTTP response bytes when the body completed. */
  responseSha256?: string;
  /** The response was cancelled because it could not fit the caller's reservation. */
  responseLimitExceeded?: boolean;
  /** Strict in-memory receipt issued by the trusted loopback adapter boundary. */
  egressReceipt?: ErpEgressMeteringReceipt;
  /** Stable fail-closed reason when the adapter measurement was not trustworthy. */
  egressReceiptError?: string;
}

/** A deployment-owned per-response safety cap, independent of model budgets. */
export const MAX_CAPABILITY_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface InvocationEnvelope {
  path: Record<string, unknown>;
  query: Record<string, unknown>;
  body?: unknown;
}

export type NormalizedInvocationArgs =
  | { ok: true; envelope: InvocationEnvelope }
  | { ok: false; error: string };

/** Extracts `:param` names from a route path, in order. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/**
 * Substitutes path params and returns the arguments that were not consumed.
 * Anything left over is a query string (reads) or a body (writes).
 */
export function buildPath(
  routePath: string,
  args: Record<string, unknown>,
): { path: string; rest: Record<string, unknown>; missing: string[] } {
  const rest = { ...args };
  const missing: string[] = [];

  const path = routePath.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = rest[name];
    if (value === undefined || value === null || value === '') {
      missing.push(name);
      return `:${name}`;
    }
    delete rest[name];
    return encodeURIComponent(String(value));
  });

  return { path, rest, missing };
}

/**
 * Separates a model call into HTTP namespaces.
 *
 * Explicit envelope values win when a legacy top-level field duplicates them.
 * On legacy reads, unconsumed fields remain query parameters; on legacy writes,
 * they remain body fields. That is the exact old routing rule, retained only at
 * this boundary while newly generated tool calls use the unambiguous envelope.
 */
export function normalizeInvocationArgs(
  capability: Capability,
  args: Record<string, unknown>,
): NormalizedInvocationArgs {
  const explicitPath = readNamespace(args, 'path');
  if (!explicitPath.ok) return explicitPath;
  const explicitQuery = readNamespace(args, 'query');
  if (!explicitQuery.ok) return explicitQuery;

  const path = { ...explicitPath.value };
  const query = { ...explicitQuery.value };
  const legacy = Object.fromEntries(
    Object.entries(args).filter(([key]) => !['path', 'query', 'body'].includes(key)),
  );

  for (const name of pathParamNames(capability.path)) {
    if (path[name] === undefined && legacy[name] !== undefined) path[name] = legacy[name];
    delete legacy[name];
  }

  const unknownPathFields = Object.keys(path).filter(
    (name) => !pathParamNames(capability.path).includes(name),
  );
  if (unknownPathFields.length > 0) {
    return {
      ok: false,
      error: `Unknown route path parameter(s): ${unknownPathFields.join(', ')}`,
    };
  }

  const isRead = capability.verb === 'GET' || capability.verb === 'HEAD';
  if (isRead) {
    return {
      ok: true,
      envelope: {
        path,
        // Explicit values win, but old top-level filters still work.
        query: { ...legacy, ...query },
      },
    };
  }

  const hasExplicitBody = Object.prototype.hasOwnProperty.call(args, 'body');
  let body: unknown;
  if (hasExplicitBody) {
    body = args.body;
    if (Object.keys(legacy).length > 0) {
      if (!isRecord(body)) {
        return {
          ok: false,
          error:
            'Body arguments are ambiguous: do not mix a non-object `body` with legacy top-level fields.',
        };
      }
      // Explicit body fields win over legacy top-level fields.
      body = { ...legacy, ...body };
    }
  } else if (Object.keys(legacy).length > 0 || capability.params.hasBody) {
    body = legacy;
  }

  return { ok: true, envelope: { path, query, ...(body === undefined ? {} : { body }) } };
}

@Injectable()
export class CapabilityInvoker {
  private readonly logger = new Logger(CapabilityInvoker.name);

  constructor(private readonly config: MsaidiziConfig) {}

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    const { capability, args, authorization, agentSessionId } = request;
    if (
      request.inputProvenanceSha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(request.inputProvenanceSha256)
    ) {
      return { ok: false, status: 0, body: null, error: 'Input provenance digest is invalid.' };
    }
    const maxResponseBytes = normalizedResponseLimit(request.maxResponseBytes);
    let egressContext: ReturnType<typeof encodeErpEgressRequestContext> | undefined;

    // Request-bound human Msaidizi calls deliberately keep their existing path:
    // only durable tasks supply a binding. Once supplied, however, a binding may
    // neither widen an ordinary capability nor disagree with manifest authority.
    if (request.egressBinding) {
      if (!capability.externalEgress) {
        return {
          ok: false,
          status: 0,
          body: null,
          error: 'External egress metering was requested for an unclassified capability.',
          egressReceiptError: 'ERP_EGRESS_CAPABILITY_NOT_CLASSIFIED',
        };
      }
      if (
        request.egressBinding.capabilityId !== capability.id ||
        request.egressBinding.reservedExternalEgressBytes !==
          capability.externalEgress.reservationBytes ||
        request.egressBinding.argumentsSha256 !== actionArgumentDigest(args)
      ) {
        return {
          ok: false,
          status: 0,
          body: null,
          error: 'External egress binding did not match the exact capability action.',
          egressReceiptError: 'ERP_EGRESS_BINDING_INVALID',
        };
      }
      try {
        egressContext = encodeErpEgressRequestContext(request.egressBinding);
      } catch {
        return {
          ok: false,
          status: 0,
          body: null,
          error: 'External egress binding was malformed.',
          egressReceiptError: 'ERP_EGRESS_BINDING_INVALID',
        };
      }
    }

    const normalized = normalizeInvocationArgs(capability, args);
    if (!normalized.ok) {
      return { ok: false, status: 0, body: null, error: normalized.error };
    }

    const { path: pathArgs, query, body: requestBody } = normalized.envelope;
    const { path, missing } = buildPath(capability.path, pathArgs);
    if (missing.length > 0) {
      // Surfaced to the model as a normal tool error so it can correct itself,
      // rather than issuing a request that would 404 for a confusing reason.
      return {
        ok: false,
        status: 0,
        body: null,
        error: `Missing required path parameter(s): ${missing.join(', ')}`,
      };
    }

    const isRead = capability.verb === 'GET' || capability.verb === 'HEAD';
    const url = new URL(`${this.config.loopbackBaseUrl}/${path}`);
    for (const [key, value] of Object.entries(query)) {
      appendQueryValue(url, key, value);
    }
    const hasBody = !isRead && requestBody !== undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.invokeTimeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: capability.verb,
        signal: controller.signal,
        headers: {
          // The caller's own credential. The agent has no identity of its own —
          // it borrows the user's, and can therefore never exceed it.
          authorization,
          [AGENT_SESSION_HEADER]: agentSessionId,
          ...(request.inputProvenanceSha256
            ? { [INPUT_PROVENANCE_HEADER]: request.inputProvenanceSha256 }
            : {}),
          ...(egressContext ? { [ERP_EGRESS_CONTEXT_HEADER]: egressContext.header } : {}),
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(requestBody) } : {}),
      });

      const bounded = await readBoundedResponse(response, maxResponseBytes);
      if (!bounded.ok) {
        return {
          ok: false,
          status: response.status,
          body: null,
          error: `The response exceeded the reserved ${maxResponseBytes}-byte task budget. Stop and report this.`,
          responseBytes: maxResponseBytes,
          responseLimitExceeded: true,
          ...(egressContext ? { egressReceiptError: 'ERP_EGRESS_RESULT_UNBOUND' } : {}),
        };
      }
      const body = parseBody(bounded.text);
      const egress = egressContext
        ? issueErpEgressMeteringReceipt({
            binding: request.egressBinding!,
            contextSha256: egressContext.sha256,
            measurementHeader: response.headers.get(ERP_EGRESS_MEASUREMENT_HEADER),
            httpStatus: response.status,
            resultSha256: bounded.sha256,
          })
        : undefined;
      const egressResult = egress
        ? egress.ok
          ? { egressReceipt: egress.receipt }
          : { egressReceiptError: egress.code }
        : {};

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          body,
          error: describeFailure(response.status, body),
          responseBytes: bounded.bytes,
          responseSha256: bounded.sha256,
          ...egressResult,
        };
      }

      return {
        ok: true,
        status: response.status,
        body,
        responseBytes: bounded.bytes,
        responseSha256: bounded.sha256,
        ...egressResult,
      };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      // Log the cause for operators; return something the model can act on
      // without leaking internals into the conversation.
      this.logger.warn(
        `Capability ${capability.id} failed: ${aborted ? 'timeout' : (err as Error)?.message}`,
      );
      return {
        ok: false,
        status: 0,
        body: null,
        error: aborted
          ? `The request timed out after ${this.config.invokeTimeoutMs}ms.`
          : 'The request could not be completed.',
        ...(egressContext ? { egressReceiptError: 'ERP_EGRESS_RECEIPT_MISSING' } : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

type BoundedResponse = { ok: true; text: string; bytes: number; sha256: string } | { ok: false };

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<BoundedResponse> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(maximumBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false };
  }
  if (!response.body) {
    return {
      ok: true,
      text: '',
      bytes: 0,
      sha256: createHash('sha256').update('').digest('hex'),
    };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      if (bytes + chunk.length > maximumBytes) {
        chunk.fill(0);
        await reader.cancel().catch(() => undefined);
        for (const retained of chunks) retained.fill(0);
        return { ok: false };
      }
      bytes += chunk.length;
      hash.update(chunk);
      chunks.push(chunk);
    }
    return {
      ok: true,
      text: Buffer.concat(chunks, bytes).toString('utf8'),
      bytes,
      sha256: hash.digest('hex'),
    };
  } finally {
    reader.releaseLock();
  }
}

function normalizedResponseLimit(value: number | undefined): number {
  if (value === undefined) return MAX_CAPABILITY_RESPONSE_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) return 1;
  return Math.min(value, MAX_CAPABILITY_RESPONSE_BYTES);
}

function readNamespace(
  args: Record<string, unknown>,
  name: 'path' | 'query',
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value = args[name];
  if (value === undefined) return { ok: true, value: {} };
  if (!isRecord(value)) {
    return { ok: false, error: `The \`${name}\` argument must be an object.` };
  }
  return { ok: true, value };
}

function appendQueryValue(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(url, key, item);
    return;
  }
  url.searchParams.append(key, isRecord(value) ? JSON.stringify(value) : String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Turns an HTTP failure into something the model can reason about.
 *
 * A 403 in particular must read as a settled fact, not a hint to try again — the
 * permission system is the boundary, and an agent that retries around it is
 * doing the one thing the envelope exists to prevent.
 */
function describeFailure(status: number, body: unknown): string {
  const detail =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message)
      : undefined;

  switch (status) {
    case 400:
      return `Invalid request${detail ? `: ${detail}` : ''}. Check the arguments and try once more.`;
    case 401:
      return 'The session is no longer authenticated. Stop and report this.';
    case 403:
      return `Permission denied${detail ? `: ${detail}` : ''}. The user does not have access to this. Do not retry it or look for another route to the same data; report that it is not available.`;
    case 404:
      return 'No such record.';
    case 409:
      return `Conflict${detail ? `: ${detail}` : ''}. The record changed or is in a state that does not allow this.`;
    case 429:
      return 'Rate limited. Stop making requests and report this.';
    default:
      return status >= 500
        ? 'The server failed to handle this request.'
        : `Request failed with status ${status}.`;
  }
}
