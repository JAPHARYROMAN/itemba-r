import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CashBookModule } from '../cash-book/cash-book.module';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SupplierPaymentsService } from './supplier-payments.service';
import { CompanyScopeService } from '../../common/services';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';

/**
 * PostingEngineService, AccountResolverService (AccountingEngineModule) and
 * EntityCodeGeneratorService are provided by @Global modules, so they only need to
 * be injected (matches customer-payments). Payables, Expenses and Invoice Desk import
 * this module so every supplier payment, whichever screen it starts from, becomes one
 * SupplierPayment row.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, CashBookModule, GeneratedDocumentsModule],
  controllers: [SupplierPaymentsController],
  providers: [SupplierPaymentsService, CompanyScopeService],
  exports: [SupplierPaymentsService],
})
export class SupplierPaymentsModule {}
