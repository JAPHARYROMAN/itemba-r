import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TripFuelUsageService } from './trip-fuel-usage.service';
import { TripFuelUsageController } from './trip-fuel-usage.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [TripFuelUsageService],
  controllers: [TripFuelUsageController],
  exports: [TripFuelUsageService],
})
export class TripFuelUsageModule {}
