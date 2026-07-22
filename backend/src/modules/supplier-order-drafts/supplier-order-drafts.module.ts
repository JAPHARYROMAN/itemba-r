import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';
import { EmailService } from '../../common/services/email.service';
import { SupplierOrderDraftsController } from './supplier-order-drafts.controller';
import { SupplierOrderDraftSharingService } from './supplier-order-draft-sharing.service';
import { SupplierOrderDraftsService } from './supplier-order-drafts.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, DocumentsModule, GeneratedDocumentsModule],
  controllers: [SupplierOrderDraftsController],
  providers: [SupplierOrderDraftsService, SupplierOrderDraftSharingService, CompanyScopeService, EmailService],
  exports: [SupplierOrderDraftsService],
})
export class SupplierOrderDraftsModule {}
