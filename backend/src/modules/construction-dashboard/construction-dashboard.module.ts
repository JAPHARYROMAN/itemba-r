import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConstructionDashboardService } from './construction-dashboard.service';
import { ConstructionDashboardController } from './construction-dashboard.controller';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  providers: [ConstructionDashboardService, CompanyScopeService],
  controllers: [ConstructionDashboardController],
})
export class ConstructionDashboardModule {}
