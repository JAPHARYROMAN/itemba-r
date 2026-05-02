import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { VehicleMaintenanceController } from './vehicle-maintenance.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [VehicleMaintenanceService],
  controllers: [VehicleMaintenanceController],
  exports: [VehicleMaintenanceService],
})
export class VehicleMaintenanceModule {}
