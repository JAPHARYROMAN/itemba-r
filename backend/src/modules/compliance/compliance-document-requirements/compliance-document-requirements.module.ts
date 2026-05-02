import { Module } from '@nestjs/common';
import { ComplianceDocumentRequirementsController } from './compliance-document-requirements.controller';
import { ComplianceDocumentRequirementsService } from './compliance-document-requirements.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ComplianceDocumentRequirementsController],
  providers: [ComplianceDocumentRequirementsService],
  exports: [ComplianceDocumentRequirementsService],
})
export class ComplianceDocumentRequirementsModule {}
