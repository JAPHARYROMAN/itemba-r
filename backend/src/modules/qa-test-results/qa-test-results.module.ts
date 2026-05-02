import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { QaTestResultsController } from './qa-test-results.controller';
import { QaTestResultsService } from './qa-test-results.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [QaTestResultsController],
  providers: [QaTestResultsService],
  exports: [QaTestResultsService],
})
export class QaTestResultsModule {}
