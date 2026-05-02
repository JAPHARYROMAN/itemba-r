import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ParkingRatesService } from './parking-rates.service';
import { ParkingRatesController } from './parking-rates.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ParkingRatesService],
  controllers: [ParkingRatesController],
  exports: [ParkingRatesService],
})
export class ParkingRatesModule {}
