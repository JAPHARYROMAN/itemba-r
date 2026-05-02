import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';

/** Modules whose permissions are isGroupControl=true. */
const GROUP_CONTROL_MODULES = new Set([
  'bank-accounts',
  'loans',
  'debts',
  'contracts',
  'fixed-assets',
  'company-profiles',
]);

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
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isSensitive =
      required?.some((p) => {
        const module = p.split('.')[0];
        return GROUP_CONTROL_MODULES.has(module);
      }) ?? false;

    if (!isSensitive) return next.handle();

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    const entityType = context.getClass().name.replace('Controller', '');
    const ipAddress = req.ip as string | undefined;
    const userAgent = req.headers?.['user-agent'] as string | undefined;
    const path = req.url as string | undefined;
    const method = req.method as string | undefined;

    return next.handle().pipe(
      tap(() => {
        if (!user) return;
        void this.audit.log({
          action: 'VIEW_SENSITIVE',
          entityType,
          userId: user.id,
          ipAddress,
          userAgent,
          metadata: {
            requiredPermissions: required,
            path,
            method,
            outcome: 'allowed',
          } as any,
        });
      }),
      catchError((err) => {
        // Always record the attempt — even when the request fails.
        void this.audit.log({
          action: 'VIEW_SENSITIVE_DENIED',
          entityType,
          userId: user?.id,
          ipAddress,
          userAgent,
          metadata: {
            requiredPermissions: required,
            path,
            method,
            outcome: 'denied',
            statusCode: err?.status ?? err?.response?.statusCode ?? null,
            reason: err?.message ?? String(err),
          } as any,
        });
        return throwError(() => err);
      }),
    );
  }
}
