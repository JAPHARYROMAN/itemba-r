import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';
import { CompanyScopeService } from '../../common/services';

/**
 * PostingEngineService, AccountResolverService (AccountingEngineModule) and
 * EntityCodeGeneratorService are provided by @Global modules, so they only need
 * to be injected — no explicit import here (matches peers like receivables /
 * refunds).
 */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CustomerPaymentsController],
  providers: [CustomerPaymentsService, CompanyScopeService],
  exports: [CustomerPaymentsService],
})
export class CustomerPaymentsModule {}
