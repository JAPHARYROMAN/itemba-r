import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PerformanceTracesController } from './performance-traces.controller';
import { PerformanceTracesService } from './performance-traces.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PerformanceTracesController],
  providers: [PerformanceTracesService],
  exports: [PerformanceTracesService],
})
export class PerformanceTracesModule {}
