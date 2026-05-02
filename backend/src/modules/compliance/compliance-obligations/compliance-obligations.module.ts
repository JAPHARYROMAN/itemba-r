import { Module } from '@nestjs/common';
import { ComplianceObligationsController } from './compliance-obligations.controller';
import { ComplianceObligationsService } from './compliance-obligations.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceObligationsController],
  providers: [ComplianceObligationsService],
  exports: [ComplianceObligationsService],
})
export class ComplianceObligationsModule {}
