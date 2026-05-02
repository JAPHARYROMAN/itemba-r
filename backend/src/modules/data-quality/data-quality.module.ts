import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DataQualityController } from './data-quality.controller';
import { DataQualityCheckRunnerService } from './data-quality-check-runner.service';
import { DataQualityService } from './data-quality.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataQualityController],
  providers: [DataQualityService, DataQualityCheckRunnerService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
