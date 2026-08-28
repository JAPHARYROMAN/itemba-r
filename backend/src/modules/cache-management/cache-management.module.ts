import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CacheManagementController } from './cache-management.controller';
import { CacheManagementService } from './cache-management.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CacheManagementController],
  providers: [CacheManagementService, CompanyScopeService],
  exports: [CacheManagementService],
})
export class CacheManagementModule {}
