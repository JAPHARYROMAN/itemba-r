import { Module } from '@nestjs/common';
import { HrDashboardController } from './hr-dashboard.controller';
import { HrDashboardService } from './hr-dashboard.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [HrDashboardController],
  providers: [HrDashboardService, CompanyScopeService],
})
export class HrDashboardModule {}
