import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CashBookModule } from '../cash-book/cash-book.module';
import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { DocumentPaymentsController } from './document-payments.controller';
import { DocumentPaymentsService } from './document-payments.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, CashBookModule, SupplierPaymentsModule],
  controllers: [DocumentPaymentsController],
  providers: [DocumentPaymentsService, CompanyScopeService, OrganizationScopeService],
})
export class DocumentPaymentsModule {}
