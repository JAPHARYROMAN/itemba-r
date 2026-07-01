import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DataExportsModule } from '../data-exports/data-exports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduledReportsModule } from '../scheduled-reports/scheduled-reports.module';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobWorkerService } from './job-worker.service';
import { DataExportJobHandler } from './handlers/data-export.handler';
import { BackupRunJobHandler } from './handlers/backup-run.handler';
import { NotificationDispatchJobHandler } from './handlers/notification-dispatch.handler';
import { RestoreTestJobHandler } from './handlers/restore-test.handler';
import { RentInvoiceGenerationJobHandler } from './handlers/rent-invoice-generation.handler';

/**
 * Job worker module — owns the BackgroundJob runtime and registers default
 * handlers for DATA_EXPORT, BACKUP_RUN, and NOTIFICATION_DISPATCH.
 *
 * Activation:
 *   - Set JOB_WORKER_ENABLED=true to start the polling loop.
 *   - Defaults to off so dev / test do not unexpectedly process jobs.
 *
 * Automation dispatch (overdue reminders, low-stock alerts, scheduled report
 * emails) rides the same poll loop, gated independently by
 * AUTOMATION_DISPATCH_ENABLED (default off). It reuses EmailService /
 * NotificationsService / ScheduledReportsService via NotificationsModule and
 * ScheduledReportsModule.
 *
 * P0-06: this is the runtime that turns BackgroundJob/DataExportLog/BackupRun
 * tables from "registries of state" into "real executors". Adding a new job
 * type is one new handler file plus an `@OnModuleInit` registration.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    DataExportsModule,
    NotificationsModule,
    ScheduledReportsModule,
  ],
  providers: [
    JobHandlerRegistry,
    JobWorkerService,
    DataExportJobHandler,
    BackupRunJobHandler,
    NotificationDispatchJobHandler,
    RestoreTestJobHandler,
    RentInvoiceGenerationJobHandler,
  ],
  exports: [JobHandlerRegistry, JobWorkerService],
})
export class JobWorkerModule {}
