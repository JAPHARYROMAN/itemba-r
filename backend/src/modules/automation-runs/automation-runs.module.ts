import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AutomationRunsController } from './automation-runs.controller';
import { AutomationRunsService } from './automation-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AutomationRunsController],
  providers: [AutomationRunsService],
  exports: [AutomationRunsService],
})
export class AutomationRunsModule {}