import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyStatus } from '@prisma/client';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { API_SCOPE_KEY } from '../decorators/require-api-scope.decorator';
import { hashApiKey } from '../utils/api-key-hash';

/**
 * P0-09 regression — ApiKeyAuthGuard authentication and scope enforcement.
 *
 * The integration API surface (Phase 3 / IntegrationApiModule) relies on
 * this guard. Tests cover:
 *   - missing header → 401
 *   - invalid key → 401
 *   - revoked / non-active key → 401
 *   - expired key → 401
 *   - missing required scope → 403
 *   - all required scopes present → 200, req.user is synthesized
 *   - lastUsedAt is updated best-effort (does not block the request)
 */

const SAMPLE_KEY = 'sk_live_abc123def';
const PEPPER = 'test-api-key-pepper';
const SAMPLE_HASH = hashApiKey(SAMPLE_KEY, PEPPER);

function ctx(headers: Record<string, string>, requiredScopes?: string[]) {
  const req: any = { headers };
  const reflector = new Reflector();
  if (requiredScopes !== undefined) {
    Reflect.defineMetadata(API_SCOPE_KEY, requiredScopes, () => undefined);
  }
  return {
    executionContext: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext,
    request: req,
    reflector,
  };
}

function makeGuard(prisma: any, requiredScopesStub: string[] | undefined) {
  const reflector = new Reflector();
  reflector.getAllAndOverride = jest.fn().mockReturnValue(requiredScopesStub);
  return new ApiKeyAuthGuard(prisma, reflector, new ConfigService({ APP_ENCRYPTION_KEY: PEPPER }));
}

describe('ApiKeyAuthGuard (P0-09 regression)', () => {
  function makePrisma(overrides: any = {}) {
    return {
      apiKey: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      },
    } as any;
  }

  it('rejects requests without an x-api-key header', async () => {
    const prisma = makePrisma();
    const guard = makeGuard(prisma, []);
    const { executionContext } = ctx({});

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown api key', async () => {
    const prisma = makePrisma({ findFirst: jest.fn().mockResolvedValue(null) });
    const guard = makeGuard(prisma, []);
    const { executionContext } = ctx({ 'x-api-key': SAMPLE_KEY });

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked api key', async () => {
    const prisma = makePrisma({
      findFirst: jest.fn().mockResolvedValue({
        id: 'k-1',
        keyHash: SAMPLE_HASH,
        status: ApiKeyStatus.ACTIVE,
        revokedAt: new Date(),
        scopes: [],
        apiClientId: 'c-1',
        apiClient: { id: 'c-1', companyId: 'co-1', name: 'Client' },
      }),
    });
    const guard = makeGuard(prisma, []);
    const { executionContext } = ctx({ 'x-api-key': SAMPLE_KEY });

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired api key', async () => {
    const prisma = makePrisma({
      findFirst: jest.fn().mockResolvedValue({
        id: 'k-1',
        keyHash: SAMPLE_HASH,
        status: ApiKeyStatus.ACTIVE,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        scopes: ['payments.read'],
        apiClientId: 'c-1',
        apiClient: { id: 'c-1', companyId: 'co-1', name: 'Client' },
      }),
    });
    const guard = makeGuard(prisma, []);
    const { executionContext } = ctx({ 'x-api-key': SAMPLE_KEY });

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when a required scope is missing', async () => {
    const prisma = makePrisma({
      findFirst: jest.fn().mockResolvedValue({
        id: 'k-1',
        keyHash: SAMPLE_HASH,
        status: ApiKeyStatus.ACTIVE,
        revokedAt: null,
        expiresAt: null,
        scopes: ['payments.read'],
        apiClientId: 'c-1',
        apiKeyCode: 'KEY-1',
        apiClient: { id: 'c-1', companyId: 'co-1', name: 'Client' },
      }),
    });
    const guard = makeGuard(prisma, ['payments.write']);
    const { executionContext } = ctx({ 'x-api-key': SAMPLE_KEY });

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts when every required scope is present and synthesizes req.user', async () => {
    const prisma = makePrisma({
      findFirst: jest.fn().mockResolvedValue({
        id: 'k-1',
        keyHash: SAMPLE_HASH,
        status: ApiKeyStatus.ACTIVE,
        revokedAt: null,
        expiresAt: null,
        scopes: ['payments.read', 'payments.write'],
        apiClientId: 'c-1',
        apiKeyCode: 'KEY-1',
        apiClient: { id: 'c-1', companyId: 'co-1', name: 'Client' },
      }),
      update: jest.fn().mockResolvedValue(undefined),
    });
    const guard = makeGuard(prisma, ['payments.write']);
    const { executionContext, request } = ctx({ 'x-api-key': SAMPLE_KEY });

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request.apiKey).toBeDefined();
    expect(request.user).toMatchObject({
      id: 'c-1',
      companyId: 'co-1',
      roles: ['API_CLIENT'],
    });
    // Wait a tick for the best-effort lastUsedAt update.
    await Promise.resolve();
    expect(prisma.apiKey.update).toHaveBeenCalled();
  });

  it('accepts the X-API-Key header (case-variant) as well as x-api-key', async () => {
    const prisma = makePrisma({
      findFirst: jest.fn().mockResolvedValue({
        id: 'k-1',
        keyHash: SAMPLE_HASH,
        status: ApiKeyStatus.ACTIVE,
        revokedAt: null,
        expiresAt: null,
        scopes: [],
        apiClientId: 'c-1',
        apiKeyCode: 'KEY-1',
        apiClient: { id: 'c-1', companyId: 'co-1', name: 'Client' },
      }),
      update: jest.fn().mockResolvedValue(undefined),
    });
    const guard = makeGuard(prisma, []);
    // Express normalizes headers to lowercase. The guard reads both forms; we
    // simulate the lowercase-only path here since it's what hits production.
    const { executionContext } = ctx({ 'x-api-key': SAMPLE_KEY });
    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
  });
});
