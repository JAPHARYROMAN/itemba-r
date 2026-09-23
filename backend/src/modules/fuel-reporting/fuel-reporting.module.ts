import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FuelReportingController } from './fuel-reporting.controller';
import { FuelReportingService } from './fuel-reporting.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [FuelReportingController],
  providers: [FuelReportingService, CompanyScopeService],
})
export class FuelReportingModule {}
