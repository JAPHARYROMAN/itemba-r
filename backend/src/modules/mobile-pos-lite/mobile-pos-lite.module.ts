import { CustomerPaymentsModule } from '../customer-payments/customer-payments.module';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { RefundsModule } from '../refunds/refunds.module';
import { PosTransactionsService } from './pos-transactions.service';
import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { GoodsReceivedNotesModule } from '../goods-received-notes/goods-received-notes.module';
import { StockAdjustmentsModule } from '../stock-adjustments/stock-adjustments.module';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';
import { DeliveryNotesModule } from '../delivery-notes/delivery-notes.module';
import { CompanyScopeService, OrganizationScopeService } from '../../common/services';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { MobilePosLiteService } from './mobile-pos-lite.service';

@Module({
  imports: [
    CustomerPaymentsModule,
    CreditNotesModule,
    RefundsModule,
    AuditLogsModule,
    SalesOrdersModule,
    PurchaseOrdersModule,
    GoodsReceivedNotesModule,
    // Core create -> submit -> approve -> post chain behind Hesabu stock counts.
    StockAdjustmentsModule,
    // Letterhead PDF engine for RISITI receipts (renderLetterheadPdf).
    GeneratedDocumentsModule,
    // The create -> dispatch -> deliver document chain behind the counter-sale
    // delivery note. No cycle: DeliveryNotesModule imports only PrismaModule and
    // AuditLogsModule.
    DeliveryNotesModule,
  ],
  controllers: [MobilePosLiteController],
  providers: [
    MobilePosLiteService,
    PosTransactionsService,
    CompanyScopeService,
    OrganizationScopeService,
  ],
  exports: [MobilePosLiteService],
})
export class MobilePosLiteModule {}
