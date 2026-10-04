import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import {
  AccountingControlService,
  CompanyScopeService,
  OrganizationScopeService,
} from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { CustomerPaymentsModule } from '../customer-payments/customer-payments.module';
import { StockAdjustmentsModule } from '../stock-adjustments/stock-adjustments.module';
import { StockDamageModule } from '../stock-damage/stock-damage.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { MobilePosLiteModule } from '../mobile-pos-lite/mobile-pos-lite.module';
import { PosDraftsController } from './pos-drafts.controller';
import { PosDraftsService } from './pos-drafts.service';
import { PosDraftReservationExpiryService } from './pos-draft-reservation-expiry.service';
@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    SalesOrdersModule,
    PurchaseOrdersModule,
    CustomerPaymentsModule,
    StockAdjustmentsModule,
    StockDamageModule,
    InventoryMovementsModule,
    MobilePosLiteModule,
  ],
  controllers: [PosDraftsController],
  providers: [
    PosDraftsService,
    PosDraftReservationExpiryService,
    AccountingControlService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
  exports: [PosDraftsService],
})
export class PosDraftsModule {}
