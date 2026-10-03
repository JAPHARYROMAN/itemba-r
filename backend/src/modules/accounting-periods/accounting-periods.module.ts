import { Module } from '@nestjs/common';
import { AccountingPeriodsService } from './accounting-periods.service';
import { AccountingPeriodsController } from './accounting-periods.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { FinancialReportsModule } from '../financial-reports/financial-reports.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, FinancialReportsModule],
  controllers: [AccountingPeriodsController],
  providers: [AccountingPeriodsService, CompanyScopeService],
  exports: [AccountingPeriodsService],
})
export class AccountingPeriodsModule {}
