import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ItembaDashboardService } from './itemba-dashboard.service';
import { ItembaDashboardController } from './itemba-dashboard.controller';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  providers: [ItembaDashboardService, CompanyScopeService],
  controllers: [ItembaDashboardController],
})
export class ItembaDashboardModule {}
