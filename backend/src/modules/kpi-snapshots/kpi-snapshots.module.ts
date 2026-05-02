import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { KpiSnapshotsController } from './kpi-snapshots.controller';
import { KpiSnapshotsService } from './kpi-snapshots.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [KpiSnapshotsController],
  providers: [KpiSnapshotsService],
  exports: [KpiSnapshotsService],
})
export class KpiSnapshotsModule {}
