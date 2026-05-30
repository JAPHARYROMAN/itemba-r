import { Module } from '@nestjs/common';
import { ReportsCatalogService } from './reports-catalog.service';
import { ReportsCatalogController } from './reports-catalog.controller';
import { ReportsEnterpriseController } from './reports-enterprise.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ReportsCatalogService, CompanyScopeService],
  controllers: [ReportsCatalogController, ReportsEnterpriseController],
  exports: [ReportsCatalogService],
})
export class ReportsCatalogModule {}
