import { Module } from '@nestjs/common';
import { FuelTankDipsService } from './fuel-tank-dips.service';
import { FuelTankDipsController } from './fuel-tank-dips.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [FuelTankDipsController],
  providers: [FuelTankDipsService, CompanyScopeService],
  exports: [FuelTankDipsService],
})
export class FuelTankDipsModule {}
