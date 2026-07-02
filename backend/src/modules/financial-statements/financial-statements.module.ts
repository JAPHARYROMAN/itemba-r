import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FinancialReportsModule } from '../financial-reports/financial-reports.module';
import { CompanyScopeService } from '../../common/services';
import { FinancialStatementsController } from './financial-statements.controller';
import { FinancialStatementsService } from './financial-statements.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, FinancialReportsModule],
  controllers: [FinancialStatementsController],
  providers: [FinancialStatementsService, CompanyScopeService],
  exports: [FinancialStatementsService],
})
export class FinancialStatementsModule {}
