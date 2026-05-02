import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DepreciationController } from './depreciation.controller';
import { DepreciationService } from './depreciation.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DepreciationController],
  providers: [DepreciationService, AccountingControlService, AccountResolverService],
  exports: [DepreciationService],
})
export class DepreciationModule {}