import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GoodsReceivedNotesController } from './goods-received-notes.controller';
import { GoodsReceivedNotesService } from './goods-received-notes.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [GoodsReceivedNotesController],
  providers: [GoodsReceivedNotesService, CompanyScopeService],
  exports: [GoodsReceivedNotesService],
})
export class GoodsReceivedNotesModule {}