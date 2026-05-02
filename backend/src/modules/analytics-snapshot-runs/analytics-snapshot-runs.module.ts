import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AnalyticsSnapshotRunsController } from './analytics-snapshot-runs.controller';
import { AnalyticsSnapshotRunsService } from './analytics-snapshot-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AnalyticsSnapshotRunsController],
  providers: [AnalyticsSnapshotRunsService],
  exports: [AnalyticsSnapshotRunsService],
})
export class AnalyticsSnapshotRunsModule {}
