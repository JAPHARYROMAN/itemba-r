import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ParkingZonesService } from './parking-zones.service';
import { ParkingZonesController } from './parking-zones.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ParkingZonesService],
  controllers: [ParkingZonesController],
  exports: [ParkingZonesService],
})
export class ParkingZonesModule {}
