import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentsModule } from '../documents/documents.module';
import { GeneratedDocumentsController } from './generated-documents.controller';
import { GeneratedDocumentsService } from './generated-documents.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, DocumentsModule],
  controllers: [GeneratedDocumentsController],
  providers: [GeneratedDocumentsService, CompanyScopeService],
  exports: [GeneratedDocumentsService],
})
export class GeneratedDocumentsModule {}
