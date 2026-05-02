import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JobQueueConfigsController } from './job-queue-configs.controller';
import { JobQueueConfigsService } from './job-queue-configs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [JobQueueConfigsController],
  providers: [JobQueueConfigsService],
  exports: [JobQueueConfigsService],
})
export class JobQueueConfigsModule {}
