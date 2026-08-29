import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingControlService, CompanyScopeService } from '../../common/services';
import { AccountingEngineModule } from '../accounting-engine/accounting-engine.module';
import { TaxAutoApplyModule } from '../tax-auto-apply/tax-auto-apply.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, AccountingEngineModule, TaxAutoApplyModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, AccountingControlService, CompanyScopeService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
