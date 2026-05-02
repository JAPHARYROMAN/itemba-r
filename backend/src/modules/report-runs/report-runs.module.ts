import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ReportRunsController } from './report-runs.controller';
import { ReportRunsService } from './report-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ReportRunsController],
  providers: [ReportRunsService, CompanyScopeService],
  exports: [ReportRunsService],
})
export class ReportRunsModule {}
