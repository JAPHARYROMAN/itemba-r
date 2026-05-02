import { Module } from '@nestjs/common';
import { ReportsCatalogService } from './reports-catalog.service';
import { ReportsCatalogController } from './reports-catalog.controller';

@Module({
  providers: [ReportsCatalogService],
  controllers: [ReportsCatalogController],
  exports: [ReportsCatalogService],
})
export class ReportsCatalogModule {}
