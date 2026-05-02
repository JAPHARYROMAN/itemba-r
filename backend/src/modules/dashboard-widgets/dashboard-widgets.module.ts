import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DashboardWidgetsController } from './dashboard-widgets.controller';
import { DashboardWidgetsService } from './dashboard-widgets.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DashboardWidgetsController],
  providers: [DashboardWidgetsService],
  exports: [DashboardWidgetsService],
})
export class DashboardWidgetsModule {}
