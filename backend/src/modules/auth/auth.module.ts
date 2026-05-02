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

const jwtExpiresIn = (value: string): JwtSignOptions['expiresIn'] =>
  value as JwtSignOptions['expiresIn'];

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
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: jwtExpiresIn(cfg.get<string>('JWT_ACCESS_EXPIRES_IN', '15m')),
        },
      }),
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
  ],
  exports: [AuthService, TwoFactorService, RecentAuthGuard, JwtStrategy, PermissionCacheService],
})
export class AuthModule {}
