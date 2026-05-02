import { Module } from '@nestjs/common';
import { FiscalYearsService } from './fiscal-years.service';
import { FiscalYearsController } from './fiscal-years.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FiscalYearsController],
  providers: [FiscalYearsService, CompanyScopeService],
  exports: [FiscalYearsService],
})
export class FiscalYearsModule {}
