import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { CashBookController } from './cash-book.controller';
import { CashBookService } from './cash-book.service';

/**
 * The cash book depends only on Prisma, audit and company scope, so the payment modules
 * (supplier payments, customer payments, expenses, refunds, payables, receivables) can
 * import it without a cycle back into Cash Desk or Invoice Desk. ConfigModule is imported
 * explicitly (not only relied on as global) so proof scripts that assemble a smaller
 * testing module, such as the PetroDollar posting proof, can resolve ConfigService too.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, ConfigModule],
  controllers: [CashBookController],
  providers: [CashBookService, CompanyScopeService],
  exports: [CashBookService],
})
export class CashBookModule {}
