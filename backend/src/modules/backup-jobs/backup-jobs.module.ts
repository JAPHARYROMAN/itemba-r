import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BackupJobsController } from './backup-jobs.controller';
import { BackupJobsService } from './backup-jobs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BackupJobsController],
  providers: [BackupJobsService],
  exports: [BackupJobsService],
})
export class BackupJobsModule {}
