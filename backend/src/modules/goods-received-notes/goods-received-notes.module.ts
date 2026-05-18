import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GoodsReceivedNotesController } from './goods-received-notes.controller';
import { GoodsReceivedNotesService } from './goods-received-notes.service';
import { CompanyScopeService } from '../../common/services';
import { InventoryMovementsModule } from '../inventory-movements/inventory-movements.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, InventoryMovementsModule],
  controllers: [GoodsReceivedNotesController],
  providers: [GoodsReceivedNotesService, CompanyScopeService],
  exports: [GoodsReceivedNotesService],
})
export class GoodsReceivedNotesModule {}
