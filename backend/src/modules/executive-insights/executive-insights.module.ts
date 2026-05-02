import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ExecutiveInsightsController } from './executive-insights.controller';
import { ExecutiveInsightsService } from './executive-insights.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ExecutiveInsightsController],
  providers: [ExecutiveInsightsService],
  exports: [ExecutiveInsightsService],
})
export class ExecutiveInsightsModule {}
