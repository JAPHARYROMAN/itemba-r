import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UserSecurityProfilesController } from './user-security-profiles.controller';
import { UserSecurityProfilesService } from './user-security-profiles.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [UserSecurityProfilesController],
  providers: [UserSecurityProfilesService, CompanyScopeService],
  exports: [UserSecurityProfilesService],
})
export class UserSecurityProfilesModule {}
