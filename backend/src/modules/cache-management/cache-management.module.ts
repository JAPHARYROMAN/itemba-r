import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CacheManagementController } from './cache-management.controller';
import { CacheManagementService } from './cache-management.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CacheManagementController],
  providers: [CacheManagementService],
  exports: [CacheManagementService],
})
export class CacheManagementModule {}
