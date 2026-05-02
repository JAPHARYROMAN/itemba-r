import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PropertyMaintenanceService } from './property-maintenance.service';
import { PropertyMaintenanceController } from './property-maintenance.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [PropertyMaintenanceService],
  controllers: [PropertyMaintenanceController],
  exports: [PropertyMaintenanceService],
})
export class PropertyMaintenanceModule {}
