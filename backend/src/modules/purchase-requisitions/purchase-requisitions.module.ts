import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PurchaseRequisitionsController],
  providers: [PurchaseRequisitionsService, CompanyScopeService],
  exports: [PurchaseRequisitionsService],
})
export class PurchaseRequisitionsModule {}