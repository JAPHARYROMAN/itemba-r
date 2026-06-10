import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { RentInvoicesService } from './rent-invoices.service';
import { RentInvoicesController } from './rent-invoices.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentInvoicesService, CompanyScopeService],
  controllers: [RentInvoicesController],
  exports: [RentInvoicesService],
})
export class RentInvoicesModule {}
