import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BackupRunsController } from './backup-runs.controller';
import { BackupRunsService } from './backup-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BackupRunsController],
  providers: [BackupRunsService],
  exports: [BackupRunsService],
})
export class BackupRunsModule {}
