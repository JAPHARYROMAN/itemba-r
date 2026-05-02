import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SavedReportViewsController } from './saved-report-views.controller';
import { SavedReportViewsService } from './saved-report-views.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SavedReportViewsController],
  providers: [SavedReportViewsService, CompanyScopeService],
  exports: [SavedReportViewsService],
})
export class SavedReportViewsModule {}
