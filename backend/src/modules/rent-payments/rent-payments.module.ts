import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RentPaymentsService } from './rent-payments.service';
import { RentPaymentsController } from './rent-payments.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentPaymentsService],
  controllers: [RentPaymentsController],
  exports: [RentPaymentsService],
})
export class RentPaymentsModule {}
