import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DisbursementsController } from './disbursements.controller';
import { DisbursementsService } from './disbursements.service';
import { CompanyScopeService } from '../../../common/services';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DisbursementsController],
  providers: [DisbursementsService, CompanyScopeService],
  exports: [DisbursementsService],
})
export class DisbursementsModule {}
