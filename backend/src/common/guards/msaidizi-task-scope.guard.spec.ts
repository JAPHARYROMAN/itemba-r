import { AuditChannel, AuditSeverity } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { currentRequestContext, runWithRequestContext } from '../context/request-context';
import { exactActionEnvelopeDigest } from '../utils/action-envelope';
import { MsaidiziTaskScopeGuard } from './msaidizi-task-scope.guard';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { SensitiveAccess } from '../decorators/sensitive-access.decorator';

class CustomersController {
  findOne() {}
}

@SensitiveAccess('Contracts')
class ContractsController {
  findOne() {}
}

function contextFor(
  user: Record<string, unknown>,
  request: Record<string, unknown>,
  controller: CustomersController | ContractsController = new CustomersController(),
) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, ...request }) }),
    getClass: () => controller.constructor,
    getHandler: () => controller.findOne,
  } as never;
}

describe('MsaidiziTaskScopeGuard', () => {
  const strictAudit = jest.fn().mockResolvedValue(undefined);
  const guard = new MsaidiziTaskScopeGuard(new Reflector(), {
    logStrict: strictAudit,
  } as unknown as AuditLogsService);
  const request = { params: { id: '41' }, query: { include: 'true' } };
  const digest = exactActionEnvelopeDigest({
    path: { id: 41 },
    query: { include: true },
  })!;
  const serviceUser = {
    id: 'user-1',
    companyId: 'company-1',
    principalType: 'SERVICE',
    principalId: 'principal-1',
    mandateId: 'mandate-1',
    initiatedByUserId: 'user-1',
    taskId: 'a87ed440-12a3-4f54-8d25-92f62a456812',
    stepId: 'step-1',
    deviceId: 'device-1',
    taskCapability: 'CustomersController.findOne',
    taskArgsDigest: digest,
    taskCredentialJti: '6ed4093e-6bed-4708-a5da-93da75c2842a',
  };

  beforeEach(() => {
    strictAudit.mockClear().mockResolvedValue(undefined);
  });

  it('does not constrain ordinary human credentials', async () => {
    await expect(guard.canActivate(contextFor({ id: 'user-1' }, request))).resolves.toBe(true);
    expect(strictAudit).not.toHaveBeenCalled();
  });

  it('accepts only the exact planned route and arguments and enriches audit context', async () => {
    await runWithRequestContext({ channel: AuditChannel.WEB }, async () => {
      await expect(guard.canActivate(contextFor(serviceUser, request))).resolves.toBe(true);
      expect(currentRequestContext()).toEqual(
        expect.objectContaining({
          channel: AuditChannel.AGENT,
          principalId: 'principal-1',
          taskId: serviceUser.taskId,
          stepId: 'step-1',
        }),
      );
    });
  });

  it('rejects a different capability even when the principal has permission', async () => {
    await expect(
      guard.canActivate(
        contextFor({ ...serviceUser, taskCapability: 'SuppliersController.findOne' }, request),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(strictAudit).toHaveBeenCalledTimes(1);
    expect(strictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MSAIDIZI_TASK_SCOPE_DENIED',
        entityType: 'MsaidiziTaskStep',
        entityId: 'step-1',
        userId: 'user-1',
        companyId: 'company-1',
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: `task_${serviceUser.taskId.replace(/-/g, '')}`,
        principalType: 'SERVICE',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'user-1',
        taskId: serviceUser.taskId,
        stepId: 'step-1',
        deviceId: 'device-1',
        metadata: expect.objectContaining({
          stage: 'task_scope',
          routeCapability: 'CustomersController.findOne',
          presentedArgsDigest: digest,
          reason: 'Task token is not valid for this capability',
        }),
      }),
    );
  });

  it('rejects changed arguments', async () => {
    await expect(
      guard.canActivate(contextFor(serviceUser, { ...request, params: { id: '42' } })),
    ).rejects.toThrow(/arguments do not match/);
    const presentedArgsDigest = exactActionEnvelopeDigest({
      path: { id: 42 },
      query: { include: true },
    });
    expect(strictAudit).toHaveBeenCalledTimes(1);
    expect(strictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MSAIDIZI_TASK_SCOPE_DENIED',
        entityType: 'MsaidiziTaskStep',
        entityId: 'step-1',
        userId: 'user-1',
        companyId: 'company-1',
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: `task_${serviceUser.taskId.replace(/-/g, '')}`,
        principalType: 'SERVICE',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'user-1',
        taskId: serviceUser.taskId,
        stepId: 'step-1',
        deviceId: 'device-1',
        metadata: expect.objectContaining({
          stage: 'task_scope',
          routeCapability: 'CustomersController.findOne',
          presentedArgsDigest,
          reason: 'Task token arguments do not match the planned action',
        }),
      }),
    );
  });

  it('strictly audits an exact-action denial on a sensitive capability', async () => {
    const sensitiveUser = {
      ...serviceUser,
      taskCapability: 'ContractsController.findOne',
    };

    await expect(
      guard.canActivate(
        contextFor(sensitiveUser, { ...request, params: { id: '42' } }, new ContractsController()),
      ),
    ).rejects.toThrow(/arguments do not match/);
    expect(strictAudit).toHaveBeenCalledTimes(2);
    expect(strictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MSAIDIZI_TASK_SCOPE_DENIED',
        entityType: 'MsaidiziTaskStep',
        entityId: 'step-1',
        userId: 'user-1',
        companyId: 'company-1',
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: `task_${serviceUser.taskId.replace(/-/g, '')}`,
        principalType: 'SERVICE',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'user-1',
        taskId: serviceUser.taskId,
        stepId: 'step-1',
        deviceId: 'device-1',
        metadata: expect.objectContaining({
          stage: 'task_scope',
          routeCapability: 'ContractsController.findOne',
          reason: 'Task token arguments do not match the planned action',
        }),
      }),
    );
    expect(strictAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_SENSITIVE_DENIED',
        entityType: 'Contracts',
        metadata: expect.objectContaining({ stage: 'task_scope' }),
      }),
    );
  });
});
