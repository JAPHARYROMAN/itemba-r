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
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    InvoiceDeskModule,
    DeskReportsModule,
    LoanLifecycleModule,
  ],
  controllers: [CashDeskController],
  exports: [CashDeskService],
  providers: [CashDeskService, CompanyScopeService, OrganizationScopeService],
})
export class CashDeskModule {}
