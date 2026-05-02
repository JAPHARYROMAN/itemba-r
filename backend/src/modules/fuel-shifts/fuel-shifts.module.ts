import { Module } from '@nestjs/common';
import { FuelShiftsService } from './fuel-shifts.service';
import { FuelShiftsController } from './fuel-shifts.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';
import { CompanyScopeService, PetroleumShiftControlService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [FuelShiftsController],
  providers: [FuelShiftsService, PetroleumShiftControlService, CompanyScopeService],
  exports: [FuelShiftsService],
})
export class FuelShiftsModule {}
