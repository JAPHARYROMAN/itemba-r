import { Module } from '@nestjs/common';
import { ApprovalEngineService } from './approval-engine.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartyExistsService } from '../../common/services/party-exists.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, NotificationsModule],
  providers: [ApprovalEngineService, PartyExistsService],
  exports: [ApprovalEngineService],
})
export class ApprovalEngineModule {}
