import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { PeriodCloseController } from './period-close.controller';
import { PeriodCloseService } from './period-close.service';
import { FinancialReportsModule } from '../financial-reports/financial-reports.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, FinancialReportsModule],
  controllers: [PeriodCloseController],
  providers: [PeriodCloseService, CompanyScopeService],
  exports: [PeriodCloseService],
})
export class PeriodCloseModule {}
