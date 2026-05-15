import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HospitalityPaymentsService } from './hospitality-payments.service';
import { HospitalityPaymentsController } from './hospitality-payments.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [HospitalityPaymentsService, CompanyScopeService],
  controllers: [HospitalityPaymentsController],
  exports: [HospitalityPaymentsService],
})
export class HospitalityPaymentsModule {}
