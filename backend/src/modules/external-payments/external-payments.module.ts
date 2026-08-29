import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { ExternalPaymentsController } from './external-payments.controller';
import { ExternalPaymentsService } from './external-payments.service';

/**
 * PostingEngineService and AccountResolverService are provided by the @Global
 * AccountingEngineModule, so the service injects them directly with no explicit
 * import here (matches peers like customer-payments / receivables). They power
 * the finance bridge on confirm/reverse: DR Cash|Bank / CR AR + subledger +
 * CashAccount, all in one $transaction.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ExternalPaymentsController],
  providers: [ExternalPaymentsService, CompanyScopeService],
  exports: [ExternalPaymentsService],
})
export class ExternalPaymentsModule {}
