import { Module } from '@nestjs/common';
import { OperationsDashboardService } from './operations-dashboard.service';
import { OperationsDashboardController } from './operations-dashboard.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsDashboardController],
  providers: [OperationsDashboardService, CompanyScopeService],
  exports: [OperationsDashboardService],
})
export class OperationsDashboardModule {}
