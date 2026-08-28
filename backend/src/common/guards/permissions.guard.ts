import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { auditSensitiveAccessDenial } from '../policies/sensitive-access-audit';
import { AuditChannel, AuditScopeKind, AuditSeverity } from '@prisma/client';
import { MSAIDIZI_SERVICE_PRINCIPAL_TYPE } from '../context/request-context';

/**
 * Global permissions guard.
 * If an endpoint declares @RequirePermissions(...), every listed permission
 * must exist in req.user.permissions. If it declares @RequireAnyPermissions(...),
 * at least one listed permission must exist.
 *
 * GROUP CONTROL RULE: permissions prefixed with group-controlled modules
 * (bank-accounts, loans, debts, contracts, fixed-assets, company-profiles)
 * are only ever assigned to GROUP-scoped roles in the seed, so the standard
 * permission check is sufficient — no extra guard is needed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No permissions declared — allow (auth is enforced separately by JwtAuthGuard)
    if ((!required || required.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) {
      const error = new UnauthorizedException('Authentication required');
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'permission',
        statusCode: error.getStatus(),
        reason: error.message,
        requiredPermissions: [...(required ?? []), ...(requiredAny ?? [])],
      });
      throw error;
    }

    const missing = (required ?? []).filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      const error = new ForbiddenException(
        `Access denied. Missing permission(s): ${missing.join(', ')}`,
      );
      await this.auditServicePermissionDenial(context, user, error, required, missing);
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'permission',
        statusCode: error.getStatus(),
        reason: error.message,
        requiredPermissions: required,
        missingPermissions: missing,
      });
      throw error;
    }

    if (requiredAny?.length && !requiredAny.some((p) => user.permissions.includes(p))) {
      const error = new ForbiddenException(
        `Access denied. Requires one of: ${requiredAny.join(', ')}`,
      );
      await this.auditServicePermissionDenial(context, user, error, requiredAny, requiredAny);
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'permission',
        statusCode: error.getStatus(),
        reason: error.message,
        requiredPermissions: requiredAny,
        missingPermissions: requiredAny,
      });
      throw error;
    }

    return true;
  }

  private async auditServicePermissionDenial(
    context: ExecutionContext,
    user: AuthUser,
    error: ForbiddenException,
    requiredPermissions: string[],
    missingPermissions: string[],
  ): Promise<void> {
    if (user.principalType !== MSAIDIZI_SERVICE_PRINCIPAL_TYPE) return;
    const routeCapability = `${context.getClass().name}.${context.getHandler().name}`;
    await this.audit.logStrict({
      action: 'MSAIDIZI_TASK_PERMISSION_DENIED',
      entityType: 'MsaidiziTaskStep',
      entityId: user.stepId,
      userId: user.initiatedByUserId ?? user.id,
      ...(user.companyId
        ? { companyId: user.companyId, scopeKind: AuditScopeKind.COMPANY }
        : { scopeKind: AuditScopeKind.GROUP }),
      severity: AuditSeverity.HIGH,
      channel: AuditChannel.AGENT,
      agentSessionId: user.taskId ? `task_${user.taskId.replace(/-/g, '')}` : undefined,
      principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
      principalId: user.principalId,
      mandateId: user.mandateId,
      initiatedByUserId: user.initiatedByUserId,
      taskId: user.taskId,
      stepId: user.stepId,
      deviceId: user.deviceId,
      metadata: {
        stage: 'permission',
        statusCode: error.getStatus(),
        reason: error.message,
        routeCapability,
        requiredPermissions,
        missingPermissions,
      },
    });
  }
}
