import { Module } from '@nestjs/common';
import { FuelDeliveriesService } from './fuel-deliveries.service';
import { FuelDeliveriesController } from './fuel-deliveries.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [FuelDeliveriesController],
  providers: [FuelDeliveriesService],
  exports: [FuelDeliveriesService],
})
export class FuelDeliveriesModule {}
