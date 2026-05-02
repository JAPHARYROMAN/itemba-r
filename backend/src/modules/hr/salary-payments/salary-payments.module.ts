import { Module } from '@nestjs/common';
import { SalaryPaymentsController } from './salary-payments.controller';
import { SalaryPaymentsService } from './salary-payments.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SalaryPaymentsController],
  providers: [SalaryPaymentsService, CompanyScopeService],
  exports: [SalaryPaymentsService],
})
export class SalaryPaymentsModule {}
