import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FoliosModule } from '../folios/folios.module';
import { RoomBookingsService } from './room-bookings.service';
import { RoomBookingsController } from './room-bookings.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, FoliosModule],
  providers: [RoomBookingsService],
  controllers: [RoomBookingsController],
  exports: [RoomBookingsService],
})
export class RoomBookingsModule {}
