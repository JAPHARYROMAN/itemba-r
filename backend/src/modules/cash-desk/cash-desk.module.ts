import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InvoiceDeskModule } from '../invoice-desk/invoice-desk.module';
import { CashDeskController } from './cash-desk.controller';
import { CashDeskService } from './cash-desk.service';
import { DeskReportsModule } from '../desk-reports/desk-reports.module';
import { LoanLifecycleModule } from '../loans/loan-lifecycle.module';
import { CashSalesConnectionService } from './cash-sales-connection.service';
import { PartyExistsService } from '../../common/services/party-exists.service';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { CashPurchasesService } from './cash-purchases.service';
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    InvoiceDeskModule,
    DeskReportsModule,
    LoanLifecycleModule,
    SupplierPaymentsModule,
  ],
  controllers: [CashDeskController],
  exports: [CashDeskService],
  providers: [
    CashDeskService,
    CashPurchasesService,
    CashSalesConnectionService,
    CompanyScopeService,
    OrganizationScopeService,
    PartyExistsService,
  ],
})
export class CashDeskModule {}
