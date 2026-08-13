import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { GoodsReceivedNotesModule } from '../goods-received-notes/goods-received-notes.module';
import { StockAdjustmentsModule } from '../stock-adjustments/stock-adjustments.module';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';
import { CompanyScopeService } from '../../common/services';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { MobilePosLiteService } from './mobile-pos-lite.service';

@Module({
  imports: [
    AuditLogsModule,
    SalesOrdersModule,
    PurchaseOrdersModule,
    GoodsReceivedNotesModule,
    // Core create -> submit -> approve -> post chain behind Hesabu stock counts.
    StockAdjustmentsModule,
    // Letterhead PDF engine for RISITI receipts (renderLetterheadPdf).
    GeneratedDocumentsModule,
  ],
  controllers: [MobilePosLiteController],
  providers: [MobilePosLiteService, CompanyScopeService],
  exports: [MobilePosLiteService],
})
export class MobilePosLiteModule {}
