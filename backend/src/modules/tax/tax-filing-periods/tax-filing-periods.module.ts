import { Module } from '@nestjs/common';
import { TaxFilingPeriodsController } from './tax-filing-periods.controller';
import { TaxFilingPeriodsService } from './tax-filing-periods.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxFilingPeriodsController],
  providers: [TaxFilingPeriodsService],
  exports: [TaxFilingPeriodsService],
})
export class TaxFilingPeriodsModule {}
