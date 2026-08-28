import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { DivisionsController } from './divisions.controller';
import { DivisionsService } from './divisions.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [DivisionsController],
  providers: [DivisionsService, CompanyScopeService],
  exports: [DivisionsService],
})
export class DivisionsModule {}
