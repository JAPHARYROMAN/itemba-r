import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { FinancialStatementsController } from './financial-statements.controller';
import { FinancialStatementsService } from './financial-statements.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FinancialStatementsController],
  providers: [FinancialStatementsService, CompanyScopeService],
  exports: [FinancialStatementsService],
})
export class FinancialStatementsModule {}