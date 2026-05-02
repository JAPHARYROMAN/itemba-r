import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { QaTestCasesController } from './qa-test-cases.controller';
import { QaTestCasesService } from './qa-test-cases.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [QaTestCasesController],
  providers: [QaTestCasesService],
  exports: [QaTestCasesService],
})
export class QaTestCasesModule {}
