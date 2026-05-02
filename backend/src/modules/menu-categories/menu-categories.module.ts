import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MenuCategoriesService } from './menu-categories.service';
import { MenuCategoriesController } from './menu-categories.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [MenuCategoriesService],
  controllers: [MenuCategoriesController],
  exports: [MenuCategoriesService],
})
export class MenuCategoriesModule {}
