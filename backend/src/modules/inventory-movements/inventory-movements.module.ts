import { Module } from '@nestjs/common';
import { InventoryMovementsService } from './inventory-movements.service';
import { InventoryMovementsController } from './inventory-movements.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProfitModule } from '../profit/profit.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, ProfitModule],
  controllers: [InventoryMovementsController],
  providers: [InventoryMovementsService, CompanyScopeService],
  exports: [InventoryMovementsService],
})
export class InventoryMovementsModule {}
