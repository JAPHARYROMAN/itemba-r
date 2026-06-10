import { Module } from '@nestjs/common';
import { FuelCreditSalesService } from './fuel-credit-sales.service';
import { FuelCreditSalesController } from './fuel-credit-sales.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FuelCreditSalesController],
  providers: [FuelCreditSalesService, CompanyScopeService],
  exports: [FuelCreditSalesService],
})
export class FuelCreditSalesModule {}
