import { Module } from '@nestjs/common';
import { SalaryAdvancesController } from './salary-advances.controller';
import { SalaryAdvancesService } from './salary-advances.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { PayrollPostingsModule } from '../payroll-postings/payroll-postings.module';
import { CompanyScopeService } from '../../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, PayrollPostingsModule],
  controllers: [SalaryAdvancesController],
  providers: [SalaryAdvancesService, CompanyScopeService],
  exports: [SalaryAdvancesService],
})
export class SalaryAdvancesModule {}
