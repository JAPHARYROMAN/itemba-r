import { Module } from '@nestjs/common';
import { FuelTanksService } from './fuel-tanks.service';
import { FuelTanksController } from './fuel-tanks.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelTanksController],
  providers: [FuelTanksService],
  exports: [FuelTanksService],
})
export class FuelTanksModule {}
