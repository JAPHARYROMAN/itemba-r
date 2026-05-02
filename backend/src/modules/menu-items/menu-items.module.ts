import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MenuItemsService } from './menu-items.service';
import { MenuItemsController } from './menu-items.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [MenuItemsService],
  controllers: [MenuItemsController],
  exports: [MenuItemsService],
})
export class MenuItemsModule {}
