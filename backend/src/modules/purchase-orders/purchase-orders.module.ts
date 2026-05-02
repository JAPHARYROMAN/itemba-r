import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { TaxAutoApplyModule } from '../tax-auto-apply/tax-auto-apply.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule, TaxAutoApplyModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, CompanyScopeService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
