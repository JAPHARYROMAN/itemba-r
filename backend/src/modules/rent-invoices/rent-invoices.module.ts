import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RentInvoicesService } from './rent-invoices.service';
import { RentInvoicesController } from './rent-invoices.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentInvoicesService],
  controllers: [RentInvoicesController],
  exports: [RentInvoicesService],
})
export class RentInvoicesModule {}
