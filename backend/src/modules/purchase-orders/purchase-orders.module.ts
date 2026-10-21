import { SupplierPaymentsModule } from '../supplier-payments/supplier-payments.module';
import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { TaxAutoApplyModule } from '../tax-auto-apply/tax-auto-apply.module';
import { ProfitModule } from '../profit/profit.module';
import { CompanyScopeService } from '../../common/services';
import { ReceiptPayablesModule } from '../receipt-payables/receipt-payables.module';

@Module({
  imports: [
    SupplierPaymentsModule,
    PrismaModule,
    AuditLogsModule,
    InventoryMovementsModule,
    TaxAutoApplyModule,
    ProfitModule,
    ReceiptPayablesModule,
  ],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, CompanyScopeService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
