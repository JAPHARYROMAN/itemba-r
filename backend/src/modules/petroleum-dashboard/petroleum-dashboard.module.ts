import { Module } from '@nestjs/common';
import { PetroleumDashboardService } from './petroleum-dashboard.service';
import { PetroleumDashboardController } from './petroleum-dashboard.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  controllers: [PetroleumDashboardController],
  providers: [PetroleumDashboardService, CompanyScopeService],
})
export class PetroleumDashboardModule {}
