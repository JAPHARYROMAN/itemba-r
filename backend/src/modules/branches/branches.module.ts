import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/services';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [BranchesController],
  providers: [BranchesService, CompanyScopeService],
  exports: [BranchesService],
})
export class BranchesModule {}
