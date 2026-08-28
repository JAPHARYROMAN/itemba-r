import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Resolved AuthUser payload as cached by JwtStrategy after a database lookup.
 * Kept loose so the JwtStrategy stays the single source of truth for shape.
 */
export type CachedAuthPayload = {
  id: string;
  email: string;
  fullName?: string;
  roles: string[];
  roleScopes: string[];
  role: { scope: string } | null;
  permissions: string[];
  companyId: string | null;
  companyAccess: Array<{ companyId: string; accessLevel: string }>;
  divisionAccess?: Array<{ divisionId: string; accessLevel: string }>;
  branchAccess?: Array<{ branchId: string; accessLevel: string }>;
  principalType?: string;
  principalId?: string;
  mandateId?: string;
  initiatedByUserId?: string;
  taskId?: string;
  stepId?: string;
  deviceId?: string;
  planVersion?: number;
  taskCapability?: string;
  taskArgsDigest?: string;
  taskInputProvenanceSha256?: string;
  taskCredentialJti?: string;
};

interface LocalEntry {
  expiresAt: number;
  payload: CachedAuthPayload;
}

const DEFAULT_TTL_MS = 60_000; // matches the previous JwtStrategy TTL
const INVALIDATION_CHANNEL = 'itemba:auth:invalidate';

/**
 * Shared permission/user cache for JwtStrategy.
 *
 * P1-02: When Redis is configured (REDIS_HOST or REDIS_URL), invalidations
 * are broadcast to all API replicas via pub/sub so a role change, user
 * disablement, or permission revocation propagates within seconds across
 * the whole cluster. Without Redis, the cache degrades gracefully to a
 * per-process Map — the same behavior the legacy strategy had — so dev
 * setups without Redis still boot.
 *
 * The cache itself is local (Map). Redis is used ONLY for invalidation
 * messages, not as the storage backend, because the cached payload contains
 * permission lists derived from the current DB state and is cheap to rebuild
 * on cache miss. Storing it in Redis would add a network round-trip per
 * authenticated request without meaningful benefit.
 */
@Injectable()
export class PermissionCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionCacheService.name);
  private readonly cache = new Map<string, LocalEntry>();
  private readonly ttlMs = DEFAULT_TTL_MS;
  private readonly instanceId = `inst-${Math.random().toString(36).slice(2, 10)}`;

  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    const redisHost = this.config.get<string>('REDIS_HOST');
    const redisPort = this.config.get<number>('REDIS_PORT');
    const redisPassword = this.config.get<string>('REDIS_PASSWORD');

    if (!redisUrl && !redisHost) {
      this.logger.warn(
        'PermissionCacheService running in single-process mode (no REDIS_URL/REDIS_HOST). ' +
          'Permission revocations will not propagate across replicas.',
      );
      return;
    }

    try {
      const pubOptions = redisUrl
        ? redisUrl
        : { host: redisHost, port: redisPort ?? 6379, password: redisPassword || undefined };
      this.publisher = redisUrl ? new Redis(redisUrl as string) : new Redis(pubOptions as any);
      this.subscriber = redisUrl ? new Redis(redisUrl as string) : new Redis(pubOptions as any);

      this.publisher.on('error', (err) =>
        this.logger.error(`PermissionCache publisher error: ${err.message}`),
      );
      this.subscriber.on('error', (err) =>
        this.logger.error(`PermissionCache subscriber error: ${err.message}`),
      );

      await this.subscriber.subscribe(INVALIDATION_CHANNEL);
      this.subscriber.on('message', (channel, message) => {
        if (channel !== INVALIDATION_CHANNEL) return;
        try {
          const payload = JSON.parse(message) as { userId?: string; from?: string; all?: boolean };
          // Ignore our own broadcasts — we already invalidated locally.
          if (payload.from === this.instanceId) return;
          if (payload.all) {
            this.cache.clear();
          } else if (payload.userId) {
            this.cache.delete(payload.userId);
          }
        } catch (err) {
          this.logger.warn(
            `PermissionCache received malformed invalidation message: ${(err as Error).message}`,
          );
        }
      });
      this.logger.log(
        `PermissionCacheService running in distributed mode (instance=${this.instanceId})`,
      );
    } catch (err) {
      this.logger.error(
        `PermissionCacheService failed to attach to Redis — falling back to single-process mode: ${(err as Error).message}`,
      );
      this.publisher = undefined;
      this.subscriber = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(INVALIDATION_CHANNEL);
      } catch {
        /* ignore */
      }
      this.subscriber.disconnect();
    }
    if (this.publisher) this.publisher.disconnect();
  }

  get(userId: string): CachedAuthPayload | undefined {
    const entry = this.cache.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(userId);
      return undefined;
    }
    return entry.payload;
  }

  set(userId: string, payload: CachedAuthPayload, ttlMs: number = this.ttlMs): void {
    this.cache.set(userId, { expiresAt: Date.now() + ttlMs, payload });
  }

  /**
   * Drop a user from local cache and broadcast the invalidation to all other
   * replicas so they drop their copies on the next request. Safe to call from
   * any service after a role/permission/access mutation.
   */
  async invalidate(userId: string): Promise<void> {
    this.cache.delete(userId);
    if (this.publisher) {
      try {
        await this.publisher.publish(
          INVALIDATION_CHANNEL,
          JSON.stringify({ userId, from: this.instanceId }),
        );
      } catch (err) {
        this.logger.error(
          `PermissionCache failed to publish invalidate(${userId}): ${(err as Error).message}`,
        );
      }
    }
  }

  /** Clear every cached user across the cluster. Use for emergency rotations. */
  async invalidateAll(): Promise<void> {
    this.cache.clear();
    if (this.publisher) {
      try {
        await this.publisher.publish(
          INVALIDATION_CHANNEL,
          JSON.stringify({ all: true, from: this.instanceId }),
        );
      } catch (err) {
        this.logger.error(
          `PermissionCache failed to publish invalidateAll: ${(err as Error).message}`,
        );
      }
    }
  }
}
