import { Module } from '@nestjs/common';
import { OperationsReportsService } from './operations-reports.service';
import { OperationsReportsController } from './operations-reports.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Supplier360ReportService } from './supplier-360-report.service';

@Module({
  imports: [PrismaModule, GeneratedDocumentsModule, AuditLogsModule],
  controllers: [OperationsReportsController],
  providers: [OperationsReportsService, Supplier360ReportService, CompanyScopeService],
  exports: [OperationsReportsService, Supplier360ReportService],
})
export class OperationsReportsModule {}
