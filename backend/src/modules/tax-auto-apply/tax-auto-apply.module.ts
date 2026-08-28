import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { TaxAutoApplyService } from './tax-auto-apply.service';
import { TaxAutoApplyController } from './tax-auto-apply.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [TaxAutoApplyService, CompanyScopeService],
  controllers: [TaxAutoApplyController],
  exports: [TaxAutoApplyService],
})
export class TaxAutoApplyModule {}
