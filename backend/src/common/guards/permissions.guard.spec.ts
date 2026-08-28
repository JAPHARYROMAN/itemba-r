import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PermissionsGuard } from './permissions.guard';
import { SENSITIVE_ACCESS_KEY } from '../decorators/sensitive-access.decorator';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { AuditChannel, AuditScopeKind, AuditSeverity } from '@prisma/client';

class CustomersController {
  findAll() {}
}

class ContractsController {
  findOne() {}
}

function contextWithPermissions(
  permissions?: string[],
  user: Record<string, unknown> = {},
  controller: CustomersController | ContractsController = new CustomersController(),
): ExecutionContext {
  const handler =
    controller instanceof ContractsController ? controller.findOne : controller.findAll;
  return {
    getHandler: () => handler,
    getClass: () => controller.constructor,
    switchToHttp: () => ({
      getRequest: () =>
        permissions
          ? {
              user: { id: 'human-1', permissions, ...user },
              headers: { 'user-agent': 'permissions-guard-spec' },
              method: 'GET',
              params: {},
              query: {},
              url: '/test',
            }
          : {},
    }),
  } as unknown as ExecutionContext;
}

function serviceAttribution(companyId?: string): Record<string, unknown> {
  return {
    principalType: 'SERVICE',
    principalId: 'principal-1',
    mandateId: 'mandate-1',
    initiatedByUserId: 'initiator-1',
    taskId: 'a87ed440-12a3-4f54-8d25-92f62a456812',
    stepId: 'step-1',
    deviceId: 'device-1',
    ...(companyId ? { companyId } : {}),
  };
}

function guardWithMetadata(required?: string[], requiredAny?: string[], sensitive = false) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return required;
      if (key === ANY_PERMISSIONS_KEY) return requiredAny;
      if (key === SENSITIVE_ACCESS_KEY) {
        return sensitive ? { entityType: 'Contracts' } : undefined;
      }
      return undefined;
    }),
  } as unknown as Reflector;
  const audit = { logStrict: jest.fn().mockResolvedValue(undefined) };

  return {
    audit,
    guard: new PermissionsGuard(reflector, audit as unknown as AuditLogsService),
  };
}

describe('PermissionsGuard', () => {
  it('allows a route when the user has one any-permission match', async () => {
    const { guard } = guardWithMetadata(undefined, ['inventory.view', 'sales.create']);

    await expect(guard.canActivate(contextWithPermissions(['sales.create']))).resolves.toBe(true);
  });

  it('denies a route when none of the any-permissions match', async () => {
    const { guard, audit } = guardWithMetadata(undefined, ['inventory.view', 'sales.create']);

    await expect(guard.canActivate(contextWithPermissions(['products.view']))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.logStrict).not.toHaveBeenCalled();
  });

  it('still requires every all-permission match', async () => {
    const { guard } = guardWithMetadata(['sales.create', 'products.view']);

    await expect(guard.canActivate(contextWithPermissions(['sales.create']))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects protected routes without an authenticated user', async () => {
    const { guard } = guardWithMetadata(undefined, ['sales.create']);

    await expect(guard.canActivate(contextWithPermissions())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('strictly appends a sensitive permission denial before rejecting', async () => {
    const { guard, audit } = guardWithMetadata(['contracts.view'], undefined, true);

    await expect(guard.canActivate(contextWithPermissions(['customers.view']))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_SENSITIVE_DENIED',
        entityType: 'Contracts',
        metadata: expect.objectContaining({
          stage: 'permission',
          missingPermissions: ['contracts.view'],
        }),
      }),
    );
  });

  it('strictly audits one company-scoped service denial for an all-permission failure', async () => {
    const { guard, audit } = guardWithMetadata(['sales.create', 'products.view']);
    const attribution = serviceAttribution('company-1');

    await expect(
      guard.canActivate(contextWithPermissions(['sales.create'], attribution)),
    ).rejects.toThrow(ForbiddenException);

    expect(audit.logStrict).toHaveBeenCalledTimes(1);
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MSAIDIZI_TASK_PERMISSION_DENIED',
        entityType: 'MsaidiziTaskStep',
        entityId: 'step-1',
        userId: 'initiator-1',
        companyId: 'company-1',
        scopeKind: AuditScopeKind.COMPANY,
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: 'task_a87ed44012a34f548d2592f62a456812',
        principalType: 'SERVICE',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'initiator-1',
        taskId: 'a87ed440-12a3-4f54-8d25-92f62a456812',
        stepId: 'step-1',
        deviceId: 'device-1',
        metadata: expect.objectContaining({
          stage: 'permission',
          statusCode: 403,
          routeCapability: 'CustomersController.findAll',
          requiredPermissions: ['sales.create', 'products.view'],
          missingPermissions: ['products.view'],
        }),
      }),
    );
  });

  it('strictly audits one group-scoped service denial for an any-permission failure', async () => {
    const { guard, audit } = guardWithMetadata(undefined, ['inventory.view', 'sales.create']);
    const attribution = serviceAttribution();

    await expect(
      guard.canActivate(contextWithPermissions(['products.view'], attribution)),
    ).rejects.toThrow(ForbiddenException);

    expect(audit.logStrict).toHaveBeenCalledTimes(1);
    const denial = audit.logStrict.mock.calls[0][0];
    expect(denial).toEqual(
      expect.objectContaining({
        action: 'MSAIDIZI_TASK_PERMISSION_DENIED',
        entityType: 'MsaidiziTaskStep',
        entityId: 'step-1',
        userId: 'initiator-1',
        scopeKind: AuditScopeKind.GROUP,
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: 'task_a87ed44012a34f548d2592f62a456812',
        principalType: 'SERVICE',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'initiator-1',
        taskId: 'a87ed440-12a3-4f54-8d25-92f62a456812',
        stepId: 'step-1',
        deviceId: 'device-1',
        metadata: expect.objectContaining({
          stage: 'permission',
          statusCode: 403,
          routeCapability: 'CustomersController.findAll',
          requiredPermissions: ['inventory.view', 'sales.create'],
          missingPermissions: ['inventory.view', 'sales.create'],
        }),
      }),
    );
    expect(denial).not.toHaveProperty('companyId');
  });

  it('emits one service denial plus one sensitive denial without duplicating either row', async () => {
    const { guard, audit } = guardWithMetadata(['contracts.view'], undefined, true);

    await expect(
      guard.canActivate(
        contextWithPermissions(
          ['customers.view'],
          serviceAttribution('company-1'),
          new ContractsController(),
        ),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(audit.logStrict).toHaveBeenCalledTimes(2);
    const actions = audit.logStrict.mock.calls.map(([input]) => input.action);
    expect(actions.filter((action) => action === 'MSAIDIZI_TASK_PERMISSION_DENIED')).toHaveLength(
      1,
    );
    expect(actions.filter((action) => action === 'VIEW_SENSITIVE_DENIED')).toHaveLength(1);
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MSAIDIZI_TASK_PERMISSION_DENIED',
        principalId: 'principal-1',
        mandateId: 'mandate-1',
        initiatedByUserId: 'initiator-1',
        taskId: 'a87ed440-12a3-4f54-8d25-92f62a456812',
        stepId: 'step-1',
        metadata: expect.objectContaining({ routeCapability: 'ContractsController.findOne' }),
      }),
    );
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_SENSITIVE_DENIED',
        entityType: 'Contracts',
        metadata: expect.objectContaining({ stage: 'permission' }),
      }),
    );
  });

  it('propagates a mandatory service-denial audit failure', async () => {
    const { guard, audit } = guardWithMetadata(['sales.create']);
    const persistenceError = new Error('service audit unavailable');
    audit.logStrict.mockRejectedValueOnce(persistenceError);

    await expect(
      guard.canActivate(contextWithPermissions(['products.view'], serviceAttribution('company-1'))),
    ).rejects.toBe(persistenceError);
    expect(audit.logStrict).toHaveBeenCalledTimes(1);
  });

  it('propagates a mandatory audit failure instead of returning an unaudited denial', async () => {
    const { guard, audit } = guardWithMetadata(['contracts.view'], undefined, true);
    audit.logStrict.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(guard.canActivate(contextWithPermissions(['customers.view']))).rejects.toThrow(
      'audit unavailable',
    );
  });
});
