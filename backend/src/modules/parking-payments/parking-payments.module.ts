import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ParkingPaymentsService } from './parking-payments.service';
import { ParkingPaymentsController } from './parking-payments.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ParkingPaymentsService, CompanyScopeService],
  controllers: [ParkingPaymentsController],
  exports: [ParkingPaymentsService],
})
export class ParkingPaymentsModule {}
