import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { ScheduledReportsController } from './scheduled-reports.controller';
import { ScheduledReportsService } from './scheduled-reports.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ScheduledReportsController],
  providers: [ScheduledReportsService, CompanyScopeService],
  exports: [ScheduledReportsService],
})
export class ScheduledReportsModule {}
