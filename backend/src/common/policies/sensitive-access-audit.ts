import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditScopeKind } from '@prisma/client';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { AuthUser } from '../decorators/current-user.decorator';
import {
  SENSITIVE_ACCESS_KEY,
  SensitiveAccessMetadata,
} from '../decorators/sensitive-access.decorator';

export interface SensitiveDenialDetails {
  stage: 'authentication' | 'task_scope' | 'role' | 'permission' | 'handler';
  statusCode: number;
  reason: string;
  requiredPermissions?: readonly string[];
  requiredRoles?: readonly string[];
  missingPermissions?: readonly string[];
}

export function sensitiveAccessMetadata(
  reflector: Reflector,
  context: ExecutionContext,
): SensitiveAccessMetadata | undefined {
  return reflector.getAllAndOverride<SensitiveAccessMetadata>(SENSITIVE_ACCESS_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

/**
 * Guard failures occur before controller interceptors. Every guard that can
 * deny a sensitive route calls this fail-closed append before throwing.
 */
export async function auditSensitiveAccessDenial(
  reflector: Reflector,
  audit: AuditLogsService,
  context: ExecutionContext,
  details: SensitiveDenialDetails,
): Promise<void> {
  const sensitive = sensitiveAccessMetadata(reflector, context);
  if (!sensitive) return;

  const request = context.switchToHttp().getRequest<{
    user?: AuthUser;
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    url?: string;
    method?: string;
    query?: unknown;
    body?: unknown;
    params?: unknown;
  }>();
  const requestedCompanyId = requestCompanyId(request);
  const userAgent = request.headers?.['user-agent'];

  await audit.logStrict({
    action: 'VIEW_SENSITIVE_DENIED',
    entityType: sensitive.entityType,
    userId: request.user?.id,
    // A failed attempt disclosed no tenant record. Classify it as a deliberate
    // group-oversight security event rather than trusting caller-supplied scope.
    scopeKind: AuditScopeKind.GROUP,
    ipAddress: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
    metadata: {
      outcome: 'denied',
      stage: details.stage,
      statusCode: details.statusCode,
      reason: details.reason,
      path: request.url,
      method: request.method,
      requestedCompanyId,
      requiredPermissions: details.requiredPermissions,
      requiredRoles: details.requiredRoles,
      missingPermissions: details.missingPermissions,
    },
  });
}

function requestCompanyId(request: {
  query?: unknown;
  body?: unknown;
  params?: unknown;
}): string | undefined {
  for (const container of [request.query, request.body, request.params]) {
    if (!container || typeof container !== 'object') continue;
    const value = (container as Record<string, unknown>).companyId;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
