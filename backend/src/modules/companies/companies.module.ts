import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyScopeService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
