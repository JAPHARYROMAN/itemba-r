import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ObservabilityBudgetService } from '../../common/services';
import { PerformanceDashboardController } from './performance.controller';
import { PerformanceDashboardService } from './performance.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PerformanceDashboardController],
  providers: [PerformanceDashboardService, ObservabilityBudgetService],
  exports: [PerformanceDashboardService],
})
export class PerformanceDashboardModule {}
