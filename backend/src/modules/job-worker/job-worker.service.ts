import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
  async drainOnce(batch = POLL_BATCH): Promise<JobDrainResult> {
    if (this.running) {
      return { leased: 0, skipped: true, settled: [] };
    }
    this.running = true;
    try {
      await this.recoverStale();
      const leased = await this.leaseJobs(batch);
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
  private async leaseJobs(batch: number): Promise<LeasedJob[]> {
    const registered = this.registry.registeredTypes();
    if (registered.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM background_jobs
         WHERE status IN ('QUEUED', 'RETRYING')
           AND ("scheduledAt" IS NULL OR "scheduledAt" <= NOW())
           AND "jobType"::text IN (${Prisma.join(registered)})
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
      // Should not happen — leaseJobs filters by registered types — but guard.
      this.logger.warn(`No handler for ${job.jobType}, requeueing job ${job.id}`);
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
      const isFinal = nextAttempts >= job.maxAttempts;
      const backoffMs = Math.min(60_000, 2 ** Math.min(nextAttempts, 6) * 1000);
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
}

type LeasedJob = {
  id: string;
  jobType: any;
  companyId: string | null;
  payload: Prisma.JsonValue | null;
  correlationId: string | null;
  attempts: number;
  maxAttempts: number;
};

type JobDrainResult = {
  leased: number;
  skipped: boolean;
  settled: Array<
    { jobId: string; status: 'fulfilled' } | { jobId: string; status: 'rejected'; reason: string }
  >;
};
