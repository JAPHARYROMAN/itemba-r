import { Module } from '@nestjs/common';
import { ApprovalRequestsController } from './approval-requests.controller';
import { ApprovalRequestsService } from './approval-requests.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ApprovalRequestsController],
  providers: [ApprovalRequestsService, CompanyScopeService],
  exports: [ApprovalRequestsService],
})
export class ApprovalRequestsModule {}
