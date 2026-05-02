import { Module } from '@nestjs/common';
import { FuelPricesService } from './fuel-prices.service';
import { FuelPricesController } from './fuel-prices.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelPricesController],
  providers: [FuelPricesService],
  exports: [FuelPricesService],
})
export class FuelPricesModule {}
