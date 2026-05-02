import { ConfigService } from '@nestjs/config';
import {
  CachedAuthPayload,
  PermissionCacheService,
} from './permission-cache.service';

/**
 * P1-02 regression — permission cache behaviour: TTL, invalidate, and the
 * graceful degrade-to-single-process when Redis is not configured.
 *
 * The Redis pub/sub path requires an actual Redis instance and is exercised
 * separately in an e2e suite. This file pins the in-memory contract that
 * every replica relies on.
 */

const samplePayload: CachedAuthPayload = {
  id: 'user-1',
  email: 'a@b.c',
  roles: ['ADMIN'],
  roleScopes: ['GROUP'],
  role: { scope: 'GROUP' },
  permissions: ['users.read'],
  companyId: null,
  companyAccess: [],
};

function noRedisConfig() {
  return new ConfigService({
    REDIS_URL: undefined,
    REDIS_HOST: undefined,
    REDIS_PORT: undefined,
    REDIS_PASSWORD: undefined,
  });
}

describe('PermissionCacheService (P1-02 regression)', () => {
  let service: PermissionCacheService;

  beforeEach(async () => {
    service = new PermissionCacheService(noRedisConfig());
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('returns undefined for a user that was never set', () => {
    expect(service.get('nobody')).toBeUndefined();
  });

  it('stores and retrieves a payload', () => {
    service.set('user-1', samplePayload);
    expect(service.get('user-1')).toEqual(samplePayload);
  });

  it('honors a custom TTL', () => {
    jest.useFakeTimers();
    const t0 = Date.now();
    jest.setSystemTime(t0);
    service.set('user-1', samplePayload, 1_000);
    expect(service.get('user-1')).toEqual(samplePayload);

    jest.setSystemTime(t0 + 999);
    expect(service.get('user-1')).toEqual(samplePayload);

    jest.setSystemTime(t0 + 1_001);
    expect(service.get('user-1')).toBeUndefined();
    jest.useRealTimers();
  });

  it('drops the cached entry on invalidate', async () => {
    service.set('user-1', samplePayload);
    await service.invalidate('user-1');
    expect(service.get('user-1')).toBeUndefined();
  });

  it('drops every cached entry on invalidateAll', async () => {
    service.set('user-1', samplePayload);
    service.set('user-2', { ...samplePayload, id: 'user-2' });
    await service.invalidateAll();
    expect(service.get('user-1')).toBeUndefined();
    expect(service.get('user-2')).toBeUndefined();
  });

  it('handles invalidate of a key that was never set without throwing', async () => {
    await expect(service.invalidate('ghost')).resolves.toBeUndefined();
  });

  it('does not require Redis to function (single-process mode)', () => {
    // The module init logs a warning when neither REDIS_URL nor REDIS_HOST
    // is set. We don't assert on logger output here, but the service should
    // still operate correctly.
    service.set('warm-cache', samplePayload);
    expect(service.get('warm-cache')).toEqual(samplePayload);
  });
});
