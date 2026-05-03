import { Module } from '@nestjs/common';
import { InventoryBalancesService } from './inventory-balances.service';
import { InventoryBalancesController } from './inventory-balances.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [InventoryBalancesController],
  providers: [InventoryBalancesService, CompanyScopeService],
  exports: [InventoryBalancesService],
})
export class InventoryBalancesModule {}
