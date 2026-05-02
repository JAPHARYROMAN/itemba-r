import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LogisticsDashboardService } from './logistics-dashboard.service';
import { LogisticsDashboardController } from './logistics-dashboard.controller';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  providers: [LogisticsDashboardService, CompanyScopeService],
  controllers: [LogisticsDashboardController],
})
export class LogisticsDashboardModule {}
