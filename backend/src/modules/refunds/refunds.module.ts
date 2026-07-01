import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { CompanyScopeService } from '../../common/services';

/**
 * PostingEngineService, AccountResolverService (AccountingEngineModule) and
 * EntityCodeGeneratorService are provided by @Global modules, so they only need
 * to be injected — no explicit import here (matches peers like receivables).
 */
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RefundsController],
  providers: [RefundsService, CompanyScopeService],
  exports: [RefundsService],
})
export class RefundsModule {}
