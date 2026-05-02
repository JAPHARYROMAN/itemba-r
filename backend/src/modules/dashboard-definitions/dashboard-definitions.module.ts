import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DashboardDefinitionsController } from './dashboard-definitions.controller';
import { DashboardDefinitionsService } from './dashboard-definitions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DashboardDefinitionsController],
  providers: [DashboardDefinitionsService],
  exports: [DashboardDefinitionsService],
})
export class DashboardDefinitionsModule {}
