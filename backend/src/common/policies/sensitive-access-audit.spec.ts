import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { SENSITIVE_ACCESS_KEY } from '../decorators/sensitive-access.decorator';
import { auditSensitiveAccessDenial } from './sensitive-access-audit';

function executionContext(): ExecutionContext {
  class CustomersController {}
  const findAll = () => undefined;
  return {
    getClass: () => CustomersController,
    getHandler: () => findAll,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 'user-1' },
        headers: {},
        method: 'GET',
        params: {},
        query: {},
        url: '/customers',
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('sensitive access denial audit', () => {
  it('is a no-op for a route without explicit sensitive metadata', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const audit = { logStrict: jest.fn() };

    await expect(
      auditSensitiveAccessDenial(
        reflector,
        audit as unknown as AuditLogsService,
        executionContext(),
        { stage: 'permission', statusCode: 403, reason: 'missing permission' },
      ),
    ).resolves.toBeUndefined();
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(SENSITIVE_ACCESS_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
    expect(audit.logStrict).not.toHaveBeenCalled();
  });

  it('fails closed when the mandatory audit append cannot persist', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue({ entityType: 'Contracts' }),
    } as unknown as Reflector;
    const persistenceError = new Error('audit persistence unavailable');
    const audit = { logStrict: jest.fn().mockRejectedValue(persistenceError) };

    await expect(
      auditSensitiveAccessDenial(
        reflector,
        audit as unknown as AuditLogsService,
        executionContext(),
        { stage: 'permission', statusCode: 403, reason: 'missing permission' },
      ),
    ).rejects.toBe(persistenceError);
    expect(audit.logStrict).toHaveBeenCalledTimes(1);
  });
});
