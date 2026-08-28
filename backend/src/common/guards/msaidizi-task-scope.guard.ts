import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuditChannel, AuditScopeKind, AuditSeverity } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';
import { enrichRequestContext } from '../context/request-context';
import { exactActionEnvelopeDigest } from '../utils/action-envelope';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { auditSensitiveAccessDenial } from '../policies/sensitive-access-audit';

/**
 * Makes a service-principal JWT useful for exactly one planned ERP action.
 * Permission checks still run afterwards; this guard adds the narrower
 * task/plan/step/action binding that ordinary human access tokens do not need.
 */
@Injectable()
export class MsaidiziTaskScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const user = request.user;
    if (user?.principalType !== 'SERVICE') return true;

    enrichRequestContext({
      channel: AuditChannel.AGENT,
      agentSessionId: user.taskId ? `task_${user.taskId.replace(/-/g, '')}` : undefined,
      principalType: user.principalType,
      principalId: user.principalId,
      mandateId: user.mandateId,
      initiatedByUserId: user.initiatedByUserId,
      taskId: user.taskId,
      stepId: user.stepId,
      deviceId: user.deviceId,
    });

    try {
      const routeCapability = `${context.getClass().name}.${context.getHandler().name}`;
      if (!user.taskCapability || user.taskCapability !== routeCapability) {
        throw new ForbiddenException('Task token is not valid for this capability');
      }

      const incoming = {
        path: request.params ?? {},
        query: request.query ?? {},
        ...(request.body === undefined ? {} : { body: request.body }),
      };
      const digest = exactActionEnvelopeDigest(incoming);
      if (!digest || !user.taskArgsDigest || digest !== user.taskArgsDigest) {
        throw new ForbiddenException('Task token arguments do not match the planned action');
      }
      const presentedInputProvenance = request.headers?.['x-msaidizi-input-provenance-sha256'];
      const presentedDigest = Array.isArray(presentedInputProvenance)
        ? presentedInputProvenance[0]
        : presentedInputProvenance;
      if (
        (user.taskInputProvenanceSha256 !== undefined || presentedDigest !== undefined) &&
        (!user.taskInputProvenanceSha256 ||
          !presentedDigest ||
          presentedDigest !== user.taskInputProvenanceSha256)
      ) {
        throw new ForbiddenException('Task input provenance does not match the bound attempt');
      }

      if (!user.taskId || !user.stepId || !user.taskCredentialJti) {
        throw new ForbiddenException('Task token has no one-shot binding');
      }

      return true;
    } catch (error) {
      await this.audit.logStrict({
        action: 'MSAIDIZI_TASK_SCOPE_DENIED',
        entityType: 'MsaidiziTaskStep',
        entityId: user.stepId,
        userId: user.initiatedByUserId ?? user.id,
        ...(user.companyId ? { companyId: user.companyId } : { scopeKind: AuditScopeKind.GROUP }),
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: user.taskId ? `task_${user.taskId.replace(/-/g, '')}` : undefined,
        principalType: user.principalType,
        principalId: user.principalId,
        mandateId: user.mandateId,
        initiatedByUserId: user.initiatedByUserId,
        taskId: user.taskId,
        stepId: user.stepId,
        deviceId: user.deviceId,
        metadata: {
          stage: 'task_scope',
          reason: error instanceof Error ? error.message : String(error),
          routeCapability: `${context.getClass().name}.${context.getHandler().name}`,
          presentedArgsDigest: exactActionEnvelopeDigest({
            path: request.params ?? {},
            query: request.query ?? {},
            ...(request.body === undefined ? {} : { body: request.body }),
          }),
          presentedInputProvenanceSha256: request.headers?.['x-msaidizi-input-provenance-sha256'],
          expectedInputProvenanceSha256: user.taskInputProvenanceSha256,
        },
      });
      await auditSensitiveAccessDenial(this.reflector, this.audit, context, {
        stage: 'task_scope',
        statusCode: error instanceof ForbiddenException ? error.getStatus() : 500,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
