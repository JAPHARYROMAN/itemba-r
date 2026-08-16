/**
 * Establishes the ambient request context for every inbound request.
 *
 * Middleware rather than an interceptor, deliberately: middleware runs before
 * the guards, so an entry written by a *rejected* request — a 403 recorded by
 * SensitiveAccessInterceptor, say — is still attributed to the right channel. An
 * interceptor would run too late to cover that case.
 *
 * The agent-session header is trusted only when it arrives on the loopback path,
 * i.e. the request already carries a valid user credential and the header was
 * set by CapabilityInvoker. It is an attribution hint, never an authorisation
 * one: nothing about the request's permissions changes based on this header, so
 * a forged header can at worst mislabel a caller's own action as agent-driven,
 * and cannot widen what that caller may do.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { AuditChannel } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../context/request-context';
import { AGENT_SESSION_HEADER } from '../../modules/msaidizi/capability-invoker';

/** Agent session ids are generated server-side; reject anything oddly shaped. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const agentSessionId = readAgentSession(req);
    const apiKeyPresent = Boolean(req.headers['x-api-key']);

    const channel = agentSessionId
      ? AuditChannel.AGENT
      : apiKeyPresent
        ? AuditChannel.API
        : AuditChannel.WEB;

    runWithRequestContext({ channel, agentSessionId }, () => next());
  }
}

function readAgentSession(req: Request): string | undefined {
  const raw = req.headers[AGENT_SESSION_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  return SESSION_ID_PATTERN.test(value) ? value : undefined;
}
