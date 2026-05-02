import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BOQItemsService } from './boq-items.service';
import { BOQItemsController } from './boq-items.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [BOQItemsService],
  controllers: [BOQItemsController],
  exports: [BOQItemsService],
})
export class BOQItemsModule {}
