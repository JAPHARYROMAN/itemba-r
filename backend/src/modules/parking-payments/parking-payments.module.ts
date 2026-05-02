import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ParkingPaymentsService } from './parking-payments.service';
import { ParkingPaymentsController } from './parking-payments.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ParkingPaymentsService],
  controllers: [ParkingPaymentsController],
  exports: [ParkingPaymentsService],
})
export class ParkingPaymentsModule {}
