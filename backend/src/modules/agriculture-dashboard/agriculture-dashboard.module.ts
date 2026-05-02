import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AgricultureDashboardService } from './agriculture-dashboard.service';
import { AgricultureDashboardController } from './agriculture-dashboard.controller';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  providers: [AgricultureDashboardService, CompanyScopeService],
  controllers: [AgricultureDashboardController],
})
export class AgricultureDashboardModule {}
