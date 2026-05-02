import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OfflineSyncController } from './offline-sync.controller';
import { OfflineSyncControlService } from './offline-sync-control.service';
import { OfflineSyncService } from './offline-sync.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [OfflineSyncController],
  providers: [OfflineSyncService, OfflineSyncControlService, CompanyScopeService],
  exports: [OfflineSyncService],
})
export class OfflineSyncModule {}
