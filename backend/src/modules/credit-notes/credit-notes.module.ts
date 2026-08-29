import { Module } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotesController } from './credit-notes.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { ProfitModule } from '../profit/profit.module';
import { CompanyScopeService } from '../../common/services';

/**
 * PostingEngineService + AccountResolverService are provided by the @Global
 * AccountingEngineModule; EntityCodeGeneratorService by the @Global
 * EntityCodeGeneratorModule — so they need not be imported here (same as the
 * receivables module).
 *
 * InventoryMovementsModule + ProfitModule are imported so issue()/void() can
 * restock physically-returned goods (SALES_RETURN movement + Dr Inventory / Cr
 * COGS) and resolve the original per-unit cost, mirroring sales-orders.cancel.
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule, ProfitModule],
  controllers: [CreditNotesController],
  providers: [CreditNotesService, CompanyScopeService],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
