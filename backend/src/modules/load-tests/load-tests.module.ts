import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LoadTestsController } from './load-tests.controller';
import { LoadTestsService } from './load-tests.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LoadTestsController],
  providers: [LoadTestsService],
  exports: [LoadTestsService],
})
export class LoadTestsModule {}
