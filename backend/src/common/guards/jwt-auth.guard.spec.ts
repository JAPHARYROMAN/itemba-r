import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { IS_JWT_REFRESH_ROUTE } from '../decorators/jwt-refresh.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SENSITIVE_ACCESS_KEY } from '../decorators/sensitive-access.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

interface SpecRequest {
  headers: {
    'user-agent': string;
    authorization: string;
  };
  ip: string;
  method: string;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  url: string;
  user?: unknown;
}

function authenticatedRequest(): SpecRequest {
  return {
    headers: {
      'user-agent': 'jwt-guard-spec',
      authorization: 'Bearer signed-access-token',
    },
    ip: '127.0.0.1',
    method: 'GET',
    params: {},
    query: { companyId: 'untrusted-company' },
    url: '/contracts',
  };
}

function executionContext(request: SpecRequest = authenticatedRequest()): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function harness(sensitive = true) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY || key === IS_JWT_REFRESH_ROUTE) return false;
      if (key === SENSITIVE_ACCESS_KEY) {
        return sensitive ? { entityType: 'Contracts' } : undefined;
      }
      return undefined;
    }),
  } as unknown as Reflector;
  const audit = { logStrict: jest.fn().mockResolvedValue(undefined) };
  return {
    audit,
    guard: new JwtAuthGuard(reflector, audit as unknown as AuditLogsService),
  };
}

describe('JwtAuthGuard sensitive denial boundary', () => {
  const parentPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
    canActivate: (context: ExecutionContext) => unknown;
  };
  let parentCanActivate: jest.SpyInstance;

  beforeEach(() => {
    parentCanActivate = jest.spyOn(parentPrototype, 'canActivate');
  });

  afterEach(() => {
    parentCanActivate.mockRestore();
  });

  it('strictly audits a sensitive JWT 401 before preserving the authentication error', async () => {
    const error = new UnauthorizedException('Invalid access token');
    parentCanActivate.mockRejectedValueOnce(error);
    const { audit, guard } = harness();

    await expect(guard.canActivate(executionContext())).rejects.toBe(error);
    expect(audit.logStrict).toHaveBeenCalledTimes(1);
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_SENSITIVE_DENIED',
        entityType: 'Contracts',
        metadata: expect.objectContaining({
          outcome: 'denied',
          stage: 'authentication',
          statusCode: 401,
        }),
      }),
    );
  });

  it('does not audit an authentication denial on a non-sensitive route', async () => {
    const error = new UnauthorizedException('Invalid access token');
    parentCanActivate.mockRejectedValueOnce(error);
    const { audit, guard } = harness(false);

    await expect(guard.canActivate(executionContext())).rejects.toBe(error);
    expect(audit.logStrict).not.toHaveBeenCalled();
  });

  it('attempts a failed strict append only once on the false-return path', async () => {
    parentCanActivate.mockResolvedValueOnce(false);
    const { audit, guard } = harness();
    const persistenceError = new Error('audit persistence unavailable');
    audit.logStrict.mockRejectedValueOnce(persistenceError);

    await expect(guard.canActivate(executionContext())).rejects.toBe(persistenceError);
    expect(audit.logStrict).toHaveBeenCalledTimes(1);
  });

  it('reuses one successful Passport decision for a local guard on the same request and bearer', async () => {
    const request = authenticatedRequest();
    const context = executionContext(request);
    parentCanActivate.mockImplementationOnce(async () => {
      request.user = { id: 'user-1' };
      return true;
    });
    const globalGuard = harness(false).guard;
    const localGuard = harness(false).guard;

    await expect(globalGuard.canActivate(context)).resolves.toBe(true);
    await expect(localGuard.canActivate(context)).resolves.toBe(true);

    expect(parentCanActivate).toHaveBeenCalledTimes(1);
  });

  it('does not trust request.user without the server-owned authentication marker', async () => {
    const request = authenticatedRequest();
    request.user = { id: 'attacker-supplied-user' };
    const error = new UnauthorizedException('Invalid access token');
    parentCanActivate.mockRejectedValueOnce(error);
    const { guard } = harness(false);

    await expect(guard.canActivate(executionContext(request))).rejects.toBe(error);
    expect(parentCanActivate).toHaveBeenCalledTimes(1);
  });

  it('does not reuse the marker after the bearer authorization changes', async () => {
    const request = authenticatedRequest();
    const context = executionContext(request);
    const error = new UnauthorizedException('Replacement token is invalid');
    parentCanActivate
      .mockImplementationOnce(async () => {
        request.user = { id: 'user-1' };
        return true;
      })
      .mockRejectedValueOnce(error);
    const { guard } = harness(false);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    request.headers.authorization = 'Bearer different-access-token';
    await expect(guard.canActivate(context)).rejects.toBe(error);

    expect(parentCanActivate).toHaveBeenCalledTimes(2);
  });
});
