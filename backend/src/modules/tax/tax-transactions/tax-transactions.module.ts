import { Module } from '@nestjs/common';
import { TaxTransactionsController } from './tax-transactions.controller';
import { TaxTransactionsService } from './tax-transactions.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { AccountResolverService } from '../../../common/services/account-resolver.service';

// PostingEngineService is provided by the @Global AccountingEngineModule.
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxTransactionsController],
  providers: [TaxTransactionsService, AccountResolverService],
  exports: [TaxTransactionsService],
})
export class TaxTransactionsModule {}
