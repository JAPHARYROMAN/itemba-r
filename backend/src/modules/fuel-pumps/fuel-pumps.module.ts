import { Module } from '@nestjs/common';
import { FuelPumpsService } from './fuel-pumps.service';
import { FuelPumpsController } from './fuel-pumps.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelPumpsController],
  providers: [FuelPumpsService],
  exports: [FuelPumpsService],
})
export class FuelPumpsModule {}
