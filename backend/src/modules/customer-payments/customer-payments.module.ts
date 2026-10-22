import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CashBookModule } from '../cash-book/cash-book.module';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';
import { CompanyScopeService } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';

/**
 * PostingEngineService, AccountResolverService (AccountingEngineModule) and
 * EntityCodeGeneratorService are provided by @Global modules, so they only need
 * to be injected — no explicit import here (matches peers like receivables /
 * refunds).
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, CashBookModule],
  controllers: [CustomerPaymentsController],
  providers: [CustomerPaymentsService, CompanyScopeService, OrganizationScopeService],
  exports: [CustomerPaymentsService],
})
export class CustomerPaymentsModule {}
