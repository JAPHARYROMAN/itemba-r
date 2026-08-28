import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { isObservable, lastValueFrom } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_JWT_REFRESH_ROUTE } from '../decorators/jwt-refresh.decorator';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { auditSensitiveAccessDenial } from '../policies/sensitive-access-audit';
import { createHash } from 'node:crypto';

const AUTHENTICATED_REQUEST = Symbol('itemba.jwt-authenticated-request');

interface JwtGuardRequest {
  headers?: { authorization?: string | string[] };
  user?: unknown;
  [AUTHENTICATED_REQUEST]?: Readonly<{
    authorizationDigest: string;
    user: unknown;
  }>;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogsService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // Refresh-token routes are authenticated by the jwt-refresh strategy, not
    // the access-token strategy this guard implements.
    const isRefreshRoute = this.reflector.getAllAndOverride<boolean>(IS_JWT_REFRESH_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isRefreshRoute) return true;
    const request = context.switchToHttp().getRequest<JwtGuardRequest>();
    const authorizationDigest = bearerAuthorizationDigest(request);
    const priorAuthentication = request[AUTHENTICATED_REQUEST];
    if (
      authorizationDigest &&
      priorAuthentication?.authorizationDigest === authorizationDigest &&
      priorAuthentication.user === request.user
    ) {
      // AppModule authenticates globally, while legacy controllers may still
      // declare this guard locally. A server-owned, non-enumerable marker makes
      // that second guard idempotent without trusting request.user or allowing
      // a different bearer to reuse the first authentication decision.
      return true;
    }
    let allowed: boolean;
    try {
      const result = super.canActivate(context);
      allowed = isObservable(result) ? await lastValueFrom(result) : await result;
    } catch (error) {
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'authentication',
        statusCode: exceptionStatus(error, 401),
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (!allowed) {
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'authentication',
        statusCode: 401,
        reason: 'Authentication guard rejected the request',
      });
    }
    if (allowed && authorizationDigest && request.user !== undefined) {
      Object.defineProperty(request, AUTHENTICATED_REQUEST, {
        value: Object.freeze({ authorizationDigest, user: request.user }),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    return allowed;
  }
}

function bearerAuthorizationDigest(request: JwtGuardRequest): string | undefined {
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+/i.test(authorization)) return undefined;
  return createHash('sha256').update(authorization, 'utf8').digest('hex');
}

function exceptionStatus(error: unknown, fallback: number): number {
  if (!error || typeof error !== 'object') return fallback;
  const getStatus = (error as { getStatus?: unknown }).getStatus;
  if (typeof getStatus === 'function') {
    const value = getStatus.call(error);
    if (typeof value === 'number') return value;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : fallback;
}
