import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DataArchiveJobsController } from './data-archive-jobs.controller';
import { DataArchiveJobsService } from './data-archive-jobs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataArchiveJobsController],
  providers: [DataArchiveJobsService],
  exports: [DataArchiveJobsService],
})
export class DataArchiveJobsModule {}
