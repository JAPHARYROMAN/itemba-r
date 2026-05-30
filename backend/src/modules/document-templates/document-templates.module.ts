import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService, CompanyScopeService],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
