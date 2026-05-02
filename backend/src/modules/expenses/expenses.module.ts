import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingControlService, CompanyScopeService } from '../../common/services';
import { AccountingEngineModule } from '../accounting-engine/accounting-engine.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, AccountingEngineModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, AccountingControlService, CompanyScopeService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
