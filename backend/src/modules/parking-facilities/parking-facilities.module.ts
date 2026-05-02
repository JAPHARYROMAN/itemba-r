import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ParkingFacilitiesService } from './parking-facilities.service';
import { ParkingFacilitiesController } from './parking-facilities.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ParkingFacilitiesService],
  controllers: [ParkingFacilitiesController],
  exports: [ParkingFacilitiesService],
})
export class ParkingFacilitiesModule {}
