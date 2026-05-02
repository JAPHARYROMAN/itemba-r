import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DataExportsModule } from '../data-exports/data-exports.module';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobWorkerService } from './job-worker.service';
import { DataExportJobHandler } from './handlers/data-export.handler';
import { BackupRunJobHandler } from './handlers/backup-run.handler';
import { NotificationDispatchJobHandler } from './handlers/notification-dispatch.handler';
import { RestoreTestJobHandler } from './handlers/restore-test.handler';

/**
 * Job worker module — owns the BackgroundJob runtime and registers default
 * handlers for DATA_EXPORT, BACKUP_RUN, and NOTIFICATION_DISPATCH.
 *
 * Activation:
 *   - Set JOB_WORKER_ENABLED=true to start the polling loop.
 *   - Defaults to off so dev / test do not unexpectedly process jobs.
 *
 * P0-06: this is the runtime that turns BackgroundJob/DataExportLog/BackupRun
 * tables from "registries of state" into "real executors". Adding a new job
 * type is one new handler file plus an `@OnModuleInit` registration.
 */
@Module({
  imports: [ConfigModule, PrismaModule, DataExportsModule],
  providers: [
    JobHandlerRegistry,
    JobWorkerService,
    DataExportJobHandler,
    BackupRunJobHandler,
    NotificationDispatchJobHandler,
    RestoreTestJobHandler,
  ],
  exports: [JobHandlerRegistry, JobWorkerService],
})
export class JobWorkerModule {}
