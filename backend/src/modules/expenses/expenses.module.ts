import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingControlService, CompanyScopeService } from '../../common/services';
import { AccountingEngineModule } from '../accounting-engine/accounting-engine.module';
import { TaxAutoApplyModule } from '../tax-auto-apply/tax-auto-apply.module';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { CashBookModule } from '../cash-book/cash-book.module';

import { PartyExistsService } from '../../common/services/party-exists.service';
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    AccountingEngineModule,
    TaxAutoApplyModule,
    SupplierPaymentsModule,
    CashBookModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService, AccountingControlService, CompanyScopeService, PartyExistsService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
