import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeNextBackupRunAt } from './backup-schedule';
import { JobContext, JobHandlerRegistry } from './job-handler.registry';

const POLL_INTERVAL_MS = 2_000; // baseline poll cadence
const POLL_BATCH = 5; // jobs leased per tick
const STALE_AFTER_MS = 5 * 60_000; // running jobs older than this are reclaimed

/**
 * BackgroundJob worker.
 *
 * P0-06: brings BackgroundJob/BackgroundJobsService from "registry of state"
 * to "real executor". Implementation choices:
 *
 *  - Storage: the existing `background_jobs` Postgres table. No new infra.
 *  - Leasing: `SELECT … FOR UPDATE SKIP LOCKED` so multiple worker instances
 *    can run safely (each grabs different rows).
 *  - Retry: failed jobs return to `RETRYING` and are picked up again with a
 *    backoff scheduled via `scheduledAt`. After `maxAttempts` they go to
 *    `DEAD_LETTER` so ops can replay them manually.
 *  - Stale recovery: jobs stuck in RUNNING for more than {@link STALE_AFTER_MS}
 *    (worker crash / hang) are returned to QUEUED on the next tick.
 *  - Activation: enabled by JOB_WORKER_ENABLED=true. Defaults to off so dev
 *    setups don't accidentally start the loop, and so tests don't drift.
 *
 * The worker can be later replaced by a BullMQ adapter without touching the
 * registered handlers — they consume {@link JobContext} only.
 */
@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private readonly workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const flag = this.config.get<string>('JOB_WORKER_ENABLED', 'false');
    this.enabled = ['1', 'true', 'yes', 'on'].includes(flag.trim().toLowerCase());
    if (!this.enabled) {
      this.logger.log(
        `JobWorker disabled (set JOB_WORKER_ENABLED=true to start). Registered handlers: ${
          this.registry.registeredTypes().join(', ') || '(none)'
        }`,
      );
      return;
    }
    this.logger.log(
      `JobWorker starting (id=${this.workerId}). Registered handlers: ${
        this.registry.registeredTypes().join(', ') || '(none)'
      }`,
    );
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      await this.drainOnce(POLL_BATCH);
    } catch (err) {
      this.logger.error(`JobWorker tick failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.scheduleNext();
    }
  }

  /**
   * Deterministic one-shot runner used by CI/e2e checks and operator tooling.
   * It executes the same stale recovery, leasing and handler path as the timer
   * loop without enabling the background polling loop.
   */
  async drainOnce(batch = POLL_BATCH, filter: JobDrainFilter = {}): Promise<JobDrainResult> {
    if (this.running) {
      return { leased: 0, skipped: true, settled: [] };
    }
    this.running = true;
    try {
      const scheduledBackups =
        filter.jobId || filter.queueName ? 0 : await this.enqueueDueBackupRuns(batch);
      await this.recoverStale();
      const leased = await this.leaseJobs(batch, filter);
      // Run leased jobs in parallel. Worker tick stays responsive even when
      // one handler is slow.
      const settled = await Promise.allSettled(
        leased.map(async (job) => {
          await this.runJob(job);
          return job.id;
        }),
      );
      return {
        leased: leased.length,
        skipped: false,
        scheduledBackups,
        settled: settled.map((result, index) =>
          result.status === 'fulfilled'
            ? { jobId: leased[index].id, status: result.status }
            : {
                jobId: leased[index].id,
                status: result.status,
                reason:
                  result.reason instanceof Error ? result.reason.message : String(result.reason),
              },
        ),
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Mark RUNNING jobs that haven't progressed in STALE_AFTER_MS as QUEUED so
   * they can be retried. This recovers from worker crashes mid-handler.
   */
  private async recoverStale(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    await this.prisma.backgroundJob.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'QUEUED' },
    });
  }

  /**
   * Lease up to N due jobs by flipping them from QUEUED/RETRYING to RUNNING in
   * a single transaction with FOR UPDATE SKIP LOCKED. Multiple workers can run
   * concurrently — each will grab a disjoint set of rows.
   */
  private async leaseJobs(batch: number, filter: JobDrainFilter = {}): Promise<LeasedJob[]> {
    const registered = this.registry.registeredTypes();
    if (registered.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM background_jobs
         WHERE status IN ('QUEUED', 'RETRYING')
           AND ("scheduledAt" IS NULL OR "scheduledAt" <= NOW())
           AND "jobType"::text IN (${Prisma.join(registered)})
           ${filter.jobId ? Prisma.sql`AND id = ${filter.jobId}` : Prisma.empty}
           ${filter.queueName ? Prisma.sql`AND "queueName" = ${filter.queueName}` : Prisma.empty}
           AND NOT EXISTS (
             SELECT 1 FROM job_queue_configs jqc
              WHERE jqc."queueName" = background_jobs."queueName"
                AND jqc."isActive" = false
           )
         ORDER BY priority DESC, "createdAt" ASC
         LIMIT ${batch}
         FOR UPDATE SKIP LOCKED
      `);
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      await tx.backgroundJob.updateMany({
        where: { id: { in: ids } },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      const rows = await tx.backgroundJob.findMany({ where: { id: { in: ids } } });
      return rows as LeasedJob[];
    });
  }

  private async runJob(job: LeasedJob): Promise<void> {
    const handler = this.registry.get(job.jobType);
    if (!handler) {
      // Should not happen; leaseJobs filters by registered types, but guard anyway.
      this.logger.warn(`No handler for ${job.jobType}, requeueing job ${job.id}`);
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED' },
      });
      return;
    }

    const queueConfig = await this.prisma.jobQueueConfig.findUnique({
      where: { queueName: job.queueName },
    });
    if (queueConfig && !queueConfig.isActive) {
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: 'QUEUED' },
      });
      return;
    }

    const ctx: JobContext = {
      jobId: job.id,
      jobType: job.jobType,
      companyId: job.companyId,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      correlationId: job.correlationId,
      attempts: job.attempts,
    };

    try {
      const result = await handler(ctx);
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: (result?.data ?? {}) as any,
          errorMessage: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempts = job.attempts + 1;
      const maxAttempts = Math.max(1, queueConfig?.retryAttempts ?? job.maxAttempts);
      const isFinal = nextAttempts >= maxAttempts;
      const backoffMs = this.retryBackoffMs(nextAttempts, queueConfig?.retryBackoffSeconds);
      this.logger.error(
        `Job ${job.id} (${job.jobType}) failed on attempt ${nextAttempts}: ${message}`,
      );
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: isFinal ? 'DEAD_LETTER' : 'RETRYING',
          attempts: nextAttempts,
          failedAt: new Date(),
          errorMessage: message.slice(0, 4000),
          scheduledAt: isFinal ? null : new Date(Date.now() + backoffMs),
        },
      });
    }
  }

  private async enqueueDueBackupRuns(batch: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM backup_jobs
         WHERE "deletedAt" IS NULL
           AND status = 'ACTIVE'
           AND schedule <> 'MANUAL'
           AND ("nextRunAt" IS NULL OR "nextRunAt" <= NOW())
         ORDER BY COALESCE("nextRunAt", "createdAt") ASC
         LIMIT ${batch}
         FOR UPDATE SKIP LOCKED
      `);
      if (candidates.length === 0) return 0;

      const ids = candidates.map((candidate) => candidate.id);
      const jobs = await tx.backupJob.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          backupJobCode: true,
          backupType: true,
          schedule: true,
          scheduleConfig: true,
        },
      });

      const now = new Date();
      for (const job of jobs) {
        const backupRunNumber = this.makeRunNumber('BR-SCH');
        const run = await tx.backupRun.create({
          data: {
            backupRunNumber,
            backupJobId: job.id,
            backupType: job.backupType,
            status: 'REQUESTED',
            metadata: {
              scheduled: true,
              backupJobCode: job.backupJobCode,
              enqueuedAt: now.toISOString(),
            },
          },
          select: { id: true, backupRunNumber: true },
        });

        await tx.backgroundJob.create({
          data: {
            jobNumber: this.makeRunNumber('JOB-BR'),
            jobType: 'BACKUP_RUN',
            queueName: 'backups',
            status: 'QUEUED',
            priority: 'NORMAL',
            payload: { backupRunId: run.id, scheduled: true },
            correlationId: run.id,
            idempotencyKey: `BACKUP_RUN:${run.backupRunNumber}`,
          },
        });

        await tx.backupJob.update({
          where: { id: job.id },
          data: {
            nextRunAt: computeNextBackupRunAt(job.schedule, now, job.scheduleConfig),
          },
        });
      }

      return jobs.length;
    });
  }

  private retryBackoffMs(nextAttempts: number, configuredBackoffSeconds?: number | null): number {
    if (configuredBackoffSeconds && configuredBackoffSeconds > 0) {
      return Math.min(60 * 60_000, configuredBackoffSeconds * 1000 * 2 ** (nextAttempts - 1));
    }
    return Math.min(60_000, 2 ** Math.min(nextAttempts, 6) * 1000);
  }

  private makeRunNumber(prefix: string): string {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
  }
}

type LeasedJob = {
  id: string;
  jobType: any;
  queueName: string;
  companyId: string | null;
  payload: Prisma.JsonValue | null;
  correlationId: string | null;
  attempts: number;
  maxAttempts: number;
};

type JobDrainFilter = {
  jobId?: string;
  queueName?: string;
};

type JobDrainResult = {
  leased: number;
  skipped: boolean;
  scheduledBackups?: number;
  settled: Array<
    { jobId: string; status: 'fulfilled' } | { jobId: string; status: 'rejected'; reason: string }
  >;
};
