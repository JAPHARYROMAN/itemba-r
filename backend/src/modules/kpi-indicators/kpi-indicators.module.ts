import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { KpiIndicatorsController } from './kpi-indicators.controller';
import { KpiIndicatorsService } from './kpi-indicators.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [KpiIndicatorsController],
  providers: [KpiIndicatorsService],
  exports: [KpiIndicatorsService],
})
export class KpiIndicatorsModule {}
