import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { KpiSnapshotsController } from './kpi-snapshots.controller';
import { KpiSnapshotsService } from './kpi-snapshots.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [KpiSnapshotsController],
  providers: [KpiSnapshotsService, CompanyScopeService],
  exports: [KpiSnapshotsService],
})
export class KpiSnapshotsModule {}
