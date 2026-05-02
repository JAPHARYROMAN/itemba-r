import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService, ObservabilityBudgetService } from '../../common/services';
import { BackgroundJobsController } from './background-jobs.controller';
import { BackgroundJobsService } from './background-jobs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BackgroundJobsController],
  providers: [BackgroundJobsService, ObservabilityBudgetService, CompanyScopeService],
  exports: [BackgroundJobsService],
})
export class BackgroundJobsModule {}
