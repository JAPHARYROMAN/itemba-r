import { Module } from '@nestjs/common';
import { ComplianceReportsController } from './compliance-reports.controller';
import { ComplianceReportsService } from './compliance-reports.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceReportsController],
  providers: [ComplianceReportsService],
  exports: [ComplianceReportsService],
})
export class ComplianceReportsModule {}
