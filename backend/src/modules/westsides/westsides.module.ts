import { Module } from '@nestjs/common';
import { SalesChannelsModule } from '../sales-channels/sales-channels.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { CustomerPriceAgreementsModule } from '../customer-price-agreements/customer-price-agreements.module';
import { ProductBatchesModule } from '../product-batches/product-batches.module';
import { StockDamageModule } from '../stock-damage/stock-damage.module';
import { ReturnablePackagesModule } from '../returnable-packages/returnable-packages.module';
import { PackageMovementsModule } from '../package-movements/package-movements.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { ProformaInvoicesModule } from '../proforma-invoices/proforma-invoices.module';
import { DeliveryNotesModule } from '../delivery-notes/delivery-notes.module';
import { WestsidesReportsModule } from '../westsides-reports/westsides-reports.module';
import { WestsidesDashboardModule } from '../westsides-dashboard/westsides-dashboard.module';

@Module({
  imports: [
    SalesChannelsModule,
    PriceListsModule,
    CustomerPriceAgreementsModule,
    ProductBatchesModule,
    StockDamageModule,
    ReturnablePackagesModule,
    PackageMovementsModule,
    QuotationsModule,
    ProformaInvoicesModule,
    DeliveryNotesModule,
    WestsidesReportsModule,
    WestsidesDashboardModule,
  ],
})
export class WestsidesModule {}