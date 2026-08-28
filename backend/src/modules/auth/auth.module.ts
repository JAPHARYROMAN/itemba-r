import { Global, Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { UsersModule } from '../users/users.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { PermissionCacheService } from '../../common/services';
import { MsaidiziTaskTokenService } from './msaidizi-task-token.service';

const jwtExpiresIn = (value: string): JwtSignOptions['expiresIn'] =>
  value as JwtSignOptions['expiresIn'];

const isNonExpiringJwtDuration = (value: string): boolean =>
  ['never', 'none', 'no-expiry', 'no_expiry', '0'].includes(value.trim().toLowerCase());

/**
 * ITMB-005: Access tokens MUST always carry an `exp` claim so a leaked/stolen
 * access token expires on its own rather than living until the bound
 * ActiveSession is manually revoked. When `JWT_ACCESS_EXPIRES_IN` is configured
 * non-expiring (e.g. 'never'), fall back to a finite default instead of issuing
 * an eternal token. This narrows token lifetime; refresh-token behaviour is
 * unchanged.
 *
 * The fallback is 12h (not minutes): the session itself is kept alive by the
 * refresh token (persistent when JWT_REFRESH_EXPIRES_IN=never), so the access
 * token only needs to be short enough to bound a stolen-token window while
 * being long enough that the silent refresh rarely has to run. A leaked access
 * token still expires on its own within 12h.
 */
const ACCESS_TOKEN_FALLBACK_TTL = '12h';

/**
 * AuthModule is intentionally @Global so the PermissionCacheService and
 * JwtStrategy are visible to every module that needs to invalidate a user's
 * cached permissions after a role/access mutation. Without this, role
 * assignment in one module could not propagate revocations across replicas
 * because the JwtStrategy.invalidate() entry point would not be reachable.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    PassportModule,
    UsersModule,
    AuditLogsModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const accessExpiresIn = cfg.get<string>('JWT_ACCESS_EXPIRES_IN', 'never');
        // ITMB-005: never mint a non-expiring access token. A configured
        // non-expiring value falls back to a finite default so every access
        // token carries an `exp` claim.
        const effectiveAccessExpiresIn = isNonExpiringJwtDuration(accessExpiresIn)
          ? ACCESS_TOKEN_FALLBACK_TTL
          : accessExpiresIn;
        return {
          secret: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
          signOptions: { expiresIn: jwtExpiresIn(effectiveAccessExpiresIn) },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorService,
    PasswordResetService,
    RecentAuthGuard,
    JwtStrategy,
    JwtRefreshStrategy,
    PermissionCacheService,
    MsaidiziTaskTokenService,
  ],
  exports: [
    AuthService,
    TwoFactorService,
    RecentAuthGuard,
    JwtStrategy,
    PermissionCacheService,
    MsaidiziTaskTokenService,
  ],
})
export class AuthModule {}
