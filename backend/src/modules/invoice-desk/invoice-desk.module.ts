import { DeskTransactionLinksService } from '../../common/services/desk-transaction-links.service';
import { DeskPartyLinksService } from '../../common/services/desk-party-links.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { InvoiceDeskController } from './invoice-desk.controller';
import { InvoiceDeskService } from './invoice-desk.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, SupplierPaymentsModule],
  exports: [InvoiceDeskService],
  controllers: [InvoiceDeskController],
  providers: [
    DeskTransactionLinksService,
    DeskPartyLinksService,
    InvoiceDeskService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
})
export class InvoiceDeskModule {}
