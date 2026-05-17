import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountingEngineController } from './accounting-engine.controller';
import { AccountingEngineService } from './accounting-engine.service';
import { PostingEngineService } from './posting-engine.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';

/**
 * Global so any domain module can inject {@link PostingEngineService} without
 * having to re-import this module.
 */
@Global()
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AccountingEngineController],
  providers: [
    AccountingEngineService,
    PostingEngineService,
    AccountingControlService,
    AccountResolverService,
  ],
  exports: [AccountingEngineService, PostingEngineService, AccountResolverService],
})
export class AccountingEngineModule {}
