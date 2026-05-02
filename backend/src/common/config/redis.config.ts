import { CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-ioredis-yet';

export const redisConfig = (config: ConfigService): CacheModuleOptions => {
  const host = config.get<string>('REDIS_HOST');

  if (!host) {
    // Fallback to in-memory cache if Redis not configured
    return {
      ttl: config.get<number>('REDIS_TTL') ?? 300,
    };
  }

  return {
    store: redisStore,
    host,
    port: config.get<number>('REDIS_PORT') ?? 6379,
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    ttl: config.get<number>('REDIS_TTL') ?? 300,
  };
};
