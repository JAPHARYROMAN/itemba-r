import { Module } from '@nestjs/common';
import { StockDamageService } from './stock-damage.service';
import { StockDamageController } from './stock-damage.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [StockDamageController],
  providers: [StockDamageService, CompanyScopeService],
  exports: [StockDamageService],
})
export class StockDamageModule {}
