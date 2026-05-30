import { Module } from '@nestjs/common';
import { ReportsCatalogService } from './reports-catalog.service';
import { ReportsCatalogController } from './reports-catalog.controller';
import { ReportsEnterpriseController } from './reports-enterprise.controller';

@Module({
  providers: [ReportsCatalogService],
  controllers: [ReportsCatalogController, ReportsEnterpriseController],
  exports: [ReportsCatalogService],
})
export class ReportsCatalogModule {}
