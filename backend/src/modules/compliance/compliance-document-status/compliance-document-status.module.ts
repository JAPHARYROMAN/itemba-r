import { Module } from '@nestjs/common';
import { ComplianceDocumentStatusController } from './compliance-document-status.controller';
import { ComplianceDocumentStatusService } from './compliance-document-status.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceDocumentStatusController],
  providers: [ComplianceDocumentStatusService],
  exports: [ComplianceDocumentStatusService],
})
export class ComplianceDocumentStatusModule {}
