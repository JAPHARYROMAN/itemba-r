import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { QaTestRunsController } from './qa-test-runs.controller';
import { QaTestRunsService } from './qa-test-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [QaTestRunsController],
  providers: [QaTestRunsService],
  exports: [QaTestRunsService],
})
export class QaTestRunsModule {}
