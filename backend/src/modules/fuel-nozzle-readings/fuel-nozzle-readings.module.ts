import { Module } from '@nestjs/common';
import { FuelNozzleReadingsService } from './fuel-nozzle-readings.service';
import { FuelNozzleReadingsController } from './fuel-nozzle-readings.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelNozzleReadingsController],
  providers: [FuelNozzleReadingsService],
  exports: [FuelNozzleReadingsService],
})
export class FuelNozzleReadingsModule {}
