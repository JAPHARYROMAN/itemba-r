import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { MobilePosAuthService } from './mobile-pos-auth.service';
import {
  MobilePosAuthController,
  MobilePosOnboardingController,
} from './mobile-pos-auth.controller';

@Module({
  imports: [ConfigModule, JwtModule.register({}), AuditLogsModule, NotificationsModule],
  providers: [MobilePosAuthService, CompanyScopeService, OrganizationScopeService],
  controllers: [MobilePosAuthController, MobilePosOnboardingController],
  exports: [MobilePosAuthService],
})
export class MobilePosAuthModule {}
