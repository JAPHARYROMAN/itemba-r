import { Module } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrdersController } from './sales-orders.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { TaxAutoApplyModule } from '../tax-auto-apply/tax-auto-apply.module';
import { ProfitModule } from '../profit/profit.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    InventoryMovementsModule,
    TaxAutoApplyModule,
    ProfitModule,
  ],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService, CompanyScopeService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
