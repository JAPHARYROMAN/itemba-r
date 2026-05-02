import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { QaTestSuitesController } from './qa-test-suites.controller';
import { QaTestSuitesService } from './qa-test-suites.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [QaTestSuitesController],
  providers: [QaTestSuitesService],
  exports: [QaTestSuitesService],
})
export class QaTestSuitesModule {}
