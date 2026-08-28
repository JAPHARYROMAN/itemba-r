import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BackgroundJobPriority,
  BackgroundJobStatus,
  BackgroundJobType,
  MsaidiziHostActionStatus,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { redactSensitiveFields } from '../audit-logs/audit-logs.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { NotificationsService } from '../notifications/notifications.service';
import { MsaidiziScheduleDispatcherService } from './msaidizi-schedule-dispatcher.service';
import { MsaidiziAdaptiveReasoningService } from './msaidizi-adaptive-reasoning.service';
import { MsaidiziDevicesService } from '../msaidizi-devices/msaidizi-devices.service';
import {
  evaluateStepStopConditions,
  stepLocalIoState,
  StepStopEvaluation,
} from './msaidizi-step-controls';
import {
  FinishMsaidiziSpan,
  MsaidiziObservabilityService,
  MsaidiziSpan,
} from './msaidizi-observability.service';
import { authoritativeTaskWallTimeExceeded, taskWallTimeExceeded } from './msaidizi-task-wall-time';
import { MsaidiziRuntimeMemoryService } from '../msaidizi-memory/msaidizi-runtime-memory.service';

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_BATCH = 20;

/**
 * Advances durable task state and emits one retry unit per DAG step.
 * No complete task is ever submitted to the generic retry worker.
 */
@Injectable()
export class MsaidiziTaskDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MsaidiziTaskDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autonomy: AutonomyConfig,
    private readonly config: ConfigService,
    private readonly schedules?: MsaidiziScheduleDispatcherService,
    private readonly notifications?: NotificationsService,
    private readonly adaptiveReasoning?: MsaidiziAdaptiveReasoningService,
    @Optional() private readonly devices?: MsaidiziDevicesService,
    @Optional() private readonly observability?: MsaidiziObservabilityService,
    @Optional() private readonly runtimeMemory?: MsaidiziRuntimeMemoryService,
  ) {}

  onModuleInit(): void {
    if (!this.workerEnabled()) return;
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async dispatchOnce(batch = DEFAULT_BATCH): Promise<{
    started: number;
    processed: number;
    enqueued: number;
  }> {
    if (this.running || !this.workerEnabled()) {
      return { started: 0, processed: 0, enqueued: 0 };
    }
    this.running = true;
    let span: MsaidiziSpan | undefined;
    let traceResult: FinishMsaidiziSpan = {
      outcome: 'SUCCESS',
      outcomeCode: 'DISPATCH_COMPLETE',
      measurements: { started: 0, processed: 0, enqueued: 0 },
    };
    try {
      span = this.observability?.startSpan({ operation: 'msaidizi.dispatch.tick' });
    } catch {
      // Runtime telemetry is not part of the task state machine and must never
      // prevent a dispatch tick.
    }
    try {
      await this.reconcileTerminalMemory(batch);
      if (this.killSwitchActive()) {
        await this.reconcileGlobalKill();
        traceResult = {
          outcome: 'WARNING',
          outcomeCode: 'KILL_SWITCH_ACTIVE',
          measurements: { started: 0, processed: 0, enqueued: 0 },
        };
        return { started: 0, processed: 0, enqueued: 0 };
      }
      await this.schedules?.dispatchDueSchedules(batch);
      const started = await this.startQueued(batch);
      // This single database-owned checkpoint folds elapsed hard-clock time
      // before any dispatch decision. The trigger serializes concurrent ticks,
      // so restarts and overlapping workers cannot reset or double-count it.
      const checkpointedAt = new Date();
      await this.prisma.msaidiziTask.updateMany({
        where: {
          startedAt: { not: null },
          endedAt: null,
          status: {
            in: [
              MsaidiziTaskStatus.RUNNING,
              MsaidiziTaskStatus.PAUSING,
              MsaidiziTaskStatus.CANCELLING,
            ],
          },
        },
        data: { lastCheckpointAt: checkpointedAt },
      });
      const tasks = await this.prisma.msaidiziTask.findMany({
        where: {
          status: {
            in: [
              MsaidiziTaskStatus.RUNNING,
              MsaidiziTaskStatus.PAUSING,
              MsaidiziTaskStatus.CANCELLING,
            ],
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: batch,
      });
      let enqueued = 0;
      for (const task of tasks) enqueued += await this.advance(task);
      traceResult = {
        outcome: 'SUCCESS',
        outcomeCode: 'DISPATCH_COMPLETE',
        measurements: { started, processed: tasks.length, enqueued },
      };
      return { started, processed: tasks.length, enqueued };
    } catch (error) {
      traceResult = { outcome: 'FAILED', outcomeCode: 'DISPATCH_EXCEPTION' };
      throw error;
    } finally {
      this.running = false;
      if (span) await this.observability?.finishSpan(span, traceResult);
    }
  }

  private async reconcileTerminalMemory(batch: number): Promise<void> {
    try {
      await this.runtimeMemory?.reconcileTerminalOutcomes(batch);
    } catch {
      // Outcome capture is retryable housekeeping. It must neither move task
      // state nor prevent pause/cancel/dispatch progress, and raw exception
      // text is intentionally excluded from the durable/log boundary.
      this.logger.warn('Msaidizi terminal memory reconciliation deferred');
    }
  }

  /**
   * Converts the deployment-owned kill switch into durable pause/cancel state.
   * Repeated ticks repair crashes between the task CAS, queued-job cancellation,
   * lease revocation, and host-action settlement.
   */
  private async reconcileGlobalKill(): Promise<void> {
    await this.devices?.reconcileGlobalKill();
    const tasks = await this.prisma.msaidiziTask.findMany({
      where: {
        status: {
          in: [
            MsaidiziTaskStatus.QUEUED,
            MsaidiziTaskStatus.RUNNING,
            MsaidiziTaskStatus.PAUSING,
            MsaidiziTaskStatus.CANCELLING,
          ],
        },
      },
      select: { id: true, status: true, stateVersion: true },
      orderBy: { updatedAt: 'asc' },
    });
    const now = new Date();
    for (const task of tasks) {
      if (task.status === MsaidiziTaskStatus.QUEUED) {
        await this.prisma.$transaction(async (tx) => {
          const won = await tx.msaidiziTask.updateMany({
            where: {
              id: task.id,
              status: MsaidiziTaskStatus.QUEUED,
              stateVersion: task.stateVersion,
            },
            data: {
              status: MsaidiziTaskStatus.PAUSED,
              pauseRequestedAt: now,
              lastCheckpointAt: now,
              stateVersion: { increment: 1 },
            },
          });
          if (won.count === 1) {
            await this.event(tx, task.id, 'task.global_kill_paused', {
              priorStatus: MsaidiziTaskStatus.QUEUED,
            });
          }
        });
        continue;
      }
      if (task.status === MsaidiziTaskStatus.RUNNING) {
        const won = await this.prisma.$transaction(async (tx) => {
          const changed = await tx.msaidiziTask.updateMany({
            where: {
              id: task.id,
              status: MsaidiziTaskStatus.RUNNING,
              stateVersion: task.stateVersion,
            },
            data: {
              status: MsaidiziTaskStatus.PAUSING,
              pauseRequestedAt: now,
              lastCheckpointAt: now,
              stateVersion: { increment: 1 },
            },
          });
          if (changed.count === 1) {
            await this.event(tx, task.id, 'task.global_kill_requested', {
              priorStatus: MsaidiziTaskStatus.RUNNING,
            });
          }
          return changed.count === 1;
        });
        if (won) await this.pauseRemaining(task.id);
        continue;
      }
      if (task.status === MsaidiziTaskStatus.PAUSING) {
        await this.pauseRemaining(task.id);
      } else {
        // A pre-existing user cancellation remains cancellation; the kill
        // switch must not relabel it as a pause.
        await this.cancelRemaining(task.id);
      }
    }
  }

  private schedule(): void {
    this.timer = setTimeout(async () => {
      try {
        await this.dispatchOnce();
      } catch (error) {
        this.logger.error(`Msaidizi task dispatch failed: ${(error as Error).message}`);
      } finally {
        if (this.workerEnabled()) this.schedule();
      }
    }, this.intervalMs());
  }

  private async startQueued(batch: number): Promise<number> {
    // A previously started task can remain QUEUED after resume. Fold the
    // PAUSED/QUEUED interval using PostgreSQL's clock before inspecting its
    // hard ceiling; the application clock is not an authorization clock.
    await this.prisma.msaidiziTask.updateMany({
      where: {
        status: MsaidiziTaskStatus.QUEUED,
        startedAt: { not: null },
        endedAt: null,
      },
      data: { lastCheckpointAt: new Date() },
    });
    const queued = await this.prisma.msaidiziTask.findMany({
      where: { status: MsaidiziTaskStatus.QUEUED },
      orderBy: { queuedAt: 'asc' },
      take: batch,
      select: {
        id: true,
        stateVersion: true,
        mode: true,
        scheduleId: true,
        createdAt: true,
        startedAt: true,
        consumedWallTimeMs: true,
        wallTimeCheckpointAt: true,
        maxWallTimeSeconds: true,
        principal: { select: { status: true } },
        mandate: { select: { status: true, startsAt: true, expiresAt: true } },
        schedule: { select: { concurrencyMode: true } },
      },
    });
    let started = 0;
    for (const task of queued) {
      if (task.mode === 'AUTOPILOT' && !this.autonomy.autopilotEnabled) continue;
      const now = new Date();
      if (
        task.principal.status !== 'ACTIVE' ||
        (task.mode === 'AUTOPILOT' &&
          (!task.mandate ||
            task.mandate.status !== 'ACTIVE' ||
            (task.mandate.startsAt && task.mandate.startsAt > now) ||
            (task.mandate.expiresAt && task.mandate.expiresAt <= now)))
      ) {
        await this.rejectQueuedTask(task.id, task.stateVersion, 'AUTOPILOT_AUTHORITY_INACTIVE');
        continue;
      }
      if (this.wallBudgetExceeded(task)) {
        await this.rejectQueuedTask(
          task.id,
          task.stateVersion,
          'WALL_TIME_EXHAUSTED',
          'Task wall-time ceiling elapsed while the task was paused or queued',
        );
        continue;
      }
      const won = await this.prisma.$transaction(async (tx) => {
        if (task.scheduleId && task.schedule?.concurrencyMode === 'QUEUE') {
          // PostgreSQL row locking serializes this decision across application
          // workers. Without it two queued occurrences could both observe no
          // running predecessor and escape concurrently.
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "msaidizi_schedules" WHERE "id" = ${task.scheduleId} FOR UPDATE`,
          );
          const predecessor = await tx.msaidiziTask.count({
            where: {
              scheduleId: task.scheduleId,
              id: { not: task.id },
              OR: [
                {
                  status: {
                    in: [
                      MsaidiziTaskStatus.RUNNING,
                      MsaidiziTaskStatus.PAUSING,
                      MsaidiziTaskStatus.PAUSED,
                      MsaidiziTaskStatus.CANCELLING,
                      MsaidiziTaskStatus.NEEDS_ATTENTION,
                    ],
                  },
                },
                {
                  status: MsaidiziTaskStatus.QUEUED,
                  OR: [
                    { createdAt: { lt: task.createdAt } },
                    { createdAt: task.createdAt, id: { lt: task.id } },
                  ],
                },
              ],
            },
          });
          if (predecessor > 0) return false;
        }
        const changed = await tx.msaidiziTask.updateMany({
          where: {
            id: task.id,
            status: MsaidiziTaskStatus.QUEUED,
            stateVersion: task.stateVersion,
            startedAt: task.startedAt,
          },
          data: {
            status: MsaidiziTaskStatus.RUNNING,
            ...(task.startedAt ? {} : { startedAt: now }),
            wallTimeCheckpointAt: now,
            lastCheckpointAt: now,
            stateVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) return false;
        await this.event(tx, task.id, 'task.running', {
          startedAt: (task.startedAt ?? now).toISOString(),
          ...(task.startedAt ? { resumedAt: now.toISOString() } : {}),
        });
        return true;
      });
      if (won) started += 1;
    }
    return started;
  }

  private async rejectQueuedTask(
    taskId: string,
    stateVersion: number,
    failureCode: string,
    statusDetail = 'Autopilot authority became inactive before task start',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziTask.updateMany({
        where: {
          id: taskId,
          status: MsaidiziTaskStatus.QUEUED,
          stateVersion,
        },
        data: {
          status: MsaidiziTaskStatus.NEEDS_ATTENTION,
          failureCode,
          statusDetail,
          endedAt: new Date(),
          wallTimeCheckpointAt: null,
          stateVersion: { increment: 1 },
        },
      });
      if (won.count === 1) {
        await this.event(tx, taskId, 'task.dispatch_rejected', { failureCode });
        await this.notifications?.notifyMsaidiziTaskTerminal(
          tx,
          taskId,
          MsaidiziTaskStatus.NEEDS_ATTENTION,
        );
      }
    });
  }

  private async advance(task: {
    id: string;
    status: MsaidiziTaskStatus;
    activePlanVersion: number;
    startedAt: Date | null;
    consumedWallTimeMs: bigint;
    wallTimeCheckpointAt: Date | null;
    maxWallTimeSeconds: number;
    attemptedToolCalls: number;
    maxAttemptedToolCalls: number;
    mutations: number;
    maxMutations: number;
  }): Promise<number> {
    // Reconcile a worker that died after claiming a step before honoring a
    // pause/cancel request. Otherwise a dead mutation can remain RUNNING
    // forever and a cancellation can hide its unknown external outcome.
    if (await this.reconcileDeadStepJobs(task.id)) return 0;
    if (task.status === MsaidiziTaskStatus.CANCELLING) {
      await this.cancelRemaining(task.id);
      return 0;
    }
    if (task.status === MsaidiziTaskStatus.PAUSING) {
      await this.pauseRemaining(task.id);
      return 0;
    }
    if (this.wallBudgetExceeded(task)) {
      await this.finishTask(task.id, MsaidiziTaskStatus.NEEDS_ATTENTION, 'WALL_TIME_EXHAUSTED');
      return 0;
    }
    const steps = await this.prisma.msaidiziTaskStep.findMany({
      where: { taskId: task.id, planVersion: { version: task.activePlanVersion } },
      orderBy: { sequence: 'asc' },
      include: {
        toolAttempts: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
          select: { resultSummary: true },
        },
      },
    });
    const invalidIo = steps.find((step) => {
      const state = stepLocalIoState(step);
      return (
        !state.ok ||
        (state.remaining !== null &&
          (state.remaining < 0n ||
            (state.remaining === 0n &&
              step.status !== MsaidiziTaskStepStatus.SUCCEEDED &&
              step.status !== MsaidiziTaskStepStatus.FAILED &&
              step.status !== MsaidiziTaskStepStatus.CANCELLED &&
              step.status !== MsaidiziTaskStepStatus.SKIPPED &&
              step.status !== MsaidiziTaskStepStatus.NEEDS_ATTENTION)))
      );
    });
    if (invalidIo) {
      await this.finishTask(
        task.id,
        MsaidiziTaskStatus.NEEDS_ATTENTION,
        'STEP_LOCAL_IO_ACCOUNTING_INVALID',
      );
      return 0;
    }
    const committedStop = committedStepStop(steps);
    if ('invalidCode' in committedStop.evaluation) {
      await this.finishTask(
        task.id,
        MsaidiziTaskStatus.NEEDS_ATTENTION,
        committedStop.evaluation.invalidCode,
      );
      return 0;
    }
    if (committedStop.stepId && committedStop.evaluation.reached) {
      await this.stopForCondition(task.id, committedStop.stepId);
      return 0;
    }
    if (task.attemptedToolCalls >= task.maxAttemptedToolCalls) {
      await this.finishTask(task.id, MsaidiziTaskStatus.NEEDS_ATTENTION, 'TOOL_BUDGET_EXHAUSTED');
      return 0;
    }
    if (
      this.adaptiveReasoning &&
      (await this.adaptiveReasoning.gate(task.id, task.activePlanVersion)) === 'BLOCKED'
    ) {
      return 0;
    }
    const byKey = new Map(steps.map((step) => [step.stepKey, step]));

    for (const step of steps.filter((candidate) => candidate.status === 'PENDING')) {
      const dependencies = stringArray(step.dependencies);
      const states = dependencies.map((key) => byKey.get(key)?.status);
      if (states.some((state) => !state)) {
        await this.markStep(step.id, MsaidiziTaskStepStatus.NEEDS_ATTENTION);
      } else if (states.some((state) => terminalDependencyFailure(state!))) {
        await this.markStep(step.id, MsaidiziTaskStepStatus.SKIPPED);
      } else if (states.every((state) => state === MsaidiziTaskStepStatus.SUCCEEDED)) {
        await this.markStep(step.id, MsaidiziTaskStepStatus.READY);
      }
    }

    const refreshed = await this.prisma.msaidiziTaskStep.findMany({
      where: { taskId: task.id, planVersion: { version: task.activePlanVersion } },
      orderBy: { sequence: 'asc' },
    });
    if (refreshed.some((step) => step.status === MsaidiziTaskStepStatus.NEEDS_ATTENTION)) {
      await this.finishTask(task.id, MsaidiziTaskStatus.NEEDS_ATTENTION, 'STEP_NEEDS_ATTENTION');
      return 0;
    }

    let enqueued = 0;
    let mutationSlots = Math.max(0, task.maxMutations - task.mutations);
    for (const step of refreshed.filter((candidate) => candidate.status === 'READY')) {
      if (step.mutation && mutationSlots <= 0) {
        await this.finishTask(
          task.id,
          MsaidiziTaskStatus.NEEDS_ATTENTION,
          'MUTATION_BUDGET_EXHAUSTED',
        );
        break;
      }
      if (await this.enqueueStep(task.id, step)) {
        enqueued += 1;
        if (step.mutation) mutationSlots -= 1;
        // Deliberately one in-flight step per task in the first rollout. A
        // write with an unknown outcome must be able to stop every later step;
        // parallel siblings would already have escaped by the time it reports.
        break;
      }
    }

    await this.finalizeIfSettled(task.id, refreshed);
    return enqueued;
  }

  private async enqueueStep(
    taskId: string,
    step: { id: string; idempotent: boolean; mutation: boolean },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // The task row is the cross-replica mutex for its DAG. Selection may have
      // started from a stale READY snapshot, so under the lock revalidate both
      // the task state and the one-in-flight-step invariant before the step CAS.
      const locked = await tx.$queryRaw<Array<{ status: MsaidiziTaskStatus }>>(
        Prisma.sql`SELECT "status" FROM "msaidizi_tasks" WHERE "id" = ${taskId} FOR UPDATE`,
      );
      if (locked[0]?.status !== MsaidiziTaskStatus.RUNNING) return false;
      const activeSibling = await tx.msaidiziTaskStep.count({
        where: {
          taskId,
          status: {
            in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING],
          },
        },
      });
      if (activeSibling > 0) return false;

      const won = await tx.msaidiziTaskStep.updateMany({
        where: { id: step.id, status: MsaidiziTaskStepStatus.READY },
        data: { status: MsaidiziTaskStepStatus.LEASED },
      });
      if (won.count !== 1) return false;

      await tx.backgroundJob.upsert({
        where: { idempotencyKey: `msaidizi-step:${step.id}` },
        update: {},
        create: {
          jobNumber: `MS-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
          jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
          queueName: 'msaidizi-task-steps',
          status: BackgroundJobStatus.QUEUED,
          priority: BackgroundJobPriority.NORMAL,
          payload: {
            kind: 'msaidizi-task-step/v1',
            taskId,
            stepId: step.id,
            maxAttempts: step.idempotent && !step.mutation ? 3 : 1,
          },
          maxAttempts: step.idempotent && !step.mutation ? 3 : 1,
          idempotencyKey: `msaidizi-step:${step.id}`,
          correlationId: taskId,
          scheduledAt: new Date(),
        },
      });
      await this.event(tx, taskId, 'step.enqueued', { stepId: step.id });
      return true;
    });
  }

  private async pauseRemaining(taskId: string): Promise<void> {
    await this.cancelQueuedStepJobs(taskId);
    await this.prisma.msaidiziTaskStep.updateMany({
      where: { taskId, status: MsaidiziTaskStepStatus.LEASED },
      data: { status: MsaidiziTaskStepStatus.READY },
    });
    const inFlight = await this.prisma.msaidiziTaskStep.count({
      where: {
        taskId,
        status: MsaidiziTaskStepStatus.RUNNING,
        OR: [
          // ERP steps have no host action and must finish before pausing.
          { hostActions: { none: {} } },
          // A host action already handed to a device is the current step and
          // may finish. A merely QUEUED action has not escaped the broker and
          // can remain staged while the task is PAUSED.
          {
            hostActions: {
              some: {
                status: { in: ['DISPATCHED', 'RUNNING'] },
              },
            },
          },
        ],
      },
    });
    if (inFlight === 0) await this.finishTask(taskId, MsaidiziTaskStatus.PAUSED, null);
  }

  private async cancelRemaining(taskId: string): Promise<void> {
    // Cancellation can be reached directly from kill-switch reconciliation,
    // bypassing advance(). Reconcile dead mutation leases first so an unknown
    // write can never be relabelled as a clean cancellation.
    await this.reconcileDeadStepJobs(taskId);
    await this.cancelQueuedStepJobs(taskId);
    await this.devices?.cancelUndispatchedTaskActions(taskId);
    await this.prisma.msaidiziTaskStep.updateMany({
      where: {
        taskId,
        status: {
          in: [
            MsaidiziTaskStepStatus.PENDING,
            MsaidiziTaskStepStatus.READY,
            MsaidiziTaskStepStatus.LEASED,
          ],
        },
      },
      data: { status: MsaidiziTaskStepStatus.CANCELLED, endedAt: new Date() },
    });
    const runningJobs = await this.prisma.backgroundJob.findMany({
      where: {
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        correlationId: taskId,
        status: BackgroundJobStatus.RUNNING,
      },
      select: { payload: true },
    });
    const protectedStepIds = Array.from(
      new Set(
        runningJobs
          .map((job) => jsonString(job.payload, 'stepId'))
          .filter((stepId): stepId is string => Boolean(stepId)),
      ),
    );
    // A transient read failure leaves its step RUNNING while the generic job is
    // RETRYING. Once cancellation has cancelled that queued retry, no worker is
    // left to settle the step. Close only provably non-mutating orphaned reads;
    // live worker leases and device-crossed host actions remain in flight.
    await this.prisma.msaidiziTaskStep.updateMany({
      where: {
        taskId,
        mutation: false,
        status: MsaidiziTaskStepStatus.RUNNING,
        ...(protectedStepIds.length > 0 ? { id: { notIn: protectedStepIds } } : {}),
        hostActions: {
          none: {
            status: {
              in: [MsaidiziHostActionStatus.DISPATCHED, MsaidiziHostActionStatus.RUNNING],
            },
          },
        },
      },
      data: {
        status: MsaidiziTaskStepStatus.CANCELLED,
        checkpointedAt: new Date(),
        endedAt: new Date(),
      },
    });
    const inFlight = await this.prisma.msaidiziTaskStep.count({
      where: { taskId, status: MsaidiziTaskStepStatus.RUNNING },
    });
    if (inFlight === 0) await this.finishTask(taskId, MsaidiziTaskStatus.CANCELLED, null);
  }

  /**
   * Revalidates a deterministic stop condition while holding the task mutex,
   * then skips every undispatched successor in the same atomic transition.
   */
  private async stopForCondition(taskId: string, stepId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: MsaidiziTaskStatus }>>(
        Prisma.sql`SELECT "status" FROM "msaidizi_tasks" WHERE "id" = ${taskId} FOR UPDATE`,
      );
      if (locked[0]?.status !== MsaidiziTaskStatus.RUNNING) return false;
      const inFlight = await tx.msaidiziTaskStep.count({
        where: {
          taskId,
          status: { in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING] },
        },
      });
      if (inFlight > 0) return false;
      const step = await tx.msaidiziTaskStep.findFirst({
        where: { id: stepId, taskId },
        include: {
          toolAttempts: {
            orderBy: { attemptNumber: 'desc' },
            take: 1,
            select: { resultSummary: true },
          },
        },
      });
      if (!step) return false;
      const evaluation = evaluateStepStopConditions(step.stopConditions, {
        status: step.status,
        attemptCount: step.attemptCount,
        resultSummary: step.toolAttempts[0]?.resultSummary ?? null,
      });
      if (!evaluation.reached) return false;

      const now = new Date();
      await tx.msaidiziTaskStep.updateMany({
        where: {
          taskId,
          id: { not: stepId },
          status: { in: [MsaidiziTaskStepStatus.PENDING, MsaidiziTaskStepStatus.READY] },
        },
        data: {
          status: MsaidiziTaskStepStatus.SKIPPED,
          checkpointedAt: now,
          endedAt: now,
        },
      });
      const terminalStatus =
        step.status === MsaidiziTaskStepStatus.SUCCEEDED
          ? MsaidiziTaskStatus.COMPLETED
          : MsaidiziTaskStatus.PARTIAL;
      const won = await tx.msaidiziTask.updateMany({
        where: { id: taskId, status: MsaidiziTaskStatus.RUNNING },
        data: {
          status: terminalStatus,
          failureCode:
            terminalStatus === MsaidiziTaskStatus.COMPLETED ? null : 'STEP_STOP_CONDITION_REACHED',
          statusDetail: evaluation.code,
          endedAt: now,
          wallTimeCheckpointAt: null,
          lastCheckpointAt: now,
          stateVersion: { increment: 1 },
        },
      });
      if (won.count !== 1) return false;
      await this.event(tx, taskId, 'task.stop_condition_reached', {
        stepId,
        code: evaluation.code,
        status: terminalStatus,
      });
      await this.notifications?.notifyMsaidiziTaskTerminal(tx, taskId, terminalStatus);
      return true;
    });
  }

  private async cancelQueuedStepJobs(taskId: string): Promise<void> {
    await this.prisma.backgroundJob.updateMany({
      where: {
        jobType: {
          in: [
            BackgroundJobType.MSAIDIZI_TASK_STEP,
            'MSAIDIZI_REASONING_CHECKPOINT' as BackgroundJobType,
          ],
        },
        correlationId: taskId,
        status: { in: [BackgroundJobStatus.QUEUED, BackgroundJobStatus.RETRYING] },
      },
      data: { status: BackgroundJobStatus.CANCELLED, completedAt: new Date() },
    });
  }

  /**
   * A worker can die after dispatch but before settling the step. Generic stale
   * recovery only knows BackgroundJob; this maps its terminal lease back to the
   * task semantics, treating every mutation as an unknown outcome.
   */
  private async reconcileDeadStepJobs(taskId: string): Promise<boolean> {
    const jobs = await this.prisma.backgroundJob.findMany({
      where: {
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        correlationId: taskId,
        status: BackgroundJobStatus.DEAD_LETTER,
      },
      select: { id: true, payload: true, errorMessage: true },
    });
    let changed = false;
    for (const job of jobs) {
      const stepId = jsonString(job.payload, 'stepId');
      if (!stepId) continue;
      const step = await this.prisma.msaidiziTaskStep.findFirst({
        where: {
          id: stepId,
          taskId,
          status: { in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING] },
          // Once queueHostAction commits, the device state machine—not the
          // short-lived step job—owns the durable mutation. A worker dying
          // after that handoff must not relabel the live action as unknown.
          hostActions: {
            none: {
              status: {
                in: [
                  MsaidiziHostActionStatus.QUEUED,
                  MsaidiziHostActionStatus.DISPATCHED,
                  MsaidiziHostActionStatus.RUNNING,
                ],
              },
            },
          },
        },
        select: { id: true, mutation: true },
      });
      if (!step) continue;
      const reconciled = await this.prisma.$transaction(async (tx) => {
        const next = step.mutation
          ? MsaidiziTaskStepStatus.NEEDS_ATTENTION
          : MsaidiziTaskStepStatus.FAILED;
        const stepWon = await tx.msaidiziTaskStep.updateMany({
          where: {
            id: step.id,
            taskId,
            status: { in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING] },
          },
          data: { status: next, endedAt: new Date() },
        });
        // A still-running handler can settle between the discovery read above
        // and this transaction. Its terminal state is authoritative; losing
        // this CAS means there is no dead step left to reconcile.
        if (stepWon.count !== 1) return false;
        if (step.mutation) {
          const latest = await tx.msaidiziToolAttempt.findFirst({
            where: { taskId, stepId: step.id },
            orderBy: { attemptNumber: 'desc' },
            select: { id: true, status: true, resultSummary: true },
          });
          if (latest) {
            const reservation = activeErpEgressReservation(latest.resultSummary);
            const attemptData: Prisma.MsaidiziToolAttemptUpdateManyMutationInput = {
              status: MsaidiziToolAttemptStatus.UNKNOWN,
              uncertainOutcome: true,
              errorCode: 'WORKER_LEASE_LOST',
              errorMessage: job.errorMessage ? redactSensitiveFields(job.errorMessage) : undefined,
              endedAt: new Date(),
              ...(reservation !== null
                ? {
                    resultSummary: deadWorkerEgressSummary(
                      reservation,
                      latest.status === MsaidiziToolAttemptStatus.RUNNING,
                    ),
                  }
                : {}),
            };
            const unsettled =
              latest.status === MsaidiziToolAttemptStatus.REQUESTED ||
              latest.status === MsaidiziToolAttemptStatus.RUNNING;
            if (reservation !== null && unsettled) {
              // RUNNING is the durable proof that dispatch could have escaped;
              // without a receipt its whole reservation is charged. REQUESTED
              // is provably pre-dispatch and may release the exact reservation.
              const attemptWon = await tx.msaidiziToolAttempt.updateMany({
                where: { id: latest.id, status: latest.status },
                data: attemptData,
              });
              if (attemptWon.count !== 1) {
                throw new Error('Dead ERP egress attempt reconciliation CAS lost');
              }
              const escaped = latest.status === MsaidiziToolAttemptStatus.RUNNING;
              const taskAccountingWon = await tx.msaidiziTask.updateMany({
                where: {
                  id: taskId,
                  reservedExternalEgressBytes: { gte: BigInt(reservation) },
                },
                data: {
                  reservedExternalEgressBytes: { decrement: BigInt(reservation) },
                  ...(escaped ? { externalEgressBytes: { increment: BigInt(reservation) } } : {}),
                  lastCheckpointAt: new Date(),
                },
              });
              if (taskAccountingWon.count !== 1) {
                throw new Error('Dead ERP egress task accounting CAS lost');
              }
              await this.event(tx, taskId, 'tool.egress_reconciled', {
                stepId: step.id,
                attemptId: latest.id,
                reservedExternalEgressBytes: reservation,
                chargedExternalEgressBytes: escaped ? reservation : 0,
                reason: escaped ? 'ERP_EGRESS_RECEIPT_MISSING' : 'RELEASED_BEFORE_DISPATCH',
              });
            } else if (unsettled) {
              const attemptWon = await tx.msaidiziToolAttempt.updateMany({
                where: { id: latest.id, status: latest.status },
                data: attemptData,
              });
              if (attemptWon.count !== 1) {
                throw new Error('Dead mutation attempt reconciliation CAS lost');
              }
            }
          }
          const taskWon = await tx.msaidiziTask.updateMany({
            where: {
              id: taskId,
              status: {
                in: [
                  MsaidiziTaskStatus.RUNNING,
                  MsaidiziTaskStatus.PAUSING,
                  MsaidiziTaskStatus.CANCELLING,
                ],
              },
            },
            data: {
              status: MsaidiziTaskStatus.NEEDS_ATTENTION,
              failureCode: 'UNKNOWN_WRITE_OUTCOME',
              statusDetail: 'Worker lease ended before mutation outcome was recorded',
              endedAt: new Date(),
              wallTimeCheckpointAt: null,
              stateVersion: { increment: 1 },
            },
          });
          if (taskWon.count === 1) {
            await this.notifications?.notifyMsaidiziTaskTerminal(
              tx,
              taskId,
              MsaidiziTaskStatus.NEEDS_ATTENTION,
            );
          }
        }
        await this.event(tx, taskId, step.mutation ? 'step.outcome_unknown' : 'step.failed', {
          stepId: step.id,
          jobId: job.id,
          reason: 'WORKER_LEASE_LOST',
        });
        return true;
      });
      changed = reconciled || changed;
    }
    return changed;
  }

  private async finalizeIfSettled(
    taskId: string,
    snapshot: Array<{ status: MsaidiziTaskStepStatus }>,
  ): Promise<void> {
    if (snapshot.length === 0 || snapshot.some((step) => activeStep(step.status))) return;
    if (snapshot.every((step) => step.status === MsaidiziTaskStepStatus.SUCCEEDED)) {
      await this.finishTask(taskId, MsaidiziTaskStatus.COMPLETED, null);
      return;
    }
    const someSuccess = snapshot.some((step) => step.status === MsaidiziTaskStepStatus.SUCCEEDED);
    await this.finishTask(
      taskId,
      someSuccess ? MsaidiziTaskStatus.PARTIAL : MsaidiziTaskStatus.FAILED,
      'STEP_FAILED',
    );
  }

  private async finishTask(
    taskId: string,
    status: MsaidiziTaskStatus,
    failureCode: string | null,
  ): Promise<void> {
    const expectedSource = terminalSourceState(status);
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziTask.updateMany({
        where: {
          id: taskId,
          status: expectedSource,
        },
        data: {
          status,
          failureCode,
          lastCheckpointAt: new Date(),
          ...(terminalTask(status) ? { endedAt: new Date(), wallTimeCheckpointAt: null } : {}),
          stateVersion: { increment: 1 },
        },
      });
      if (won.count === 1) {
        await this.event(tx, taskId, 'task.status_changed', { to: status, failureCode });
        if (notifiableTask(status)) {
          await this.notifications?.notifyMsaidiziTaskTerminal(tx, taskId, status);
        }
      }
    });
  }

  private async markStep(id: string, status: MsaidiziTaskStepStatus): Promise<void> {
    const terminal = !activeStep(status);
    await this.prisma.msaidiziTaskStep.updateMany({
      where: { id, status: MsaidiziTaskStepStatus.PENDING },
      data: {
        status,
        ...(terminal ? { checkpointedAt: new Date(), endedAt: new Date() } : {}),
      },
    });
  }

  private async event(
    tx: Prisma.TransactionClient,
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type,
        actorType: 'SERVICE',
        payload: redactSensitiveFields(payload) as Prisma.InputJsonObject,
      },
    });
  }

  private wallBudgetExceeded(task: {
    startedAt: Date | null;
    consumedWallTimeMs: bigint;
    wallTimeCheckpointAt: Date | null;
    maxWallTimeSeconds: number;
  }): boolean {
    // An unstarted task has no open interval; only its persisted counter can
    // be evaluated. Every started task reaches this method immediately after a
    // database-owned checkpoint and must carry that authoritative anchor.
    return task.startedAt === null
      ? taskWallTimeExceeded(task, 0)
      : authoritativeTaskWallTimeExceeded(task);
  }

  private workerEnabled(): boolean {
    return (
      this.autonomy.enabled &&
      truthy(this.config.get<string>('MSAIDIZI_TASK_WORKER_ENABLED', 'false')) &&
      truthy(this.config.get<string>('JOB_WORKER_ENABLED', 'false'))
    );
  }

  private killSwitchActive(): boolean {
    return truthy(this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'));
  }

  private intervalMs(): number {
    const value = Number(
      this.config.get<string>('MSAIDIZI_TASK_DISPATCH_INTERVAL_MS', String(DEFAULT_INTERVAL_MS)),
    );
    return Number.isSafeInteger(value) && value >= 250 ? value : DEFAULT_INTERVAL_MS;
  }
}

function terminalSourceState(status: MsaidiziTaskStatus): MsaidiziTaskStatus {
  if (status === MsaidiziTaskStatus.PAUSED) return MsaidiziTaskStatus.PAUSING;
  if (status === MsaidiziTaskStatus.CANCELLED) return MsaidiziTaskStatus.CANCELLING;
  return MsaidiziTaskStatus.RUNNING;
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function terminalDependencyFailure(status: MsaidiziTaskStepStatus): boolean {
  return new Set<MsaidiziTaskStepStatus>([
    MsaidiziTaskStepStatus.FAILED,
    MsaidiziTaskStepStatus.CANCELLED,
    MsaidiziTaskStepStatus.SKIPPED,
    MsaidiziTaskStepStatus.NEEDS_ATTENTION,
  ]).has(status);
}

function activeStep(status: MsaidiziTaskStepStatus): boolean {
  return new Set<MsaidiziTaskStepStatus>([
    MsaidiziTaskStepStatus.PENDING,
    MsaidiziTaskStepStatus.READY,
    MsaidiziTaskStepStatus.LEASED,
    MsaidiziTaskStepStatus.RUNNING,
  ]).has(status);
}

function terminalTask(status: MsaidiziTaskStatus): boolean {
  return new Set<MsaidiziTaskStatus>([
    MsaidiziTaskStatus.COMPLETED,
    MsaidiziTaskStatus.PARTIAL,
    MsaidiziTaskStatus.FAILED,
    MsaidiziTaskStatus.CANCELLED,
    MsaidiziTaskStatus.NEEDS_ATTENTION,
  ]).has(status);
}

function notifiableTask(
  status: MsaidiziTaskStatus,
): status is Extract<MsaidiziTaskStatus, 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NEEDS_ATTENTION'> {
  return new Set<MsaidiziTaskStatus>([
    MsaidiziTaskStatus.COMPLETED,
    MsaidiziTaskStatus.PARTIAL,
    MsaidiziTaskStatus.FAILED,
    MsaidiziTaskStatus.NEEDS_ATTENTION,
  ]).has(status);
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function jsonString(value: Prisma.JsonValue | null, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Prisma.JsonObject)[key];
  return typeof candidate === 'string' ? candidate : null;
}

/** Reads only the exact reservation shape written before ERP dispatch. */
function activeErpEgressReservation(value: Prisma.JsonValue | null): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Prisma.JsonObject).externalEgress;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const egress = raw as Prisma.JsonObject;
  const expectedKeys = [
    'chargedExternalEgressBytes',
    'metering',
    'reservedExternalEgressBytes',
    'settlementStatus',
  ];
  const actualKeys = Object.keys(egress).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    egress.settlementStatus !== 'RESERVED' ||
    egress.metering !== 'adapter-receipt-v1' ||
    egress.chargedExternalEgressBytes !== 0 ||
    !Number.isSafeInteger(egress.reservedExternalEgressBytes) ||
    Number(egress.reservedExternalEgressBytes) <= 0
  ) {
    return null;
  }
  return Number(egress.reservedExternalEgressBytes);
}

function deadWorkerEgressSummary(
  reservedExternalEgressBytes: number,
  escaped: boolean,
): Prisma.InputJsonObject {
  return {
    externalEgress: {
      settlementStatus: escaped ? 'SETTLED' : 'RELEASED_BEFORE_DISPATCH',
      metering: 'adapter-receipt-v1',
      verified: false,
      reservedExternalEgressBytes,
      chargedExternalEgressBytes: escaped ? reservedExternalEgressBytes : 0,
      errorCode: escaped ? 'ERP_EGRESS_RECEIPT_MISSING' : 'RELEASED_BEFORE_DISPATCH',
    },
  };
}

function committedStepStop(
  steps: Array<{
    id: string;
    status: MsaidiziTaskStepStatus;
    attemptCount: number;
    stopConditions?: Prisma.JsonValue;
    toolAttempts?: Array<{ resultSummary: Prisma.JsonValue | null }>;
  }>,
): { stepId: string | null; evaluation: StepStopEvaluation } {
  for (const step of steps) {
    if (
      !new Set<MsaidiziTaskStepStatus>([
        MsaidiziTaskStepStatus.SUCCEEDED,
        MsaidiziTaskStepStatus.FAILED,
      ]).has(step.status) ||
      !step.stopConditions ||
      typeof step.stopConditions !== 'object' ||
      Array.isArray(step.stopConditions) ||
      Object.keys(step.stopConditions).length === 0
    ) {
      continue;
    }
    const evaluation = evaluateStepStopConditions(step.stopConditions, {
      status: step.status,
      attemptCount: step.attemptCount,
      resultSummary: step.toolAttempts?.[0]?.resultSummary ?? null,
    });
    if (evaluation.reached || 'invalidCode' in evaluation) {
      return { stepId: step.id, evaluation };
    }
  }
  return { stepId: null, evaluation: { reached: false } };
}
