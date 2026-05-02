import { Module } from '@nestjs/common';
import { FuelTankDipsService } from './fuel-tank-dips.service';
import { FuelTankDipsController } from './fuel-tank-dips.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [FuelTankDipsController],
  providers: [FuelTankDipsService],
  exports: [FuelTankDipsService],
})
export class FuelTankDipsModule {}
