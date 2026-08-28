import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SENSITIVE_ACCESS_KEY } from '../decorators/sensitive-access.decorator';
import { RolesGuard } from './roles.guard';

function executionContext(roles: string[]): ExecutionContext {
  const request = {
    user: { id: 'user-1', roles },
    headers: { 'user-agent': 'roles-guard-spec' },
    ip: '127.0.0.1',
    method: 'GET',
    params: {},
    query: {},
    url: '/contracts',
  };
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function harness(requiredRoles: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === ROLES_KEY) return requiredRoles;
      if (key === SENSITIVE_ACCESS_KEY) return { entityType: 'Contracts' };
      return undefined;
    }),
  } as unknown as Reflector;
  const audit = { logStrict: jest.fn().mockResolvedValue(undefined) };
  return {
    audit,
    guard: new RolesGuard(reflector, audit as unknown as AuditLogsService),
  };
}

describe('RolesGuard sensitive denial boundary', () => {
  it('strictly audits a sensitive role 403 before preserving the denial', async () => {
    const { audit, guard } = harness(['GROUP_SUPER_ADMIN']);

    await expect(guard.canActivate(executionContext(['COMPANY_MANAGER']))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.logStrict).toHaveBeenCalledTimes(1);
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_SENSITIVE_DENIED',
        entityType: 'Contracts',
        userId: 'user-1',
        metadata: expect.objectContaining({
          stage: 'role',
          statusCode: 403,
          requiredRoles: ['GROUP_SUPER_ADMIN'],
        }),
      }),
    );
  });

  it('preserves successful role behavior without writing a denial', async () => {
    const { audit, guard } = harness(['GROUP_SUPER_ADMIN']);

    await expect(guard.canActivate(executionContext(['GROUP_SUPER_ADMIN']))).resolves.toBe(true);
    expect(audit.logStrict).not.toHaveBeenCalled();
  });
});
