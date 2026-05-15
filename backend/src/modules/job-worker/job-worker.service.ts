import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeNextBackupRunAt } from './backup-schedule';
import { JobContext, JobHandlerRegistry } from './job-handler.registry';

const POLL_INTERVAL_MS = 2_000; // baseline poll cadence
const POLL_BATCH = 5; // jobs leased per tick
const DEFAULT_STALE_AFTER_MS = 30 * 60_000; // running jobs older than this are reclaimed
const STALE_RECOVERY_BATCH = 100;
const DEFAULT_CANDIDATE_MULTIPLIER = 10;

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
      const recoveredStale = await this.recoverStale();
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
        recoveredStale,
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
  private async recoverStale(): Promise<number> {
    const cutoff = new Date(Date.now() - this.staleAfterMs());
    const staleJobs = await this.prisma.backgroundJob.findMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      orderBy: { startedAt: 'asc' },
      take: STALE_RECOVERY_BATCH,
    });
    if (staleJobs.length === 0) return 0;

    const queueNames = Array.from(new Set(staleJobs.map((job) => job.queueName)));
    const configs = await this.prisma.jobQueueConfig.findMany({
      where: { queueName: { in: queueNames } },
      select: { queueName: true, retryAttempts: true, retryBackoffSeconds: true },
    });
    const configByQueue = new Map(configs.map((config) => [config.queueName, config]));
    const message = 'Worker lease expired before completion';

    for (const job of staleJobs) {
      const queueConfig = configByQueue.get(job.queueName);
      const nextAttempts = job.attempts + 1;
      const maxAttempts = this.maxAttemptsFor(job, queueConfig);
      const isFinal = nextAttempts >= maxAttempts;
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: isFinal ? 'DEAD_LETTER' : 'RETRYING',
          attempts: nextAttempts,
          failedAt: new Date(),
          startedAt: null,
          scheduledAt: isFinal
            ? null
            : new Date(
                Date.now() + this.retryBackoffMs(nextAttempts, queueConfig?.retryBackoffSeconds),
              ),
          errorMessage: message,
        },
      });
      if (isFinal) {
        await this.markRelatedWorkFailed(job, message);
      }
    }

    return staleJobs.length;
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
      const candidateLimit = Math.max(batch, batch * DEFAULT_CANDIDATE_MULTIPLIER);
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
         SELECT background_jobs.id FROM background_jobs
          LEFT JOIN job_queue_configs jqc
            ON jqc."queueName" = background_jobs."queueName"
         WHERE background_jobs.status IN ('QUEUED', 'RETRYING')
           AND (background_jobs."scheduledAt" IS NULL OR background_jobs."scheduledAt" <= NOW())
           AND background_jobs."jobType"::text IN (${Prisma.join(registered)})
           ${filter.jobId ? Prisma.sql`AND background_jobs.id = ${filter.jobId}` : Prisma.empty}
           ${
             filter.queueName
               ? Prisma.sql`AND background_jobs."queueName" = ${filter.queueName}`
               : Prisma.empty
           }
           AND COALESCE(jqc."isActive", true) = true
         ORDER BY background_jobs.priority DESC, background_jobs."createdAt" ASC
         LIMIT ${candidateLimit}
         FOR UPDATE OF background_jobs SKIP LOCKED
      `);
      if (candidates.length === 0) return [];

      const candidateIds = candidates.map((c) => c.id);
      const candidateRows = await tx.backgroundJob.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, queueName: true },
      });
      const rowById = new Map(candidateRows.map((row) => [row.id, row]));
      const orderedCandidates = candidateIds
        .map((id) => rowById.get(id))
        .filter((row): row is { id: string; queueName: string } => Boolean(row));

      const queueNames = Array.from(new Set(orderedCandidates.map((row) => row.queueName))).sort();
      for (const queueName of queueNames) {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${queueName}))`);
      }

      const [configs, runningCounts] = await Promise.all([
        tx.jobQueueConfig.findMany({
          where: { queueName: { in: queueNames } },
          select: { queueName: true, concurrency: true, isActive: true },
        }),
        tx.backgroundJob.groupBy({
          by: ['queueName'],
          where: { queueName: { in: queueNames }, status: 'RUNNING' },
          _count: { _all: true },
        }),
      ]);

      const configByQueue = new Map(configs.map((config) => [config.queueName, config]));
      const runningByQueue = new Map(
        runningCounts.map((count) => [count.queueName, count._count._all]),
      );
      const remainingByQueue = new Map<string, number>();
      for (const queueName of queueNames) {
        const config = configByQueue.get(queueName);
        if (config && !config.isActive) {
          remainingByQueue.set(queueName, 0);
          continue;
        }
        const configuredConcurrency = Math.max(1, config?.concurrency ?? batch);
        const running = runningByQueue.get(queueName) ?? 0;
        remainingByQueue.set(queueName, Math.max(0, configuredConcurrency - running));
      }

      const ids: string[] = [];
      for (const row of orderedCandidates) {
        const remaining = remainingByQueue.get(row.queueName) ?? 0;
        if (remaining <= 0) continue;
        ids.push(row.id);
        remainingByQueue.set(row.queueName, remaining - 1);
        if (ids.length >= batch) break;
      }
      if (ids.length === 0) return [];

      const startedAt = new Date();
      await tx.backgroundJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'RUNNING',
          startedAt,
          completedAt: null,
          failedAt: null,
          errorMessage: null,
        },
      });
      const rows = await tx.backgroundJob.findMany({ where: { id: { in: ids } } });
      const leasedById = new Map(rows.map((row) => [row.id, row as LeasedJob]));
      return ids.map((id) => leasedById.get(id)).filter((row): row is LeasedJob => Boolean(row));
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
      const result = await this.withTimeout(handler(ctx), this.handlerTimeoutMs(queueConfig), job);
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
      const maxAttempts = this.maxAttemptsFor(job, queueConfig);
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
      if (isFinal) {
        await this.markRelatedWorkFailed(job, message);
      }
    }
  }

  private handlerTimeoutMs(queueConfig?: { timeoutSeconds?: number | null } | null): number | null {
    const configuredSeconds =
      queueConfig?.timeoutSeconds ??
      Number(this.config.get<string>('JOB_WORKER_DEFAULT_TIMEOUT_SECONDS', '0'));
    if (!Number.isFinite(configuredSeconds) || configuredSeconds <= 0) return null;
    return Math.max(1, configuredSeconds * 1000);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | null,
    job: Pick<LeasedJob, 'id' | 'jobType'>,
  ): Promise<T> {
    if (!timeoutMs) return promise;
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Job ${job.id} (${job.jobType}) exceeded timeout of ${Math.ceil(
                    timeoutMs / 1000,
                  )}s`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private maxAttemptsFor(
    job: Pick<LeasedJob, 'maxAttempts'>,
    queueConfig?: { retryAttempts?: number | null } | null,
  ): number {
    return Math.max(1, queueConfig?.retryAttempts ?? job.maxAttempts);
  }

  private async markRelatedWorkFailed(
    job: Pick<LeasedJob, 'jobType' | 'payload' | 'correlationId'>,
    message: string,
  ): Promise<void> {
    const payload = this.payloadObject(job.payload);
    const errorMessage = message.slice(0, 4000);

    if (job.jobType === 'DATA_EXPORT') {
      const exportLogId =
        typeof payload.exportLogId === 'string' ? payload.exportLogId : job.correlationId;
      if (exportLogId) {
        await this.prisma.dataExportLog
          .update({
            where: { id: exportLogId },
            data: { status: 'FAILED', completedAt: new Date(), notes: errorMessage },
          })
          .catch((err) => this.logRelatedFailureUpdate('DataExportLog', exportLogId, err));
      }
      return;
    }

    if (job.jobType === 'BACKUP_RUN') {
      const backupRunId =
        typeof payload.backupRunId === 'string' ? payload.backupRunId : job.correlationId;
      if (backupRunId) {
        await this.prisma.backupRun
          .update({
            where: { id: backupRunId },
            data: { status: 'FAILED', completedAt: new Date(), errorMessage },
          })
          .catch((err) => this.logRelatedFailureUpdate('BackupRun', backupRunId, err));
      }
      return;
    }

    if (job.jobType === 'CUSTOM' && payload.kind === 'RESTORE_TEST') {
      const restoreTestId =
        typeof payload.restoreTestId === 'string' ? payload.restoreTestId : job.correlationId;
      if (restoreTestId) {
        await this.prisma.restoreTest
          .update({
            where: { id: restoreTestId },
            data: { status: 'FAILED', completedAt: new Date(), issuesFound: errorMessage },
          })
          .catch((err) => this.logRelatedFailureUpdate('RestoreTest', restoreTestId, err));
      }
    }
  }

  private staleAfterMs(): number {
    const configuredSeconds = Number(
      this.config.get<string>('JOB_WORKER_STALE_AFTER_SECONDS', '0'),
    );
    if (Number.isFinite(configuredSeconds) && configuredSeconds > 0) {
      return configuredSeconds * 1000;
    }
    return DEFAULT_STALE_AFTER_MS;
  }

  private logRelatedFailureUpdate(entityType: string, id: string, err: unknown): void {
    this.logger.error(
      `Failed to mark ${entityType} ${id} as failed`,
      err instanceof Error ? err.stack : String(err),
    );
  }

  private payloadObject(payload: Prisma.JsonValue | null): Record<string, unknown> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
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
  recoveredStale?: number;
  settled: Array<
    { jobId: string; status: 'fulfilled' } | { jobId: string; status: 'rejected'; reason: string }
  >;
};
