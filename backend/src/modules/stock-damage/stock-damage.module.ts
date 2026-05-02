import { Module } from '@nestjs/common';
import { StockDamageService } from './stock-damage.service';
import { StockDamageController } from './stock-damage.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [StockDamageController],
  providers: [StockDamageService],
  exports: [StockDamageService],
})
export class StockDamageModule {}
