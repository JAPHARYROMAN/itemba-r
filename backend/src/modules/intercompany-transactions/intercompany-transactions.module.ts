import { Module } from '@nestjs/common';
import { IntercompanyTransactionsService } from './intercompany-transactions.service';
import { IntercompanyTransactionsController } from './intercompany-transactions.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { CompanyScopeService } from '../../common/services';
import { EntityCodeGeneratorModule } from '../entity-code-generator/entity-code-generator.module';
import { AccountingEngineModule } from '../accounting-engine/accounting-engine.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    EntityCodeGeneratorModule,
    AccountingEngineModule,
  ],
  controllers: [IntercompanyTransactionsController],
  providers: [
    IntercompanyTransactionsService,
    AccountingControlService,
    AccountResolverService,
    CompanyScopeService,
  ],
  exports: [IntercompanyTransactionsService],
})
export class IntercompanyTransactionsModule {}
