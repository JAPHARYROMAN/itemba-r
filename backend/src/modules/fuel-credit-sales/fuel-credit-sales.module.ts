import { Module } from '@nestjs/common';
import { FuelCreditSalesService } from './fuel-credit-sales.service';
import { FuelCreditSalesController } from './fuel-credit-sales.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelCreditSalesController],
  providers: [FuelCreditSalesService],
  exports: [FuelCreditSalesService],
})
export class FuelCreditSalesModule {}
