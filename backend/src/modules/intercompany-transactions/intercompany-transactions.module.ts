import { Module } from '@nestjs/common';
import { IntercompanyTransactionsService } from './intercompany-transactions.service';
import { IntercompanyTransactionsController } from './intercompany-transactions.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [IntercompanyTransactionsController],
  providers: [
    IntercompanyTransactionsService,
    AccountingControlService,
    AccountResolverService,
  ],
  exports: [IntercompanyTransactionsService],
})
export class IntercompanyTransactionsModule {}
