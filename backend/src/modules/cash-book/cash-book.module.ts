import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { CashBookController } from './cash-book.controller';
import { CashBookService } from './cash-book.service';

/**
 * The cash book depends only on Prisma, audit and company scope, so the payment modules
 * (supplier payments, customer payments, expenses, refunds, payables, receivables) can
 * import it without a cycle back into Cash Desk or Invoice Desk. ConfigModule is global.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CashBookController],
  providers: [CashBookService, CompanyScopeService],
  exports: [CashBookService],
})
export class CashBookModule {}
