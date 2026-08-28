import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, Observable, of, throwError } from 'rxjs';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { SensitiveAccessInterceptor } from './sensitive-access.interceptor';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { SENSITIVE_ACCESS_KEY } from '../decorators/sensitive-access.decorator';
import { AuditChannel, AuditScopeKind } from '@prisma/client';
import {
  recordValidatedCompanyScope,
  runWithRequestContext,
  ValidatedCompanyScopeKind,
} from '../context/request-context';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function executionContext(requestOverrides: Record<string, unknown> = {}): ExecutionContext {
  class ContractsController {}
  const request = {
    user: { id: 'user-1', companyId: 'company-1', roleScopes: ['COMPANY'] },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'interceptor-spec' },
    url: '/contracts',
    method: 'POST',
    query: { companyId: 'company-1' },
    body: {},
    params: {},
    ...requestOverrides,
  };

  return {
    getHandler: () => executionContext,
    getClass: () => ContractsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SensitiveAccessInterceptor', () => {
  const requiredPermissions = ['contracts.create'];

  function setup(auditResult: Promise<void>) {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === PERMISSIONS_KEY) return requiredPermissions;
        if (key === ANY_PERMISSIONS_KEY) return undefined;
        if (key === SENSITIVE_ACCESS_KEY) return { entityType: 'Contracts' };
        return undefined;
      }),
    } as unknown as Reflector;
    const audit = {
      logStrict: jest.fn().mockReturnValue(auditResult),
    } as unknown as AuditLogsService;

    return {
      audit,
      interceptor: new SensitiveAccessInterceptor(reflector, audit),
    };
  }

  function withValidatedScope<T>(
    callback: () => T,
    kind: ValidatedCompanyScopeKind = 'COMPANY',
    companyIds: string[] = ['company-1'],
  ): T {
    return runWithRequestContext({ channel: AuditChannel.WEB }, () => {
      recordValidatedCompanyScope(kind, companyIds);
      return callback();
    });
  }

  it('does not emit or complete a successful response until its audit write resolves', async () => {
    const auditWrite = deferred<void>();
    const { audit, interceptor } = setup(auditWrite.promise);
    const response = { id: 'contract-1' };
    const received: unknown[] = [];
    let completed = false;
    const completion = withValidatedScope(
      () =>
        new Promise<void>((resolve, reject) => {
          interceptor
            .intercept(executionContext(), {
              handle: () => of(response),
            } as CallHandler)
            .subscribe({
              next: (value) => received.push(value),
              error: reject,
              complete: () => {
                completed = true;
                resolve();
              },
            });
        }),
    );

    expect(received).toEqual([]);
    expect(completed).toBe(false);
    expect(audit.logStrict).toHaveBeenCalledWith({
      action: 'VIEW_SENSITIVE',
      entityType: 'Contracts',
      userId: 'user-1',
      scopeKind: AuditScopeKind.COMPANY,
      companyScopeIds: ['company-1'],
      ipAddress: '127.0.0.1',
      userAgent: 'interceptor-spec',
      metadata: {
        requiredPermissions,
        path: '/contracts',
        method: 'POST',
        outcome: 'allowed',
        requestedCompanyId: 'company-1',
      },
    });

    auditWrite.resolve();
    await completion;

    expect(received).toEqual([response]);
    expect(completed).toBe(true);
  });

  it('does not propagate a denied error until its audit write resolves', async () => {
    const auditWrite = deferred<void>();
    const { audit, interceptor } = setup(auditWrite.promise);
    const sourceError = Object.assign(new Error('company scope denied'), {
      status: 403,
    });
    let observedError: unknown;
    let completed = false;
    const errorObserved = new Promise<void>((resolve) => {
      interceptor
        .intercept(executionContext(), {
          handle: (): Observable<never> => throwError(() => sourceError),
        } as CallHandler)
        .subscribe({
          error: (error) => {
            observedError = error;
            resolve();
          },
          complete: () => {
            completed = true;
            resolve();
          },
        });
    });

    expect(observedError).toBeUndefined();
    expect(completed).toBe(false);
    expect(audit.logStrict).toHaveBeenCalledWith({
      action: 'VIEW_SENSITIVE_DENIED',
      entityType: 'Contracts',
      userId: 'user-1',
      scopeKind: AuditScopeKind.GROUP,
      ipAddress: '127.0.0.1',
      userAgent: 'interceptor-spec',
      metadata: {
        requiredPermissions,
        path: '/contracts',
        method: 'POST',
        outcome: 'denied',
        stage: 'handler',
        statusCode: 403,
        reason: 'company scope denied',
        requestedCompanyId: 'company-1',
      },
    });

    auditWrite.resolve();
    await errorObserved;

    expect(observedError).toBe(sourceError);
    expect(completed).toBe(false);
  });

  it('fails closed when a successful handler never established validated scope', async () => {
    const { audit, interceptor } = setup(Promise.resolve());
    const context = executionContext({
      user: { id: 'group-user', companyId: 'company-1', roleScopes: ['GROUP'] },
      query: { companyId: 'nonexistent-or-foreign-company' },
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(context, { handle: () => of({ total: 0 }) } as CallHandler),
      ),
    ).rejects.toThrow(/without authenticated, validated company scope/);

    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_SENSITIVE_DENIED',
        scopeKind: AuditScopeKind.GROUP,
        metadata: expect.objectContaining({
          stage: 'scope_attribution',
          requestedCompanyId: 'nonexistent-or-foreign-company',
        }),
      }),
    );
  });

  it('does not choose an arbitrary company from a multi-company response', async () => {
    const { audit, interceptor } = setup(Promise.resolve());
    const context = executionContext({
      user: { id: 'group-user', companyId: 'company-1', roleScopes: ['GROUP'] },
      query: {},
    });

    await withValidatedScope(
      () =>
        lastValueFrom(
          interceptor.intercept(context, {
            handle: () => of({ data: [{ companyId: 'decoy-company' }] }),
          } as CallHandler),
        ),
      'MULTI_COMPANY',
      ['company-1', 'company-2'],
    );

    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKind: AuditScopeKind.MULTI_COMPANY,
        companyScopeIds: ['company-1', 'company-2'],
      }),
    );
  });
});
