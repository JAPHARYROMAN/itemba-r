import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuditAdjustmentsController } from './audit-adjustments.controller';
import { AuditAdjustmentsService } from './audit-adjustments.service';
import { AccountingControlService, CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AuditAdjustmentsController],
  providers: [AuditAdjustmentsService, AccountingControlService, CompanyScopeService],
  exports: [AuditAdjustmentsService],
})
export class AuditAdjustmentsModule {}
