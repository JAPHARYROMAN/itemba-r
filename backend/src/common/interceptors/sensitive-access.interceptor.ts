import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditScopeKind } from '@prisma/client';
import { catchError, concatMap, from, map, Observable, throwError } from 'rxjs';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { AuditLogInput, AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import {
  SENSITIVE_ACCESS_KEY,
  SensitiveAccessMetadata,
} from '../decorators/sensitive-access.decorator';
import { ambientValidatedCompanyScope, ValidatedCompanyScope } from '../context/request-context';

/**
 * Applied per-controller (or globally) to audit every access to a Group Control
 * endpoint. Both successful access AND failed/denied attempts are recorded —
 * a probe against bank-accounts that returns 403/404 must still leave a trail.
 */
@Injectable()
export class SensitiveAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const sensitive = this.reflector.getAllAndOverride<SensitiveAccessMetadata>(
      SENSITIVE_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const controllerName = context.getClass().name;
    if (!sensitive) return next.handle();
    const requiredPermissions = [...(requiredAll ?? []), ...(requiredAny ?? [])];

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    const entityType = sensitive.entityType || controllerName.replace('Controller', '');
    const ipAddress = req.ip as string | undefined;
    const userAgent = req.headers?.['user-agent'] as string | undefined;
    const path = req.url as string | undefined;
    const method = req.method as string | undefined;
    const requestedCompanyId = requestCompanyId(req);

    return next.handle().pipe(
      catchError((err) => {
        // Always record the attempt — even when the request fails. Awaiting the
        // append keeps request completion inside the same recovery/audit scope.
        return from(
          this.audit.logStrict({
            action: 'VIEW_SENSITIVE_DENIED',
            entityType,
            userId: user?.id,
            ...auditScope(ambientValidatedCompanyScope(), true),
            ipAddress,
            userAgent,
            metadata: {
              requiredPermissions,
              path,
              method,
              outcome: 'denied',
              stage: 'handler',
              statusCode: err?.status ?? err?.response?.statusCode ?? null,
              reason: err?.message ?? String(err),
              requestedCompanyId,
            },
          }),
        ).pipe(concatMap(() => throwError(() => err)));
      }),
      concatMap((value) => {
        const validatedScope = ambientValidatedCompanyScope();
        if (!user || !validatedScope) {
          const error = new InternalServerErrorException(
            'Sensitive access completed without authenticated, validated company scope',
          );
          return from(
            this.audit.logStrict({
              action: 'VIEW_SENSITIVE_DENIED',
              entityType,
              userId: user?.id,
              scopeKind: AuditScopeKind.GROUP,
              ipAddress,
              userAgent,
              metadata: {
                requiredPermissions,
                path,
                method,
                outcome: 'denied',
                stage: 'scope_attribution',
                statusCode: error.getStatus(),
                reason: error.message,
                requestedCompanyId,
              },
            }),
          ).pipe(concatMap(() => throwError(() => error)));
        }
        return from(
          this.audit.logStrict({
            action: 'VIEW_SENSITIVE',
            entityType,
            userId: user.id,
            ...auditScope(validatedScope, false),
            ipAddress,
            userAgent,
            metadata: {
              requiredPermissions,
              path,
              method,
              outcome: 'allowed',
              requestedCompanyId,
            },
          }),
        ).pipe(map(() => value));
      }),
    );
  }
}

function auditScope(
  scope: ValidatedCompanyScope | undefined,
  deniedFallback: boolean,
): Pick<AuditLogInput, 'scopeKind' | 'companyScopeIds'> {
  if (!scope) {
    if (deniedFallback) return { scopeKind: AuditScopeKind.GROUP };
    throw new Error('Validated company scope is required for allowed sensitive access');
  }
  switch (scope.kind) {
    case 'COMPANY':
      return { scopeKind: AuditScopeKind.COMPANY, companyScopeIds: scope.companyIds };
    case 'MULTI_COMPANY':
      return { scopeKind: AuditScopeKind.MULTI_COMPANY, companyScopeIds: scope.companyIds };
    case 'GROUP':
      return { scopeKind: AuditScopeKind.GROUP };
    case 'GLOBAL':
      return { scopeKind: AuditScopeKind.GLOBAL };
  }
}

function requestCompanyId(req: Record<string, unknown>): string | undefined {
  for (const container of [req['query'], req['body'], req['params']]) {
    if (container && typeof container === 'object') {
      const value = (container as Record<string, unknown>)['companyId'];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return undefined;
}
