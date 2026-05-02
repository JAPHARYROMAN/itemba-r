import { Module } from '@nestjs/common';
import { ApprovalStepsController } from './approval-steps.controller';
import { ApprovalStepsService } from './approval-steps.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ApprovalStepsController],
  providers: [ApprovalStepsService],
  exports: [ApprovalStepsService],
})
export class ApprovalStepsModule {}
