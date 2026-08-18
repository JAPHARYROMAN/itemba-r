import { Module } from '@nestjs/common';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';
import { RecordBookController } from './record-book.controller';
import { RecordBookService } from './record-book.service';
import { RecordBookReportsService } from './record-book-reports.service';

@Module({
  imports: [AuditLogsModule, GeneratedDocumentsModule],
  controllers: [RecordBookController],
  providers: [
    RecordBookService,
    RecordBookReportsService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
  exports: [RecordBookService, RecordBookReportsService],
})
export class RecordBookModule {}
