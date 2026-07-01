import { Injectable, Logger, Optional, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '@common/services/email.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { ScheduledReportsService } from '../scheduled-reports/scheduled-reports.service';
import { computeNextBackupRunAt } from './backup-schedule';
import { JobContext, JobHandlerRegistry } from './job-handler.registry';

const POLL_INTERVAL_MS = 2_000; // baseline poll cadence
const POLL_BATCH = 5; // jobs leased per tick
const DEFAULT_STALE_AFTER_MS = 30 * 60_000; // running jobs older than this are reclaimed
const STALE_RECOVERY_BATCH = 100;
const DEFAULT_CANDIDATE_MULTIPLIER = 10;

// --- Automation dispatch defaults (all overridable via env) -----------------
// How stale a receivable reminder must be before we re-send. One reminder per
// receivable per window; NULL lastReminderAt means "never reminded".
const DEFAULT_OVERDUE_REMINDER_INTERVAL_HOURS = 72;
// How recently a LOW_STOCK AlertEvent must have fired for the same product to
// suppress a duplicate. Prevents alert spam on every tick.
const DEFAULT_LOW_STOCK_ALERT_INTERVAL_HOURS = 24;
// Max rows any single automation pass will touch per tick. Hard ceiling so a
// large backlog never fans out unbounded email/notification traffic.
const DEFAULT_AUTOMATION_BATCH = 25;

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
  private automationEnabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly config: ConfigService,
    // Automation dispatch collaborators. Optional so the worker (and its unit
    // tests, which construct it with only the first three args) still boots when
    // the automation feature is not wired in. When absent, the automation passes
    // are simply skipped.
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly scheduledReports?: ScheduledReportsService,
  ) {}

  onModuleInit(): void {
    this.enabled = this.isFlagTruthy(this.config.get<string>('JOB_WORKER_ENABLED', 'false'));
    // Automation dispatch is independently gated and defaults OFF, so nothing
    // auto-fires (reminders, alerts, scheduled report emails) until an operator
    // explicitly enables it AND the job worker loop is running.
    this.automationEnabled = this.isFlagTruthy(
      this.config.get<string>('AUTOMATION_DISPATCH_ENABLED', 'false'),
    );
    if (this.automationEnabled) {
      this.logger.log(
        'Automation dispatch ENABLED (overdue reminders, low-stock alerts, scheduled reports).',
      );
    }
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
      const targeted = Boolean(filter.jobId || filter.queueName);
      const scheduledBackups = targeted ? 0 : await this.enqueueDueBackupRuns(batch);
      // Automation dispatch runs alongside scheduled backups on the poll loop.
      // Each pass is individually wrapped so one failure never aborts the tick
      // (or the leasing/execution that follows), and the whole block is gated by
      // AUTOMATION_DISPATCH_ENABLED.
      const automation =
        targeted || !this.automationEnabled ? undefined : await this.runAutomationDispatch();
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
        automation,
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

  // ==========================================================================
  // Automation dispatch
  //
  // Three idempotent, company-scoped, Decimal-safe passes that run on the poll
  // loop when AUTOMATION_DISPATCH_ENABLED is truthy. Each pass:
  //   - selects only *due* work (never re-sends inside its throttle window),
  //   - claims/stamps the row atomically before doing side effects,
  //   - is individually try/caught so one failure never crashes the tick.
  // ==========================================================================

  /**
   * Run all automation passes, each isolated so a failure in one does not stop
   * the others (or the surrounding tick). Returns a per-pass summary for
   * observability / the drainOnce result.
   */
  async runAutomationDispatch(): Promise<AutomationDispatchResult> {
    const batch = this.automationBatch();
    const reminders = await this.runAutomationPass('overdueReminders', () =>
      this.enqueueDueOverdueReminders(batch),
    );
    const lowStock = await this.runAutomationPass('lowStockAlerts', () =>
      this.enqueueDueLowStockAlerts(batch),
    );
    const scheduledReports = await this.runAutomationPass('scheduledReports', () =>
      this.enqueueDueScheduledReports(batch),
    );
    return { reminders, lowStock, scheduledReports };
  }

  private async runAutomationPass(
    name: string,
    fn: () => Promise<AutomationPassResult>,
  ): Promise<AutomationPassResult> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Automation pass "${name}" failed: ${message}`, (err as Error)?.stack);
      return { processed: 0, error: message };
    }
  }

  /**
   * (1) Overdue receivable reminders.
   *
   * Selects OPEN / PARTIALLY_PAID receivables that are past due and have either
   * never been reminded (lastReminderAt IS NULL) or were last reminded before
   * the throttle window. For each, it *claims* the receivable by stamping
   * lastReminderAt with an updateMany guarded on the previously-observed value
   * (compare-and-set) so two concurrent workers can never double-send, then
   * emails the customer + records an in-app notification for the AR team.
   *
   * Idempotent: a receivable is reminded at most once per
   * AUTOMATION_OVERDUE_REMINDER_INTERVAL_HOURS window.
   */
  async enqueueDueOverdueReminders(batch: number): Promise<AutomationPassResult> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.overdueReminderIntervalHours() * 60 * 60_000);

    const due = await this.prisma.receivable.findMany({
      where: {
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID'] },
        dueDate: { not: null, lt: now },
        outstandingAmount: { gt: 0 },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: staleBefore } }],
      },
      select: {
        id: true,
        companyId: true,
        receivableNumber: true,
        customerName: true,
        currency: true,
        dueDate: true,
        outstandingAmount: true,
        lastReminderAt: true,
        customer: { select: { email: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: batch,
    });

    let processed = 0;
    let emailed = 0;
    for (const r of due) {
      // Atomic compare-and-set claim: only proceed if lastReminderAt is still
      // exactly what we read (null or the stale timestamp). Prevents a second
      // worker from also picking this receivable up in the same window.
      const claim = await this.prisma.receivable.updateMany({
        where: {
          id: r.id,
          companyId: r.companyId,
          lastReminderAt: r.lastReminderAt ?? null,
        },
        data: { lastReminderAt: now },
      });
      if (claim.count === 0) continue; // lost the race — someone else claimed it.
      processed += 1;

      // Decimal-safe money: never coerce to float.
      const outstanding = new Prisma.Decimal(r.outstandingAmount);
      const amountText = `${r.currency} ${outstanding.toFixed(2)}`;
      const dueText = r.dueDate ? r.dueDate.toISOString().slice(0, 10) : 'the agreed date';
      const subject = `Payment reminder: invoice ${r.receivableNumber}`;
      const body =
        `Dear ${r.customerName}, our records show an outstanding balance of ` +
        `${amountText} on ${r.receivableNumber}, which was due on ${dueText}. ` +
        `Please arrange payment at your earliest convenience.`;

      // Per-receivable side effects are isolated so one bad recipient / failing
      // notification never aborts the rest of the batch. The lastReminderAt CAS
      // above already recorded the claim, so a failure here is best-effort (the
      // receivable will not be re-reminded until the throttle window elapses) —
      // never a double-send.
      try {
        const to = r.customer?.email;
        if (to && this.emailService) {
          await this.emailService.sendEmail(to, subject, `<p>${body}</p>`, body);
          emailed += 1;
        }
        // In-app notification to the AR team, keyed to the receivable.
        await this.notifyCompanyRecipients({
          companyId: r.companyId,
          title: subject,
          message: body,
          notificationType: 'PAYMENT_DUE',
          priority: 'HIGH',
          linkedEntityType: 'Receivable',
          linkedEntityId: r.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Overdue reminder side effects failed for receivable ${r.receivableNumber}: ${message}`,
        );
      }
    }

    return { processed, emailed, scanned: due.length };
  }

  /**
   * (2) Low-stock alerts.
   *
   * Selects tracked products whose on-hand quantity (summed across branches) is
   * at or below their reorder level, and for which no LOW_STOCK AlertEvent has
   * fired within the throttle window. Creates one AlertEvent (LOW_STOCK) per
   * product + a company notification. Idempotent via the recent-AlertEvent
   * check keyed on linkedEntityId = productId.
   */
  async enqueueDueLowStockAlerts(batch: number): Promise<AutomationPassResult> {
    const now = new Date();
    const alertedSince = new Date(now.getTime() - this.lowStockAlertIntervalHours() * 60 * 60_000);

    // Candidate products: tracked, active, with a positive reorder level.
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        trackInventory: true,
        reorderLevel: { not: null, gt: 0 },
      },
      select: {
        id: true,
        companyId: true,
        name: true,
        productCode: true,
        reorderLevel: true,
      },
      // Scan a wider set than the batch; only a subset will actually be below
      // reorder and un-alerted. The write side is still capped by `batch`.
      take: Math.max(batch, batch * DEFAULT_CANDIDATE_MULTIPLIER),
    });
    if (products.length === 0) return { processed: 0, scanned: 0 };

    const productIds = products.map((p) => p.id);

    // On-hand quantity per product (Decimal-safe sum across balances/branches).
    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds } },
      _sum: { quantityOnHand: true },
    });
    const onHandByProduct = new Map(
      balances.map((b) => [b.productId, new Prisma.Decimal(b._sum.quantityOnHand ?? 0)]),
    );

    // Products already alerted within the window — suppress duplicates.
    const recent = await this.prisma.alertEvent.findMany({
      where: {
        alertType: 'LOW_STOCK',
        linkedEntityType: 'Product',
        linkedEntityId: { in: productIds },
        triggeredAt: { gte: alertedSince },
      },
      select: { linkedEntityId: true },
    });
    const recentlyAlerted = new Set(recent.map((e) => e.linkedEntityId));

    let processed = 0;
    for (const p of products) {
      if (processed >= batch) break;
      if (recentlyAlerted.has(p.id)) continue;

      const onHand = onHandByProduct.get(p.id) ?? new Prisma.Decimal(0);
      const reorder = new Prisma.Decimal(p.reorderLevel ?? 0);
      // Decimal comparison — below OR at the reorder level triggers.
      if (onHand.gt(reorder)) continue;

      const title = `Low stock: ${p.name}`;
      const message =
        `${p.name} (${p.productCode}) is at ${onHand.toFixed(2)} on hand, ` +
        `at or below its reorder level of ${reorder.toFixed(2)}. Consider reordering.`;

      // Claim-and-create: guard against a concurrent worker by re-checking for a
      // recent AlertEvent inside a transaction before creating one.
      const created = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.alertEvent.findFirst({
          where: {
            alertType: 'LOW_STOCK',
            linkedEntityType: 'Product',
            linkedEntityId: p.id,
            triggeredAt: { gte: alertedSince },
          },
          select: { id: true },
        });
        if (existing) return false;
        await tx.alertEvent.create({
          data: {
            alertEventNumber: this.makeRunNumber('ALRT-LS'),
            companyId: p.companyId,
            alertType: 'LOW_STOCK',
            title,
            message,
            linkedEntityType: 'Product',
            linkedEntityId: p.id,
            priority: 'HIGH',
            status: 'OPEN',
            triggeredAt: now,
            metadata: {
              productCode: p.productCode,
              onHand: onHand.toFixed(4),
              reorderLevel: reorder.toFixed(4),
              source: 'automation-dispatch',
            },
          },
        });
        return true;
      });
      if (!created) continue;
      recentlyAlerted.add(p.id);
      processed += 1;

      await this.notifyCompanyRecipients({
        companyId: p.companyId,
        title,
        message,
        notificationType: 'INVENTORY_ALERT',
        priority: 'HIGH',
        linkedEntityType: 'Product',
        linkedEntityId: p.id,
      });
    }

    return { processed, scanned: products.length };
  }

  /**
   * (3) Scheduled report runs.
   *
   * Selects active scheduled reports whose nextRunAt is due, atomically claims
   * each (updateMany guarded on the observed nextRunAt so the same due window is
   * never run twice), materializes the export via the existing
   * ScheduledReportsService.run(), then emails the export to the configured
   * recipients. lastRunAt is stamped by run(); nextRunAt is advanced here.
   *
   * A per-report principal is resolved from a REAL, active user who legitimately
   * has access to the report's own company (or a GROUP-scoped user for
   * companyId = null). run() writes ReportRun.requestedById and
   * DataExportLog.exportedById — both required FKs to User — so a fabricated id
   * would throw a Postgres FK violation and silently burn the due window.
   *
   * Fail-safe window consumption: nextRunAt is only advanced (CAS) after a
   * usable principal is resolved; if run() then throws, nextRunAt is RE-ARMED
   * back to the observed value so the window is retried, never silently lost. If
   * NO usable user exists for the company the report is skipped WITHOUT
   * advancing/burning nextRunAt.
   */
  async enqueueDueScheduledReports(batch: number): Promise<AutomationPassResult> {
    if (!this.scheduledReports) {
      return { processed: 0, scanned: 0, note: 'ScheduledReportsService not available' };
    }
    const now = new Date();

    const due = await this.prisma.scheduledReport.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        nextRunAt: { not: null, lte: now },
      },
      select: {
        id: true,
        scheduleCode: true,
        name: true,
        companyId: true,
        frequency: true,
        recipients: true,
        nextRunAt: true,
      },
      orderBy: { nextRunAt: 'asc' },
      take: batch,
    });

    let processed = 0;
    let emailed = 0;
    let skipped = 0;
    for (const s of due) {
      // Resolve a REAL principal BEFORE claiming the window. If none exists we
      // must not advance/burn nextRunAt — otherwise the due window would be lost
      // with no report ever produced.
      const principal = await this.resolveReportPrincipal(s.companyId);
      if (!principal) {
        skipped += 1;
        this.logger.warn(
          `Scheduled report ${s.scheduleCode} skipped: no active user available to run reports for ${
            s.companyId ? `company ${s.companyId}` : 'group-level scope'
          }. nextRunAt left intact for retry.`,
        );
        continue;
      }

      // Atomic claim of this due window: advance nextRunAt only if it is still
      // the value we observed. Losing the CAS means another worker took it.
      const nextRunAt = this.computeNextScheduledReportRunAt(s.frequency, now);
      const claim = await this.prisma.scheduledReport.updateMany({
        where: { id: s.id, nextRunAt: s.nextRunAt, isActive: true, deletedAt: null },
        data: { nextRunAt },
      });
      if (claim.count === 0) continue;
      processed += 1;

      let result: { export?: { filename: string } } | undefined;
      try {
        result = await this.scheduledReports.run(s.id, principal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Scheduled report ${s.scheduleCode} run failed: ${message}`);
        // Re-arm the window: restore nextRunAt to the observed value so the run
        // is retried on a later tick instead of being silently skipped. Guarded
        // on the value we just wrote so we never clobber a concurrent claim.
        processed -= 1;
        const rearm = await this.prisma.scheduledReport.updateMany({
          where: { id: s.id, nextRunAt, isActive: true, deletedAt: null },
          data: { nextRunAt: s.nextRunAt },
        });
        if (rearm.count === 0) {
          this.logger.warn(
            `Scheduled report ${s.scheduleCode}: could not re-arm nextRunAt (value changed concurrently); window not restored.`,
          );
        }
        continue;
      }

      const recipients = this.extractRecipientEmails(s.recipients);
      const filename = result?.export?.filename ?? `${s.scheduleCode}.export`;
      const subject = `Scheduled report: ${s.name}`;
      const body =
        `The scheduled report "${s.name}" (${s.scheduleCode}) has been generated ` +
        `and is available for download: ${filename}.`;
      if (this.emailService) {
        for (const to of recipients) {
          // Isolate each send so one bad recipient does not abort the batch.
          try {
            await this.emailService.sendEmail(to, subject, `<p>${body}</p>`, body);
            emailed += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(
              `Scheduled report ${s.scheduleCode}: email to ${to} failed: ${message}`,
            );
          }
        }
      }
    }

    return { processed, emailed, scanned: due.length, skipped };
  }

  // --- Automation helpers ---------------------------------------------------

  /**
   * Record an in-app notification for a company. Notifications require a
   * recipient user, so we fan out to active users with company access. If none
   * can be resolved the durable AlertEvent / receivable stamp is still the
   * system of record; the notification is best-effort.
   */
  private async notifyCompanyRecipients(input: {
    companyId: string | null;
    title: string;
    message: string;
    notificationType: 'PAYMENT_DUE' | 'INVENTORY_ALERT' | 'SYSTEM_ALERT';
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
    linkedEntityType?: string;
    linkedEntityId?: string;
  }): Promise<void> {
    if (!this.notifications || !input.companyId) return;
    const recipients = await this.prisma.userCompanyAccess.findMany({
      where: {
        companyId: input.companyId,
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: { userId: true },
      take: 25,
    });
    for (const recipient of recipients) {
      await this.notifications.sendNotification({
        recipientUserId: recipient.userId,
        companyId: input.companyId,
        title: input.title,
        message: input.message,
        notificationType: input.notificationType as any,
        priority: (input.priority ?? 'NORMAL') as any,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
      });
    }
  }

  /**
   * Resolve a REAL principal that legitimately has access to the report's scope,
   * so ScheduledReportsService.run() can persist ReportRun.requestedById /
   * DataExportLog.exportedById (required FKs to an existing User row) without a
   * Postgres FK violation.
   *
   * Security intent is preserved (no cross-company bypass): the resolved user is
   * a genuine member of the report's own company, and the returned principal is
   * shaped from that user's actual grant so run()'s company-scope guard still
   * holds. We do NOT fabricate or persist a synthetic user row.
   *
   *  - Company-scoped report (companyId set): pick an active, non-deleted user
   *    with UserCompanyAccess to that company, preferring the highest access
   *    level (MANAGE > WRITE > READ). Returns null if none exists.
   *  - Group-level report (companyId null): pick an active, non-deleted user who
   *    holds a GROUP-scoped role. Returns null if none exists.
   */
  private async resolveReportPrincipal(companyId: string | null): Promise<AuthUser | null> {
    if (!companyId) {
      // Group-level report — needs a real user with a GROUP-scoped role.
      const groupUser = await this.prisma.user.findFirst({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          userRoles: { some: { role: { scope: 'GROUP' } } },
        },
        select: { id: true, email: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!groupUser) return null;
      return {
        id: groupUser.id,
        email: groupUser.email,
        roles: [],
        roleScopes: ['GROUP'],
        permissions: [],
        companyId: null,
        companyAccess: [],
      };
    }

    // Company-scoped report — pick a real member, preferring the highest access
    // level so the principal can satisfy run()'s READ requirement (and any
    // stronger check) without over-granting beyond this one company.
    const access = await this.prisma.userCompanyAccess.findFirst({
      where: {
        companyId,
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: {
        accessLevel: true,
        user: { select: { id: true, email: true } },
      },
      orderBy: [{ accessLevel: 'desc' }, { grantedAt: 'asc' }],
    });
    if (!access) return null;
    return {
      id: access.user.id,
      email: access.user.email,
      roles: [],
      roleScopes: [],
      permissions: [],
      companyId: null,
      companyAccess: [{ companyId, accessLevel: access.accessLevel }],
    };
  }

  /** Extract a de-duplicated list of recipient emails from the JSON blob. */
  private extractRecipientEmails(recipients: Prisma.JsonValue | null): string[] {
    const out = new Set<string>();
    const push = (v: unknown) => {
      if (typeof v === 'string' && v.includes('@')) out.add(v.trim());
    };
    const walk = (value: unknown) => {
      if (!value) return;
      if (typeof value === 'string') return push(value);
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        for (const key of ['emails', 'to', 'cc', 'recipients', 'email', 'addresses']) {
          if (key in obj) walk(obj[key]);
        }
      }
    };
    walk(recipients);
    return Array.from(out);
  }

  /** Advance a scheduled report's nextRunAt based on its frequency. */
  private computeNextScheduledReportRunAt(frequency: string, from: Date): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'DAILY':
        next.setDate(next.getDate() + 1);
        break;
      case 'WEEKLY':
        next.setDate(next.getDate() + 7);
        break;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'ANNUAL':
        next.setFullYear(next.getFullYear() + 1);
        break;
      case 'MONTHLY':
      case 'CUSTOM':
      default:
        next.setMonth(next.getMonth() + 1);
        break;
    }
    return next;
  }

  private isFlagTruthy(flag: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes((flag ?? '').trim().toLowerCase());
  }

  private overdueReminderIntervalHours(): number {
    return this.positiveIntConfig(
      'AUTOMATION_OVERDUE_REMINDER_INTERVAL_HOURS',
      DEFAULT_OVERDUE_REMINDER_INTERVAL_HOURS,
    );
  }

  private lowStockAlertIntervalHours(): number {
    return this.positiveIntConfig(
      'AUTOMATION_LOW_STOCK_ALERT_INTERVAL_HOURS',
      DEFAULT_LOW_STOCK_ALERT_INTERVAL_HOURS,
    );
  }

  private automationBatch(): number {
    return this.positiveIntConfig('AUTOMATION_DISPATCH_BATCH', DEFAULT_AUTOMATION_BATCH);
  }

  private positiveIntConfig(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key, ''));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
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
  automation?: AutomationDispatchResult;
  settled: Array<
    { jobId: string; status: 'fulfilled' } | { jobId: string; status: 'rejected'; reason: string }
  >;
};

/** Summary of a single automation pass (reminders / low-stock / reports). */
export type AutomationPassResult = {
  /** Rows that were claimed and acted on this tick. */
  processed: number;
  /** Rows examined as candidates (before idempotency/threshold filtering). */
  scanned?: number;
  /** Emails actually dispatched. */
  emailed?: number;
  /**
   * Rows deliberately skipped without consuming their due window (e.g. no
   * usable principal). These are NOT failures — the window is retried later.
   */
  skipped?: number;
  /** Present when the pass short-circuited (e.g. missing collaborator). */
  note?: string;
  /** Present when the pass threw; the tick still continues. */
  error?: string;
};

/** Aggregate result of one automation dispatch cycle. */
export type AutomationDispatchResult = {
  reminders: AutomationPassResult;
  lowStock: AutomationPassResult;
  scheduledReports: AutomationPassResult;
};
