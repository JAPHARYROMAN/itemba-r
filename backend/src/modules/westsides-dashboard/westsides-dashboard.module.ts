import { Module } from '@nestjs/common';
import { WestsidesDashboardService } from './westsides-dashboard.service';
import { WestsidesDashboardController } from './westsides-dashboard.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';

@Module({
  imports: [PrismaModule],
  controllers: [WestsidesDashboardController],
  providers: [WestsidesDashboardService, CompanyScopeService],
  exports: [WestsidesDashboardService],
})
export class WestsidesDashboardModule {}
