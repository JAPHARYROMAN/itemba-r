import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ReportDefinitionsController } from './report-definitions.controller';
import { ReportDefinitionsService } from './report-definitions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ReportDefinitionsController],
  providers: [ReportDefinitionsService],
  exports: [ReportDefinitionsService],
})
export class ReportDefinitionsModule {}
