import { Module } from '@nestjs/common';
import { ApprovalDelegationsController } from './approval-delegations.controller';
import { ApprovalDelegationsService } from './approval-delegations.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ApprovalDelegationsController],
  providers: [ApprovalDelegationsService],
  exports: [ApprovalDelegationsService],
})
export class ApprovalDelegationsModule {}
