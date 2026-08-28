import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { TaxFilingEngineService } from './tax-filing-engine.service';
import { TaxFilingEngineController } from './tax-filing-engine.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [TaxFilingEngineService, CompanyScopeService],
  controllers: [TaxFilingEngineController],
  exports: [TaxFilingEngineService],
})
export class TaxFilingEngineModule {}
