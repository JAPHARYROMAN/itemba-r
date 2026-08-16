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
import { Capability } from '../../common/capabilities/capability-manifest';
import { MsaidiziConfig } from './msaidizi.config';

/** Header the audit interceptor reads to attribute an action to an agent run. */
export const AGENT_SESSION_HEADER = 'x-msaidizi-session';

export interface InvocationRequest {
  capability: Capability;
  /** Model-supplied arguments: path params, query params, and body fields. */
  args: Record<string, unknown>;
  /** The caller's own `Authorization` header value, passed through unchanged. */
  authorization: string;
  /** Correlates this call to its agent run in the audit trail. */
  agentSessionId: string;
}

export interface InvocationResult {
  ok: boolean;
  status: number;
  body: unknown;
  /** Present when the call failed, in a form safe to show the model. */
  error?: string;
}

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

@Injectable()
export class CapabilityInvoker {
  private readonly logger = new Logger(CapabilityInvoker.name);

  constructor(private readonly config: MsaidiziConfig) {}

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    const { capability, args, authorization, agentSessionId } = request;

    const { path, rest, missing } = buildPath(capability.path, args);
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
    if (isRead) {
      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

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
          ...(isRead ? {} : { 'content-type': 'application/json' }),
        },
        ...(isRead ? {} : { body: JSON.stringify(rest) }),
      });

      const text = await response.text();
      const body = parseBody(text);

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          body,
          error: describeFailure(response.status, body),
        };
      }

      return { ok: true, status: response.status, body };
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
      };
    } finally {
      clearTimeout(timer);
    }
  }
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
