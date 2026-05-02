import { Module } from '@nestjs/common';
import { ComplianceDashboardController } from './compliance-dashboard.controller';
import { ComplianceDashboardService } from './compliance-dashboard.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceDashboardController],
  providers: [ComplianceDashboardService, CompanyScopeService],
  exports: [ComplianceDashboardService],
})
export class ComplianceDashboardModule {}
