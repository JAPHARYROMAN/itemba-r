import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DashboardController],
  providers: [DashboardService, CompanyScopeService],
})
export class DashboardModule {}
