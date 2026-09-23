/**
 * Real PostgreSQL dispatcher transitions, locks and restart reconstruction.
 * Seeds durable states directly: this is not HTTP authorization or host/ERP
 * execution evidence. No worker timer, model, device or ERP invoker is started.
 */
import { ConfigService } from '@nestjs/config';
import { MsaidiziTaskStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PersistenceSecretGuard } from '../src/common/services/persistence-secret-guard.service';
import { EphemeralSecretFingerprintRegistry } from '../src/common/services/ephemeral-secret-fingerprint-registry.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AutonomyConfig } from '../src/modules/msaidizi-tasks/autonomy.config';
import { MsaidiziTaskDispatcherService } from '../src/modules/msaidizi-task-runtime/msaidizi-task-dispatcher.service';
import { MsaidiziTaskStepHandler } from '../src/modules/msaidizi-task-runtime/msaidizi-task-step.handler';
import { JobHandlerRegistry } from '../src/modules/job-worker/job-handler.registry';
import { ManifestProvider } from '../src/modules/msaidizi/manifest.provider';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { MsaidiziScheduleDispatcherService } from '../src/modules/msaidizi-task-runtime/msaidizi-schedule-dispatcher.service';
import { resolveStepInputs } from '../src/modules/msaidizi-tasks/msaidizi-input-bindings';
import { msaidiziScheduleVersionSnapshot } from '../src/modules/msaidizi-control-plane/msaidizi-version-history';
import { MsaidiziAdaptiveReasoningService } from '../src/modules/msaidizi-task-runtime/msaidizi-adaptive-reasoning.service';
import { ModelUsage } from '../src/modules/msaidizi/model-client';

type DispatcherTransitions = {
  enqueueStep(
    taskId: string,
    step: { id: string; mutation: boolean; idempotent: boolean },
  ): Promise<boolean>;
  pauseRemaining(taskId: string): Promise<void>;
  cancelRemaining(taskId: string): Promise<void>;
  reconcileDeadStepJobs(taskId: string): Promise<boolean>;
  finishTask(taskId: string, status: MsaidiziTaskStatus, failureCode: string | null): Promise<void>;
};

const describeDisposable =
  process.env.MSAIDIZI_CHAT_DISPOSABLE_DB === '1' ? describe : describe.skip;
describeDisposable('Msaidizi dispatcher persistence (disposable PostgreSQL)', () => {
  let prisma: PrismaService;
  let principalId: string;
  const config = new ConfigService({
    MSAIDIZI_AUTONOMY_ENABLED: 'false',
    MSAIDIZI_TASK_WORKER_ENABLED: 'false',
    JOB_WORKER_ENABLED: 'false',
  });
  const connect = async () => {
    prisma = new PrismaService(
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    );
    await prisma.$connect();
  };
  const dispatcher = () =>
    new MsaidiziTaskDispatcherService(
      prisma,
      new AutonomyConfig(config),
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AuditLogsService(prisma),
    ) as unknown as DispatcherTransitions;

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !/^\/msaidizi_chat_proof(?:_[a-z0-9]+)?$/.test(target.pathname)
    ) {
      throw new Error('Requires a dedicated local msaidizi_chat_proof[_suffix] database.');
    }
    await connect();
    const principal = await prisma.msaidiziPrincipal.create({
      data: {
        key: `persistence-proof-${randomUUID()}`,
        displayName: 'Disposable persistence proof',
        grants: {},
      },
    });
    principalId = principal.id;
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function fixture(mutation = false, stepCount = 1, idempotent = true) {
    const task = await prisma.msaidiziTask.create({
      data: {
        principalId,
        mode: 'COLLABORATIVE',
        title: 'Persistence proof',
        objective: 'Verify durable dispatcher transitions without external execution',
      },
    });
    const plan = await prisma.msaidiziPlanVersion.create({
      data: {
        taskId: task.id,
        version: 1,
        summary: 'Dispatcher fixture',
        objective: task.objective,
        inputs: {},
        stopConditions: {},
        budgetSnapshot: {},
        planDigest: 'a'.repeat(64),
      },
    });
    const steps = await Promise.all(
      Array.from({ length: stepCount }, (_, sequence) =>
        prisma.msaidiziTaskStep.create({
          data: {
            taskId: task.id,
            planVersionId: plan.id,
            stepKey: `step-${sequence + 1}`,
            sequence: sequence + 1,
            name: 'Fixture step',
            capability: 'PersistenceProofController.operation',
            arguments: { path: {}, query: {}, body: null },
            dependencies: [],
            expectedEffect: mutation ? 'WRITE' : 'READ',
            dataClass: 'business_records',
            preconditions: {},
            budgets: {},
            stopConditions: {},
            idempotent,
            mutation,
            status: 'READY',
          },
        }),
      ),
    );
    // Database-owned first start avoids Windows JS/DB clock precision skew.
    // This initializes a fresh fixture; it never rewrites a spent task clock.
    await prisma.$executeRaw(Prisma.sql`UPDATE "msaidizi_tasks"
      SET "status" = 'RUNNING', "activePlanVersion" = 1,
          "startedAt" = GREATEST("createdAt", clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${task.id} AND "startedAt" IS NULL`);
    return { task, steps };
  }
  const jobFor = (stepId: string) =>
    prisma.backgroundJob.findUniqueOrThrow({
      where: { idempotencyKey: `msaidizi-step:${stepId}` },
    });

  const reasoningRecovery = (failNotification = false) =>
    new MsaidiziAdaptiveReasoningService(
      prisma,
      new JobHandlerRegistry(),
      new AutonomyConfig(config),
      config,
      {
        createMessage: () => {
          throw new Error('No model allowed in persistence proof');
        },
      } as never,
      undefined as never,
      undefined as never,
      failNotification
        ? ({
            notifyMsaidiziTaskTerminal: async () => {
              throw new Error('Injected recovery notification failure');
            },
          } as never)
        : undefined,
    ) as unknown as {
      reconcileDeadTurns(taskId: string): Promise<void>;
      resumeUnstartedCheckpoint(taskId: string, turnId: string, planVersion: number): Promise<void>;
      reconcileKnownUsage(
        tx: Prisma.TransactionClient,
        turnId: string,
        taskId: string,
        usage: ModelUsage,
        actualCostUsd: number,
        reservedCostUsd: number,
      ): Promise<void>;
    };

  it.each([
    'queued',
    'completed-noop',
    'claimed-noop',
    'still-paused',
    'stale-plan',
    'foreign-turn',
    'reserved',
    'receipt',
    'wrong-payload',
    'wrong-key',
    'leased',
    'attempted',
    'cancelled-without-pause',
    'completed-without-pause',
    'rollback',
  ] as const)('resumes only proven unstarted reasoning checkpoints: %s', async (variant) => {
    const {
      task,
      steps: [step],
    } = await fixture();
    const turn = await prisma.msaidiziReasoningTurn.create({
      data: {
        taskId: task.id,
        planVersionId: step.planVersionId,
        checkpointStepId: step.id,
        status: 'QUEUED',
        inputDigest: 'f'.repeat(64),
        inputByteSize: 1000,
      },
    });
    const job = await prisma.backgroundJob.create({
      data: {
        jobNumber: `PAUSE-${randomUUID()}`,
        jobType: 'MSAIDIZI_REASONING_CHECKPOINT',
        queueName: 'msaidizi-reasoning',
        correlationId: task.id,
        status: 'QUEUED',
        maxAttempts: 1,
        idempotencyKey: `msaidizi-reasoning:${step.planVersionId}:${step.id}`,
        payload: { kind: 'msaidizi-runtime-checkpoint/v1', taskId: task.id, turnId: turn.id },
      },
    });
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
    if (variant === 'claimed-noop') {
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', leaseOwner: randomUUID(), startedAt: new Date() },
      });
      await dispatcher().pauseRemaining(task.id);
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        { status: 'PAUSING' },
      );
      expect(await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject(
        { status: 'RUNNING', leaseOwner: expect.any(String) },
      );
      // Model-free handler return, followed by the owned worker's completion CAS.
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          leaseOwner: null,
          completedAt: new Date(),
          result: { skipped: true, reason: 'task is PAUSING' },
        },
      });
    }
    await dispatcher().pauseRemaining(task.id);
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'PAUSED',
      modelTurns: 0,
    });
    expect(
      await prisma.msaidiziReasoningTurn.findUniqueOrThrow({ where: { id: turn.id } }),
    ).toEqual(turn);
    await prisma.msaidiziTask.update({
      where: { id: task.id },
      data: { status: variant === 'still-paused' ? 'PAUSED' : 'RUNNING' },
    });
    if (variant === 'completed-noop' || variant === 'completed-without-pause')
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          result:
            variant === 'completed-noop'
              ? { skipped: true, reason: 'task is PAUSED' }
              : { ok: true },
        },
      });
    if (variant === 'cancelled-without-pause')
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { result: Prisma.DbNull } });
    if (variant === 'wrong-payload')
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          payload: {
            kind: 'msaidizi-runtime-checkpoint/v1',
            taskId: task.id,
            turnId: randomUUID(),
          },
        },
      });
    if (variant === 'wrong-key')
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { idempotencyKey: randomUUID() },
      });
    if (variant === 'leased')
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { leaseOwner: randomUUID() },
      });
    if (variant === 'attempted')
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { attempts: 1 } });
    if (variant === 'reserved')
      await prisma.msaidiziReasoningTurn.update({
        where: { id: turn.id },
        data: { reservedCostUsd: 1, startedAt: new Date() },
      });
    if (variant === 'receipt')
      await prisma.msaidiziTaskEvent.create({
        data: {
          taskId: task.id,
          type: 'reasoning.model_call_accounted',
          actorType: 'SYSTEM',
          payload: { turnId: turn.id },
        },
      });
    const before = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    const recovery = reasoningRecovery();
    if (variant === 'rollback')
      (recovery as unknown as { event: () => Promise<void> }).event = async () => {
        throw new Error('Injected pause ledger failure');
      };
    const otherTaskId = variant === 'foreign-turn' ? (await fixture()).task.id : task.id;
    const resume = () =>
      recovery.resumeUnstartedCheckpoint(otherTaskId, turn.id, variant === 'stale-plan' ? 2 : 1);
    if (variant === 'rollback')
      await expect(resume()).rejects.toThrow('Injected pause ledger failure');
    else await Promise.all([resume(), resume()]);
    const success =
      variant === 'queued' || variant === 'completed-noop' || variant === 'claimed-noop';
    const after = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    if (success)
      expect(after).toMatchObject({
        status: 'QUEUED',
        attempts: 0,
        maxAttempts: 1,
        result: null,
        leaseOwner: null,
        completedAt: null,
        payload: job.payload,
        idempotencyKey: job.idempotencyKey,
      });
    else expect(after).toEqual(before);
    expect(
      await prisma.msaidiziTaskEvent.count({
        where: { taskId: task.id, type: 'reasoning.checkpoint_resumed_before_dispatch' },
      }),
    ).toBe(success ? 1 : 0);
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      modelTurns: 0,
      modelCostUsd: new Prisma.Decimal(0),
      status:
        variant === 'still-paused'
          ? 'PAUSED'
          : success || ['stale-plan', 'foreign-turn', 'rollback'].includes(variant)
            ? 'RUNNING'
            : 'NEEDS_ATTENTION',
    });
  });

  it.each([false, true])(
    'accounts a cancelled reasoning response once across concurrent receipt replay (zero=%s)',
    async (zero) => {
      const {
        task,
        steps: [step],
      } = await fixture();
      await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: { status: 'CANCELLED', modelTurns: 1, modelCostUsd: 2 },
      });
      const turn = await prisma.msaidiziReasoningTurn.create({
        data: {
          taskId: task.id,
          planVersionId: step.planVersionId,
          checkpointStepId: step.id,
          status: 'CANCELLED',
          inputDigest: 'f'.repeat(64),
          inputByteSize: 1000,
          reservedCostUsd: 2,
          reservedInputTokens: 1020n,
          reservedOutputTokens: 100n,
          startedAt: new Date(),
          errorCode: 'REASONING_TASK_CANCELLED',
        },
      });
      const account = () =>
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${task.id} FOR UPDATE`,
          );
          await reasoningRecovery().reconcileKnownUsage(
            tx,
            turn.id,
            task.id,
            {
              inputTokens: zero ? 0 : 1000,
              outputTokens: zero ? 0 : 100,
              cacheReadInputTokens: zero ? 0 : 20,
              cacheCreationInputTokens: 0,
            },
            zero ? 0 : 1.25,
            2,
          );
        });
      await Promise.all([account(), account()]);
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: 'CANCELLED',
          modelTurns: 1,
          inputTokens: zero ? 0n : 1020n,
          outputTokens: zero ? 0n : 100n,
          modelCostUsd: new Prisma.Decimal(zero ? 0 : 1.25),
        },
      );
      expect(
        await prisma.msaidiziReasoningTurn.findUniqueOrThrow({ where: { id: turn.id } }),
      ).toMatchObject({ status: 'CANCELLED', errorCode: 'REASONING_TASK_CANCELLED' });
      expect(
        await prisma.msaidiziTaskEvent.count({
          where: { taskId: task.id, type: 'reasoning.model_call_accounted' },
        }),
      ).toBe(1);
    },
  );

  it.each([
    'foreign-task',
    'reservation',
    'unreserved',
    'conflict',
    'missing-receipt',
    'rollback',
    'overflow',
  ] as const)(
    'fences reasoning usage receipts and rolls back invalid accounting: %s',
    async (variant) => {
      const {
        task,
        steps: [step],
      } = await fixture();
      const other = await fixture();
      await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: { modelTurns: 1, modelCostUsd: 2 },
      });
      const turn = await prisma.msaidiziReasoningTurn.create({
        data: {
          taskId: task.id,
          planVersionId: step.planVersionId,
          checkpointStepId: step.id,
          status: 'RUNNING',
          inputDigest: 'f'.repeat(64),
          inputByteSize: 1000,
          reservedCostUsd: 2,
          reservedInputTokens: 1000n,
          reservedOutputTokens: 100n,
          startedAt: variant === 'unreserved' ? null : new Date(),
          inputTokens: variant === 'missing-receipt' ? 1n : 0n,
        },
      });
      const usage = {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
      const service = reasoningRecovery();
      const account = (initial = false) =>
        prisma.$transaction(async (tx) => {
          const owner = variant === 'foreign-task' ? other.task.id : task.id;
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${owner} FOR UPDATE`,
          );
          await service.reconcileKnownUsage(
            tx,
            turn.id,
            owner,
            variant === 'overflow'
              ? { ...usage, inputTokens: Number.MAX_SAFE_INTEGER, cacheReadInputTokens: 1 }
              : usage,
            variant === 'conflict' && !initial ? 1.5 : 1.25,
            variant === 'reservation' ? 3 : 2,
          );
        });
      if (variant === 'conflict') await account(true);
      if (variant === 'rollback')
        (service as unknown as { event: () => Promise<void> }).event = async () => {
          throw new Error('Injected usage ledger failure');
        };
      const beforeTask = await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } });
      const beforeOther = await prisma.msaidiziTask.findUniqueOrThrow({
        where: { id: other.task.id },
      });
      const beforeTurn = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
        where: { id: turn.id },
      });
      await expect(account()).rejects.toThrow(/REASONING_USAGE_|Injected usage ledger failure/);
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toEqual(
        beforeTask,
      );
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: other.task.id } })).toEqual(
        beforeOther,
      );
      expect(
        await prisma.msaidiziReasoningTurn.findUniqueOrThrow({ where: { id: turn.id } }),
      ).toEqual(beforeTurn);
      expect(
        await prisma.msaidiziTaskEvent.count({
          where: { taskId: task.id, type: 'reasoning.model_call_accounted' },
        }),
      ).toBe(variant === 'conflict' ? 1 : 0);
    },
  );

  it.each([
    'queued',
    'running',
    'dead',
    'cancelled-job',
    'missing-job',
    'foreign-payload',
    'wrong-key',
    'completed-turn',
    'rollback',
    'not-cancelling',
  ] as const)(
    'atomically cancels owned reasoning without refunding unknown usage: %s',
    async (variant) => {
      const {
        task,
        steps: [step],
      } = await fixture();
      const queued = variant === 'queued';
      const beforeTask = await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: {
          status: variant === 'not-cancelling' ? 'RUNNING' : 'CANCELLING',
          modelTurns: queued ? 0 : 1,
          modelCostUsd: queued ? 0 : 2,
        },
      });
      const turn = await prisma.msaidiziReasoningTurn.create({
        data: {
          taskId: task.id,
          planVersionId: step.planVersionId,
          checkpointStepId: step.id,
          status: queued ? 'QUEUED' : variant === 'completed-turn' ? 'SUCCEEDED' : 'RUNNING',
          inputDigest: 'e'.repeat(64),
          inputByteSize: 500,
          reservedCostUsd: queued ? 0 : 2,
          reservedInputTokens: queued ? 0n : 500n,
          reservedOutputTokens: queued ? 0n : 100n,
        },
      });
      const job =
        variant === 'missing-job'
          ? null
          : await prisma.backgroundJob.create({
              data: {
                jobNumber: `reasoning-cancel-${randomUUID()}`,
                jobType: 'MSAIDIZI_REASONING_CHECKPOINT',
                queueName: 'msaidizi-reasoning',
                correlationId: task.id,
                maxAttempts: 1,
                status: queued
                  ? 'QUEUED'
                  : variant === 'dead'
                    ? 'DEAD_LETTER'
                    : variant === 'cancelled-job'
                      ? 'CANCELLED'
                      : 'RUNNING',
                leaseOwner:
                  !queued && !['dead', 'cancelled-job'].includes(variant)
                    ? 'proof-live-owner'
                    : null,
                idempotencyKey:
                  variant === 'wrong-key'
                    ? randomUUID()
                    : `msaidizi-reasoning:${step.planVersionId}:${step.id}`,
                payload: {
                  kind: 'msaidizi-runtime-checkpoint/v1',
                  taskId: variant === 'foreign-payload' ? randomUUID() : task.id,
                  turnId: turn.id,
                },
              },
            });
      const service = dispatcher();
      if (variant === 'rollback') {
        service.finishTask = async () => {
          throw new Error('Injected cancellation settlement failure');
        };
        await expect(service.cancelRemaining(task.id)).rejects.toThrow(
          'Injected cancellation settlement failure',
        );
      } else
        await Promise.all([
          service.cancelRemaining(task.id),
          dispatcher().cancelRemaining(task.id),
        ]);
      const afterTurn = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
        where: { id: turn.id },
      });
      const afterTask = await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } });
      const settles = ['queued', 'running', 'dead', 'cancelled-job'].includes(variant);
      expect(afterTurn).toEqual(
        settles
          ? expect.objectContaining({
              id: turn.id,
              status: 'CANCELLED',
              errorCode: 'REASONING_TASK_CANCELLED',
              reservedCostUsd: turn.reservedCostUsd,
              reservedInputTokens: turn.reservedInputTokens,
              reservedOutputTokens: turn.reservedOutputTokens,
              inputTokens: 0n,
              outputTokens: 0n,
            })
          : turn,
      );
      expect(afterTask).toMatchObject({
        status: settles || variant === 'completed-turn' ? 'CANCELLED' : beforeTask.status,
        modelTurns: beforeTask.modelTurns,
        modelCostUsd: beforeTask.modelCostUsd,
      });
      if (job) {
        const afterJob = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
        if (settles && variant !== 'dead')
          expect(afterJob).toMatchObject({ status: 'CANCELLED', leaseOwner: null });
        else expect(afterJob).toEqual(job);
      }
      expect(
        await prisma.msaidiziTaskEvent.count({
          where: { taskId: task.id, type: 'reasoning.checkpoint_cancelled' },
        }),
      ).toBe(settles ? 1 : 0);
      expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(0);
      if (variant === 'rollback') {
        expect(afterTask).toEqual(beforeTask);
        expect(await prisma.msaidiziTaskEvent.count({ where: { taskId: task.id } })).toBe(0);
        expect(await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).toEqual(
          step,
        );
      }
    },
  );

  it.each([
    'positive',
    'cancelled',
    'pausing',
    'pausing-rollback',
    'payload-task',
    'foreign-turn',
    'wrong-key',
    'wrong-kind',
    'live-owner',
    'stale-plan',
    'checkpoint-plan',
    'settled',
    'rollback',
  ] as const)(
    'scopes dead reasoning recovery and retains model reservations: %s',
    async (variant) => {
      const {
        task,
        steps: [step],
      } = await fixture();
      const other = await fixture();
      await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: {
          modelTurns: 1,
          modelCostUsd: 2,
          ...(variant === 'cancelled' ? { status: 'CANCELLED' as const } : {}),
          ...(variant === 'pausing' || variant === 'pausing-rollback'
            ? { status: 'PAUSING' as const }
            : {}),
        },
      });
      const plan2 =
        variant === 'stale-plan' || variant === 'checkpoint-plan'
          ? await prisma.msaidiziPlanVersion.create({
              data: {
                taskId: task.id,
                version: 2,
                summary: 'New reviewed version',
                objective: task.objective,
                inputs: {},
                stopConditions: {},
                budgetSnapshot: {},
                planDigest: 'c'.repeat(64),
              },
            })
          : null;
      if (variant === 'stale-plan' || variant === 'checkpoint-plan')
        await prisma.msaidiziTask.update({
          where: { id: task.id },
          data: { activePlanVersion: 2 },
        });
      const turn = await prisma.msaidiziReasoningTurn.create({
        data: {
          taskId: variant === 'foreign-turn' ? other.task.id : task.id,
          planVersionId:
            variant === 'foreign-turn'
              ? other.steps[0].planVersionId
              : variant === 'checkpoint-plan'
                ? plan2!.id
                : step.planVersionId,
          checkpointStepId: variant === 'foreign-turn' ? other.steps[0].id : step.id,
          status: variant === 'settled' ? 'SUCCEEDED' : 'RUNNING',
          inputDigest: 'd'.repeat(64),
          inputByteSize: 500,
          reservedCostUsd: 2,
          reservedInputTokens: 500n,
          reservedOutputTokens: 100n,
        },
      });
      await prisma.backgroundJob.create({
        data: {
          jobNumber: `reasoning-proof-${randomUUID()}`,
          jobType: 'MSAIDIZI_REASONING_CHECKPOINT',
          queueName: 'msaidizi-reasoning',
          status: 'DEAD_LETTER',
          attempts: 1,
          maxAttempts: 1,
          correlationId: task.id,
          idempotencyKey:
            variant === 'wrong-key'
              ? randomUUID()
              : `msaidizi-reasoning:${step.planVersionId}:${step.id}`,
          leaseOwner: variant === 'live-owner' ? 'still-owned' : null,
          payload: {
            kind: variant === 'wrong-kind' ? 'unknown-protocol' : 'msaidizi-runtime-checkpoint/v1',
            taskId: variant === 'payload-task' ? other.task.id : task.id,
            turnId: turn.id,
          },
        },
      });
      const beforeTask = await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } });
      if (variant === 'rollback' || variant === 'pausing-rollback') {
        await expect(reasoningRecovery(true).reconcileDeadTurns(task.id)).rejects.toThrow(
          'Injected recovery notification failure',
        );
      } else {
        await Promise.all([
          reasoningRecovery().reconcileDeadTurns(task.id),
          reasoningRecovery().reconcileDeadTurns(task.id),
        ]);
      }
      const positive = variant === 'positive' || variant === 'cancelled' || variant === 'pausing';
      const afterTurn = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
        where: { id: turn.id },
      });
      const afterTask = await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } });
      if (positive) {
        expect(afterTurn).toMatchObject({
          status: 'FAILED',
          errorCode: 'REASONING_WORKER_LEASE_LOST',
          reservedCostUsd: turn.reservedCostUsd,
          reservedInputTokens: 500n,
          reservedOutputTokens: 100n,
          inputTokens: 0n,
          outputTokens: 0n,
          actualCostUsd: turn.actualCostUsd,
        });
        expect(afterTask).toMatchObject({
          status: variant === 'cancelled' ? 'CANCELLED' : 'NEEDS_ATTENTION',
          modelTurns: 1,
          modelCostUsd: beforeTask.modelCostUsd,
        });
      } else {
        expect(afterTurn).toEqual(turn);
        expect(afterTask).toEqual(beforeTask);
      }
      expect(
        await prisma.msaidiziTaskEvent.count({
          where: { taskId: task.id, type: 'reasoning.worker_lease_lost' },
        }),
      ).toBe(positive ? 1 : 0);
      expect(await prisma.msaidiziTaskEvent.count({ where: { taskId: other.task.id } })).toBe(0);
      expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(0);
    },
  );

  it.each(['schedule-edit', 'mandate-budget', 'mandate-revoke'])(
    'rejects a stale routine after %s without consuming its occurrence',
    async (change) => {
      const user = await prisma.user.create({
        data: {
          email: `schedule-race-${randomUUID()}@itemba.invalid`,
          fullName: 'Schedule race fixture',
          passwordHash: 'not-a-login-credential',
        },
      });
      const mandate = await prisma.msaidiziMandate.create({
        data: {
          principalId,
          createdByUserId: user.id,
          name: 'Schedule race proof',
          description: 'Read-only isolated fixture',
          status: 'ACTIVE',
          capabilities: [
            {
              capability: 'ExpensesController.findAll',
              effects: ['READ'],
              dataClasses: ['internal'],
            },
          ],
          budgets: {},
          deviceIds: [],
        },
      });
      const template = {
        title: 'Old routine',
        objective: 'Read expenses',
        inputs: { page: 2 },
        steps: [
          {
            key: 'read',
            name: 'Read expenses',
            target: 'ERP',
            capability: 'ExpensesController.findAll',
            capabilityVersion: '1',
            arguments: { path: {}, query: { page: null } },
            inputBindings: [
              {
                targetPath: '/query/page',
                source: { kind: 'PLAN_INPUT', path: '/page' },
                dataClass: 'internal',
                expectedType: 'integer',
                expectedSchema: { type: 'integer', minimum: 1 },
                transform: { name: 'IDENTITY', version: '1' },
              },
            ],
            dependsOn: [],
            expectedEffect: 'READ',
            dataClass: 'internal',
            preconditions: {},
            budgets: {},
            stopConditions: {},
            mutation: false,
            idempotent: true,
          },
        ],
      };
      const due = new Date('2026-09-04T05:00:00Z');
      const stale = await prisma.msaidiziSchedule.create({
        data: {
          principalId,
          mandateId: mandate.id,
          createdByUserId: user.id,
          name: 'Schedule race proof',
          status: 'ACTIVE',
          cronExpression: '0 8 * * *',
          timezone: 'Africa/Nairobi',
          nextRunAt: due,
          taskTemplate: template,
        },
        include: { principal: { select: { status: true } }, mandate: true },
      });
      // Persist the same pause/edit/reactivate version changes as the control API.
      // No task/controller/host executor is started in this database-only proof.
      if (change === 'schedule-edit') {
        await prisma.msaidiziSchedule.update({
          where: { id: stale.id },
          data: { status: 'PAUSED', version: { increment: 1 } },
        });
        await prisma.msaidiziSchedule.update({
          where: { id: stale.id },
          data: {
            taskTemplate: { ...template, title: 'Reviewed routine' },
            version: { increment: 1 },
          },
        });
        await prisma.msaidiziSchedule.update({
          where: { id: stale.id },
          data: { status: 'ACTIVE', version: { increment: 1 } },
          include: { principal: { select: { status: true } }, mandate: true },
        });
      } else {
        await prisma.msaidiziMandate.update({
          where: { id: mandate.id },
          data: {
            version: { increment: 1 },
            ...(change === 'mandate-revoke'
              ? { status: 'REVOKED' as const }
              : { budgets: { maxAttemptedToolCalls: 2 } }),
          },
        });
      }
      const reviewed = await prisma.msaidiziSchedule.findUniqueOrThrow({
        where: { id: stale.id },
        include: { principal: { select: { status: true } }, mandate: true },
      });
      const routineConfig = new ConfigService({
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_AUTOPILOT_ENABLED: 'true',
        JOB_WORKER_ENABLED: 'true',
        MSAIDIZI_TASK_WORKER_ENABLED: 'true',
        MSAIDIZI_AUTONOMY_GRANTS: 'expenses.view',
      });
      const routine = new MsaidiziScheduleDispatcherService(
        prisma,
        new AutonomyConfig(routineConfig),
        routineConfig,
        new AuditLogsService(prisma),
      ) as unknown as {
        dispatchOccurrence(schedule: typeof stale, now: Date): Promise<string>;
      };
      expect(await routine.dispatchOccurrence(stale, due)).toBe('skipped');
      expect(await prisma.msaidiziTask.count({ where: { scheduleId: stale.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityId: stale.id } })).toBe(0);
      expect(
        (await prisma.msaidiziSchedule.findUniqueOrThrow({ where: { id: stale.id } })).nextRunAt,
      ).toEqual(due);
      if (change === 'mandate-revoke') {
        await expect(routine.dispatchOccurrence(reviewed, due)).rejects.toThrow('not active');
        return;
      }
      expect(await routine.dispatchOccurrence(reviewed, due)).toBe('dispatched');
      expect(await routine.dispatchOccurrence(reviewed, due)).toBe('skipped');
      const tasks = await prisma.msaidiziTask.findMany({ where: { scheduleId: stale.id } });
      expect(tasks).toHaveLength(1);
      const persistedStep = await prisma.msaidiziTaskStep.findFirstOrThrow({
        where: { taskId: tasks[0].id },
      });
      expect(persistedStep.inputBindings).toEqual(template.steps[0].inputBindings);
      expect(persistedStep.arguments).toEqual(template.steps[0].arguments);
      const bindingAttempt = await prisma.msaidiziToolAttempt.create({
        data: {
          taskId: tasks[0].id,
          stepId: persistedStep.id,
          attemptNumber: 1,
          toolName: persistedStep.capability,
          argumentsRedacted: {},
          argsDigest: 'a'.repeat(64),
          idempotencyKey: randomUUID(),
          status: 'REQUESTED',
        },
      });
      const resolved = await resolveStepInputs(
        prisma,
        tasks[0].id,
        persistedStep.id,
        bindingAttempt.id,
      );
      expect(resolved.arguments).toEqual({ path: {}, query: { page: 2 } });
      expect(resolved.provenance).toMatchObject({
        bindings: [
          {
            targetPath: '/query/page',
            instructionAuthority: false,
            trustLevel: 'REVIEWED_REFERENCE',
          },
        ],
      });
      // No actual tool dispatch occurs in this direct binding-resolution proof.
      await prisma.msaidiziToolAttempt.update({
        where: { id: bindingAttempt.id },
        data: { status: 'FAILED', errorCode: 'BINDING_FIXTURE_NO_DISPATCH', endedAt: new Date() },
      });
      expect(tasks[0]).toMatchObject({
        title: change === 'schedule-edit' ? 'Reviewed routine' : 'Old routine',
        status: 'QUEUED',
      });
      if (change === 'mandate-budget') expect(tasks[0].maxAttemptedToolCalls).toBe(2);
      const event = await prisma.msaidiziTaskEvent.findFirstOrThrow({
        where: { taskId: tasks[0].id, type: 'task.created' },
      });
      const authority = {
        protocol: 'MSAIDIZI_SCHEDULE_AUTHORITY_V1',
        principalId,
        companyId: mandate.companyId,
        scheduleId: stale.id,
        scheduleVersion: reviewed.version,
        scheduleUpdatedAt: reviewed.updatedAt.toISOString(),
        mandateId: mandate.id,
        mandateVersion: reviewed.mandate.version,
        mandateUpdatedAt: reviewed.mandate.updatedAt.toISOString(),
      };
      expect(event.payload).toMatchObject({ creationAuthority: authority });
      const evidence = await prisma.auditLog.findFirstOrThrow({
        where: { taskId: tasks[0].id, action: 'MSAIDIZI_SCHEDULE_DISPATCH' },
      });
      expect(evidence.newValue).toMatchObject({ creationAuthority: authority });
      // Later authority changes must not silently rewrite historical attribution.
      await prisma.msaidiziMandate.update({
        where: { id: mandate.id },
        data: { version: { increment: 1 }, status: 'REVOKED' },
      });
      await prisma.msaidiziSchedule.update({
        where: { id: stale.id },
        data: { version: { increment: 1 }, status: 'PAUSED' },
      });
      expect(
        (await prisma.msaidiziTaskEvent.findUniqueOrThrow({ where: { cursor: event.cursor } }))
          .payload,
      ).toEqual(event.payload);
      expect(
        (await prisma.auditLog.findUniqueOrThrow({ where: { id: evidence.id } })).newValue,
      ).toEqual(evidence.newValue);
      expect(
        await prisma.auditLog.count({
          where: { entityId: stale.id, action: 'MSAIDIZI_SCHEDULE_DISPATCH' },
        }),
      ).toBe(1);
    },
  );

  it('persists a scoped opaque reference and null placeholder in both routine and immutable version without storing a raw value', async () => {
    const id = randomUUID();
    const deviceId = randomUUID();
    const sha256 = createHash('sha256').update(id).digest('hex');
    const scope = {
      capability: 'browser.secret.set',
      capabilityVersion: '1',
      dataClass: 'confidential',
      deviceId,
    };
    const template = {
      title: 'Opaque reference proof',
      objective: 'Store a reference, never a credential',
      inputs: { reference: { id, sha256, scope: { ...scope } } },
      steps: [
        {
          key: 'reference',
          name: 'Reference',
          target: 'HOST',
          capability: scope.capability,
          capabilityVersion: '1',
          arguments: { secretReferenceId: null },
          dependsOn: [],
          expectedEffect: 'WRITE',
          mutation: true,
          idempotent: false,
          dataClass: 'confidential',
          preconditions: { deviceId },
          budgets: {},
          stopConditions: {},
          inputBindings: [
            {
              targetPath: '/secretReferenceId',
              source: {
                kind: 'SECRET_REFERENCE',
                path: '',
                secretReferenceId: id,
                secretReferenceSha256: sha256,
                scope,
              },
              dataClass: 'confidential',
              expectedType: 'string',
              expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
              transform: { name: 'IDENTITY', version: '1' },
            },
          ],
        },
      ],
    };
    const mandate = await prisma.msaidiziMandate.create({
      data: {
        principalId,
        name: 'Opaque fixture',
        description: 'Storage only; no device execution',
        capabilities: [],
        budgets: {},
        deviceIds: [],
      },
    });
    const saved = await prisma.msaidiziSchedule.create({
      data: {
        principalId,
        mandateId: mandate.id,
        name: 'Opaque fixture',
        cronExpression: '0 8 * * *',
        timezone: 'Africa/Nairobi',
        taskTemplate: template,
      },
      include: { mandate: { select: { companyId: true } } },
    });
    expect(saved.status).toBe('DRAFT');
    expect(saved.taskTemplate).toEqual(template);
    const version = await prisma.msaidiziScheduleVersion.create({
      data: msaidiziScheduleVersionSnapshot(saved, 'STORAGE_FIXTURE', null),
    });
    expect(version.taskTemplate).toEqual(template);
    const invalid = JSON.parse(JSON.stringify(template));
    invalid.steps[0].arguments.secretReferenceId = 'do-not-store-this-credential';
    await expect(
      prisma.msaidiziSchedule.update({ where: { id: saved.id }, data: { taskTemplate: invalid } }),
    ).rejects.toThrow();
    expect(
      (await prisma.msaidiziSchedule.findUniqueOrThrow({ where: { id: saved.id } })).taskTemplate,
    ).toEqual(template);
    expect(await prisma.msaidiziTask.count({ where: { scheduleId: saved.id } })).toBe(0);
  });

  it.each([false, true])(
    'resumes an unattempted paused job after reconnect (mutation=%s)',
    async (mutation) => {
      const {
        task,
        steps: [step],
      } = await fixture(mutation);
      expect(await dispatcher().enqueueStep(task.id, step)).toBe(true);
      const original = await jobFor(step.id);
      await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
      await dispatcher().pauseRemaining(task.id);
      expect((await jobFor(step.id)).status).toBe('CANCELLED');
      expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
        'PAUSED',
      );

      await prisma.$disconnect();
      await connect();
      // The resume API/start transition is not under test here.
      await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
      expect(await dispatcher().enqueueStep(task.id, step)).toBe(true);
      const resumed = await jobFor(step.id);
      expect(resumed.id).toBe(original.id);
      expect(resumed.status).toBe('QUEUED');
      expect(resumed.completedAt).toBeNull();
      expect(resumed.attempts).toBe(0);
      expect(resumed.maxAttempts).toBe(mutation ? 1 : 3);
      expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(0);
    },
  );

  it('serializes independent dispatcher claims using the task row lock', async () => {
    const { task, steps } = await fixture(false, 2);
    const results = await Promise.all(steps.map((step) => dispatcher().enqueueStep(task.id, step)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.backgroundJob.count({ where: { correlationId: task.id } })).toBe(1);
    expect(
      await prisma.msaidiziTaskStep.count({ where: { taskId: task.id, status: 'LEASED' } }),
    ).toBe(1);
    expect(
      await prisma.msaidiziTaskEvent.count({ where: { taskId: task.id, type: 'step.enqueued' } }),
    ).toBe(1);
  });

  it('re-arms a worker no-op completed before a paused mutation was attempted', async () => {
    const {
      task,
      steps: [step],
    } = await fixture(true);
    await dispatcher().enqueueStep(task.id, step);
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
    await prisma.backgroundJob.update({
      where: { id: (await jobFor(step.id)).id },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        leaseOwner: 'disposable-worker',
      },
    });
    await dispatcher().pauseRemaining(task.id);
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'PAUSING',
    );
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
    ).toBe('LEASED');
    await prisma.backgroundJob.update({
      where: { id: (await jobFor(step.id)).id },
      data: {
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
        leaseOwner: null,
        result: { skipped: true, reason: 'task is PAUSING' },
      },
    });
    await dispatcher().pauseRemaining(task.id);
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
    expect(await dispatcher().enqueueStep(task.id, step)).toBe(true);
    expect(await jobFor(step.id)).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: 1,
      result: null,
    });
  });

  it.each(['attempt-count', 'attempt-row', 'job-attempts', 'completed-effect'])(
    'cannot re-arm prior execution evidence (%s)',
    async (evidence) => {
      const {
        task,
        steps: [step],
      } = await fixture(true);
      await dispatcher().enqueueStep(task.id, step);
      const job = await jobFor(step.id);
      await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
      await dispatcher().pauseRemaining(task.id);
      if (evidence === 'attempt-count') {
        await prisma.msaidiziTaskStep.update({ where: { id: step.id }, data: { attemptCount: 1 } });
      } else if (evidence === 'attempt-row') {
        await prisma.msaidiziToolAttempt.create({
          data: {
            taskId: task.id,
            stepId: step.id,
            attemptNumber: 1,
            toolName: step.capability,
            argumentsRedacted: {},
            argsDigest: 'b'.repeat(64),
            idempotencyKey: randomUUID(),
            status: 'UNKNOWN',
          },
        });
      } else if (evidence === 'job-attempts') {
        await prisma.backgroundJob.update({ where: { id: job.id }, data: { attempts: 1 } });
      } else {
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', result: { ok: true } },
        });
      }
      await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
      await expect(dispatcher().enqueueStep(task.id, step)).rejects.toThrow(/Paused step job/);
      expect((await jobFor(step.id)).status).toBe(
        evidence === 'completed-effect' ? 'COMPLETED' : 'CANCELLED',
      );
      // The losing transaction cannot strand a step in LEASED or emit an enqueue.
      expect(
        (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
      ).toBe('READY');
      expect(
        await prisma.msaidiziTaskEvent.count({ where: { taskId: task.id, type: 'step.enqueued' } }),
      ).toBe(1);
    },
  );

  it.each(['RETRYING', 'COMPLETED'] as const)(
    'parks and resumes a settled read retry without resetting budgets (%s)',
    async (jobStatus) => {
      const {
        task,
        steps: [step],
      } = await fixture();
      await dispatcher().enqueueStep(task.id, step);
      const job = await jobFor(step.id);
      const startedAt = new Date();
      await prisma.msaidiziTaskStep.update({
        where: { id: step.id },
        data: {
          status: 'RUNNING',
          attemptCount: 1,
          startedAt,
        },
      });
      await prisma.msaidiziToolAttempt.create({
        data: {
          taskId: task.id,
          stepId: step.id,
          attemptNumber: 1,
          toolName: step.capability,
          argumentsRedacted: {},
          argsDigest: 'b'.repeat(64),
          idempotencyKey: randomUUID(),
          status: 'FAILED',
          errorCode: 'HTTP_503',
          endedAt: new Date(),
        },
      });
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: jobStatus,
          attempts: 1,
          ...(jobStatus === 'COMPLETED'
            ? { result: { skipped: true, reason: 'task is PAUSING' } }
            : {}),
        },
      });
      await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: {
          status: 'PAUSING',
          attemptedToolCalls: 1,
        },
      });
      await dispatcher().pauseRemaining(task.id);
      expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
        'PAUSED',
      );
      await prisma.$disconnect();
      await connect();
      await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
      expect(await dispatcher().enqueueStep(task.id, step)).toBe(true);
      expect(await jobFor(step.id)).toMatchObject({
        id: job.id,
        status: 'QUEUED',
        attempts: 1,
        maxAttempts: 3,
      });
      expect(
        await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } }),
      ).toMatchObject({
        status: 'LEASED',
        attemptCount: 1,
        startedAt,
      });
      expect(
        (await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } }))
          .attemptedToolCalls,
      ).toBe(1);
      expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: step.id } })).toBe(1);
    },
  );

  it.each([
    'UNKNOWN',
    'RUNNING',
    'SUCCEEDED',
    'permanent-error',
    'missing-attempt',
    'exhausted',
    'mutation',
    'completed-effect',
  ])('does not park or re-arm unsafe read retry evidence (%s)', async (evidence) => {
    const {
      task,
      steps: [step],
    } = await fixture(evidence === 'mutation');
    await dispatcher().enqueueStep(task.id, step);
    const job = await jobFor(step.id);
    const attempts = evidence === 'exhausted' ? 3 : 1;
    await prisma.msaidiziTaskStep.update({
      where: { id: step.id },
      data: {
        status: 'RUNNING',
        attemptCount: attempts,
        startedAt: new Date(),
      },
    });
    if (evidence !== 'missing-attempt') {
      for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber++) {
        await prisma.msaidiziToolAttempt.create({
          data: {
            taskId: task.id,
            stepId: step.id,
            attemptNumber,
            toolName: step.capability,
            argumentsRedacted: {},
            argsDigest: 'b'.repeat(64),
            idempotencyKey: randomUUID(),
            status:
              evidence === 'UNKNOWN'
                ? 'UNKNOWN'
                : evidence === 'RUNNING'
                  ? 'RUNNING'
                  : evidence === 'SUCCEEDED'
                    ? 'SUCCEEDED'
                    : 'FAILED',
            errorCode: evidence === 'permanent-error' ? 'HTTP_403' : 'HTTP_503',
            endedAt: evidence === 'RUNNING' ? null : new Date(),
          },
        });
      }
    }
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: evidence === 'completed-effect' ? 'COMPLETED' : 'RETRYING',
        attempts,
        ...(evidence === 'completed-effect' ? { result: { ok: true } } : {}),
      },
    });
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
    await dispatcher().pauseRemaining(task.id);
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'PAUSING',
    );
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
    ).toBe('RUNNING');
    expect(
      await prisma.msaidiziTaskEvent.count({
        where: { taskId: task.id, type: 'step.read_retry_paused' },
      }),
    ).toBe(0);
    // Even inconsistent READY state cannot bypass the same evidence barrier
    // on resume. Its failed transaction must roll back the step claim.
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
    await prisma.msaidiziTaskStep.update({ where: { id: step.id }, data: { status: 'READY' } });
    await expect(dispatcher().enqueueStep(task.id, step)).rejects.toThrow(/Paused step job/);
    expect((await jobFor(step.id)).attempts).toBe(attempts);
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
    ).toBe('READY');
  });

  it('ignores stale pause cleanup after a task has resumed', async () => {
    const {
      task,
      steps: [step],
    } = await fixture();
    await dispatcher().enqueueStep(task.id, step);
    const job = await jobFor(step.id);
    await dispatcher().pauseRemaining(task.id);
    expect((await jobFor(step.id)).status).toBe('QUEUED');
    expect((await jobFor(step.id)).id).toBe(job.id);
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
    ).toBe('LEASED');
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'RUNNING',
    );
  });

  it('rolls back pause cleanup if the durable event append fails', async () => {
    const {
      task,
      steps: [step],
    } = await fixture();
    await dispatcher().enqueueStep(task.id, step);
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
    const interrupted = dispatcher();
    (interrupted as unknown as { event: () => Promise<void> }).event = async () => {
      throw new Error('Injected event append failure');
    };
    await expect(interrupted.pauseRemaining(task.id)).rejects.toThrow(
      'Injected event append failure',
    );
    expect((await jobFor(step.id)).status).toBe('QUEUED');
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
    ).toBe('LEASED');
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'PAUSING',
    );
    await dispatcher().pauseRemaining(task.id);
    expect((await jobFor(step.id)).status).toBe('CANCELLED');
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
    ).toBe('READY');
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'PAUSED',
    );
    expect(
      await prisma.msaidiziTaskEvent.count({
        where: { taskId: task.id, type: 'task.status_changed' },
      }),
    ).toBe(1);
  });

  it.each([
    'current-owner',
    'stale-owner',
    'stale-generation',
    'missing-owner',
    'cancelled-task',
    'mutation',
    'non-idempotent',
    'unrecovered-job',
    'audit-failure',
  ])('fences abandoned read reconciliation and its atomic audit (%s)', async (scenario) => {
    const {
      task,
      steps: [step],
    } = await fixture(scenario === 'mutation', 1, scenario !== 'non-idempotent');
    await dispatcher().enqueueStep(task.id, step);
    const job = await jobFor(step.id);
    await prisma.msaidiziTaskStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', attemptCount: 1, startedAt: new Date() },
    });
    const attempt = await prisma.msaidiziToolAttempt.create({
      data: {
        taskId: task.id,
        stepId: step.id,
        attemptNumber: 1,
        toolName: step.capability,
        argumentsRedacted: {},
        argsDigest: 'b'.repeat(64),
        idempotencyKey: randomUUID(),
        status: 'RUNNING',
      },
    });
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        leaseOwner: 'current-owner',
        queueName: `read-recovery-fixture-${task.id}`,
        startedAt: new Date(),
        leaseHeartbeatAt: new Date(),
        attempts: scenario === 'unrecovered-job' ? 0 : scenario === 'stale-generation' ? 2 : 1,
      },
    });
    if (scenario === 'cancelled-task')
      await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'CANCELLING' } });
    const handler = new MsaidiziTaskStepHandler(
      prisma,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      {} as never,
      scenario === 'audit-failure'
        ? ({
            logStrictInTransaction: async () => {
              throw new Error('Injected read-recovery audit failure');
            },
          } as never)
        : new AuditLogsService(prisma),
    ) as unknown as {
      reconcileAbandonedRead(
        context: { jobId: string; leaseOwner?: string; attempts: number },
        taskId: string,
        stepId: string,
      ): Promise<boolean>;
    };
    const invoke = () =>
      handler.reconcileAbandonedRead(
        {
          jobId: job.id,
          attempts: 1,
          leaseOwner:
            scenario === 'missing-owner'
              ? undefined
              : scenario === 'stale-owner'
                ? 'former-owner'
                : 'current-owner',
        },
        task.id,
        step.id,
      );
    if (scenario === 'audit-failure')
      await expect(invoke()).rejects.toThrow('Injected read-recovery audit failure');
    else expect(await invoke()).toBe(scenario === 'current-owner');
    expect(
      (await prisma.msaidiziToolAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
    ).toBe(scenario === 'current-owner' ? 'FAILED' : 'RUNNING');
    expect(
      await prisma.msaidiziTaskEvent.count({
        where: { taskId: task.id, type: 'tool.read_attempt_reconciled' },
      }),
    ).toBe(scenario === 'current-owner' ? 1 : 0);
    if (scenario === 'current-owner') {
      expect(await invoke()).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { taskId: task.id, action: 'MSAIDIZI_ERP_ACTION_FAILED' },
        }),
      ).toBe(1);
    }
  });

  it.each([
    'cancel',
    'stale-cancel',
    'live-running',
    'live-leased',
    'mutation',
    'mismatched-job',
    'audit-failure',
    'missing-audit',
    'completed-cancel-noop',
    'completed-effect',
    'completed-wrong-reason',
  ])(
    'atomically settles cancelled orphan reads without stealing authority (%s)',
    async (scenario) => {
      const {
        task,
        steps: [step],
      } = await fixture(scenario === 'mutation');
      await dispatcher().enqueueStep(task.id, step);
      const job = await jobFor(step.id);
      const live = scenario.startsWith('live-');
      const completed = scenario.startsWith('completed-');
      const stepStatus = scenario === 'live-leased' ? 'LEASED' : 'RUNNING';
      await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: {
          status: scenario === 'stale-cancel' ? 'RUNNING' : 'CANCELLING',
          attemptedToolCalls: 1,
          bytesRead: 123n,
        },
      });
      await prisma.msaidiziTaskStep.update({
        where: { id: step.id },
        data: { status: stepStatus, attemptCount: 1, bytesRead: 123n },
      });
      const attempt = await prisma.msaidiziToolAttempt.create({
        data: {
          taskId: task.id,
          stepId: step.id,
          attemptNumber: 1,
          toolName: step.capability,
          argumentsRedacted: {},
          argsDigest: 'b'.repeat(64),
          idempotencyKey: randomUUID(),
          status: 'RUNNING',
        },
      });
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: live ? 'RUNNING' : completed ? 'COMPLETED' : 'RETRYING',
          attempts: 1,
          queueName: `cancel-recovery-fixture-${task.id}`,
          startedAt: new Date(),
          leaseHeartbeatAt: new Date(),
          ...(completed
            ? {
                result: {
                  skipped: true,
                  reason:
                    scenario === 'completed-wrong-reason'
                      ? 'task is PAUSING'
                      : 'task is CANCELLING',
                  ...(scenario === 'completed-effect' ? { ok: true } : {}),
                },
              }
            : {}),
          ...(scenario === 'mismatched-job' ? { idempotencyKey: `unbound-${randomUUID()}` } : {}),
        },
      });
      const audit =
        scenario === 'missing-audit'
          ? undefined
          : scenario === 'audit-failure'
            ? ({
                logStrictInTransaction: async () => {
                  throw new Error('Injected cancellation audit failure');
                },
              } as never)
            : new AuditLogsService(prisma);
      const service = new MsaidiziTaskDispatcherService(
        prisma,
        new AutonomyConfig(config),
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit,
      ) as unknown as DispatcherTransitions;
      const failingAudit = scenario === 'audit-failure' || scenario === 'missing-audit';
      if (failingAudit) await expect(service.cancelRemaining(task.id)).rejects.toThrow(/audit/);
      else await service.cancelRemaining(task.id);
      const won = scenario === 'cancel' || scenario === 'completed-cancel-noop';
      expect(
        await prisma.msaidiziToolAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
      ).toMatchObject({
        status: won ? 'FAILED' : 'RUNNING',
        ...(won ? { errorCode: 'READ_CANCELLED_AFTER_LEASE_LOSS' } : {}),
      });
      expect(
        await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } }),
      ).toMatchObject({
        status: won ? 'CANCELLED' : stepStatus,
        attemptCount: 1,
        bytesRead: 123n,
      });
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: won ? 'CANCELLED' : scenario === 'stale-cancel' ? 'RUNNING' : 'CANCELLING',
          attemptedToolCalls: 1,
          bytesRead: 123n,
        },
      );
      expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        live
          ? 'RUNNING'
          : completed
            ? 'COMPLETED'
            : failingAudit || scenario === 'stale-cancel'
              ? 'RETRYING'
              : 'CANCELLED',
      );
      if (won) await service.cancelRemaining(task.id);
      expect(
        await prisma.msaidiziTaskEvent.count({
          where: { taskId: task.id, type: 'tool.read_attempt_reconciled' },
        }),
      ).toBe(won ? 1 : 0);
      expect(
        await prisma.auditLog.count({
          where: { taskId: task.id, entityId: attempt.id, action: 'MSAIDIZI_ERP_ACTION_FAILED' },
        }),
      ).toBe(won ? 1 : 0);
    },
  );

  it.each([
    'running',
    'already-failed',
    'cancelling-task',
    'stale-job',
    'wrong-key',
    'wrong-task',
    'live-owner',
    'wrong-payload',
    'audit-failure',
    'settled-success',
    'mutation',
  ])('fences dead-read settlement and repairs its atomic ledger (%s)', async (scenario) => {
    const {
      task,
      steps: [step],
    } = await fixture(scenario === 'mutation');
    await dispatcher().enqueueStep(task.id, step);
    const job = await jobFor(step.id);
    const stepStatus =
      scenario === 'already-failed'
        ? 'FAILED'
        : scenario === 'settled-success'
          ? 'SUCCEEDED'
          : 'RUNNING';
    await prisma.msaidiziTask.update({
      where: { id: task.id },
      data: {
        attemptedToolCalls: 1,
        bytesRead: 123n,
        ...(scenario === 'cancelling-task' ? { status: 'CANCELLING' } : {}),
      },
    });
    await prisma.msaidiziTaskStep.update({
      where: { id: step.id },
      data: { status: stepStatus, attemptCount: 1, bytesRead: 123n },
    });
    const attempt = await prisma.msaidiziToolAttempt.create({
      data: {
        taskId: task.id,
        stepId: step.id,
        attemptNumber: 1,
        toolName: step.capability,
        argumentsRedacted: {},
        argsDigest: 'b'.repeat(64),
        idempotencyKey: randomUUID(),
        status: scenario === 'settled-success' ? 'SUCCEEDED' : 'RUNNING',
      },
    });
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: scenario === 'stale-job' ? 'RETRYING' : 'DEAD_LETTER',
        attempts: 1,
        queueName: `dead-read-fixture-${task.id}`,
        leaseOwner: scenario === 'live-owner' ? 'still-owned' : null,
        ...(scenario === 'wrong-key' ? { idempotencyKey: `unbound-${randomUUID()}` } : {}),
        ...(scenario === 'wrong-task' ? { correlationId: randomUUID() } : {}),
        ...(scenario === 'wrong-payload' ? { payload: { stepId: randomUUID() } } : {}),
      },
    });
    const audit =
      scenario === 'audit-failure'
        ? ({
            logStrictInTransaction: async () => {
              throw new Error('Injected dead-read audit failure');
            },
          } as never)
        : new AuditLogsService(prisma);
    const service = new MsaidiziTaskDispatcherService(
      prisma,
      new AutonomyConfig(config),
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      audit,
    ) as unknown as {
      reconcileDeadReadJob(taskId: string, stepId: string, jobId: string): Promise<boolean>;
    };
    const invoke = () => service.reconcileDeadReadJob(task.id, step.id, job.id);
    const won = ['running', 'already-failed', 'cancelling-task'].includes(scenario);
    if (scenario === 'audit-failure')
      await expect(invoke()).rejects.toThrow('Injected dead-read audit failure');
    else expect(await invoke()).toBe(won);
    expect(
      await prisma.msaidiziToolAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
    ).toMatchObject({
      status: won ? 'FAILED' : scenario === 'settled-success' ? 'SUCCEEDED' : 'RUNNING',
      ...(won ? { errorCode: 'READ_JOB_TERMINATED' } : {}),
    });
    expect(
      await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } }),
    ).toMatchObject({
      status: won ? 'FAILED' : stepStatus,
      attemptCount: 1,
      bytesRead: 123n,
    });
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: scenario === 'cancelling-task' ? 'CANCELLING' : 'RUNNING',
      attemptedToolCalls: 1,
      bytesRead: 123n,
    });
    if (won) expect(await invoke()).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: { taskId: task.id, entityId: attempt.id, action: 'MSAIDIZI_ERP_ACTION_FAILED' },
      }),
    ).toBe(won ? 1 : 0);
    expect(
      await prisma.msaidiziTaskEvent.count({
        where: { taskId: task.id, type: 'tool.read_attempt_reconciled' },
      }),
    ).toBe(won ? 1 : 0);
    expect(
      await prisma.msaidiziTaskEvent.count({ where: { taskId: task.id, type: 'step.failed' } }),
    ).toBe(won && scenario !== 'already-failed' ? 1 : 0);
  });

  it('cannot claim a step belonging to another task', async () => {
    const first = await fixture();
    const second = await fixture();
    expect(await dispatcher().enqueueStep(first.task.id, second.steps[0])).toBe(false);
    expect(await prisma.backgroundJob.count({ where: { correlationId: first.task.id } })).toBe(0);
    expect(
      (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: second.steps[0].id } }))
        .status,
    ).toBe('READY');
  });

  it('does not let late completion overwrite cancellation or dispatch a successor', async () => {
    const {
      task,
      steps: [step],
    } = await fixture();
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'CANCELLING' } });
    await dispatcher().finishTask(task.id, 'COMPLETED', null);
    expect(await dispatcher().enqueueStep(task.id, step)).toBe(false);
    await dispatcher().cancelRemaining(task.id);
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'CANCELLED',
    );
    expect(await prisma.backgroundJob.count({ where: { correlationId: task.id } })).toBe(0);
    const events = await prisma.msaidiziTaskEvent.findMany({ where: { taskId: task.id } });
    expect(events.some((event) => (event.payload as Prisma.JsonObject).to === 'COMPLETED')).toBe(
      false,
    );
  });

  it.each([false, true])(
    'rolls back dead mutation recovery if audit is unavailable (missing=%s)',
    async (missing) => {
      const {
        task,
        steps: [step],
      } = await fixture(true);
      await dispatcher().enqueueStep(task.id, step);
      const reserved = missing ? 0 : 8192;
      await prisma.msaidiziTask.update({
        where: { id: task.id },
        data: {
          mutations: 1,
          attemptedToolCalls: 1,
          reservedExternalEgressBytes: BigInt(reserved),
        },
      });
      await prisma.msaidiziTaskStep.update({
        where: { id: step.id },
        data: { status: 'RUNNING', attemptCount: 1 },
      });
      const attempt = await prisma.msaidiziToolAttempt.create({
        data: {
          taskId: task.id,
          stepId: step.id,
          attemptNumber: 1,
          toolName: step.capability,
          argumentsRedacted: {},
          argsDigest: 'b'.repeat(64),
          idempotencyKey: randomUUID(),
          status: 'RUNNING',
          resultSummary: reserved
            ? {
                externalEgress: {
                  settlementStatus: 'RESERVED',
                  metering: 'adapter-receipt-v1',
                  reservedExternalEgressBytes: reserved,
                  chargedExternalEgressBytes: 0,
                },
              }
            : {},
        },
      });
      await prisma.backgroundJob.update({
        where: { id: (await jobFor(step.id)).id },
        data: { status: 'DEAD_LETTER', attempts: 1 },
      });
      const audit = missing
        ? undefined
        : ({
            logStrictInTransaction: async () => {
              throw new Error('Injected mutation audit failure');
            },
          } as never);
      const service = new MsaidiziTaskDispatcherService(
        prisma,
        new AutonomyConfig(config),
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit,
      ) as unknown as DispatcherTransitions;
      await expect(service.reconcileDeadStepJobs(task.id)).rejects.toThrow(/audit/);
      expect(
        (await prisma.msaidiziToolAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
      ).toBe('RUNNING');
      expect(
        (await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: step.id } })).status,
      ).toBe('RUNNING');
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: 'RUNNING',
          mutations: 1,
          attemptedToolCalls: 1,
          reservedExternalEgressBytes: BigInt(reserved),
          externalEgressBytes: 0n,
        },
      );
      expect(
        await prisma.msaidiziTaskEvent.count({
          where: {
            taskId: task.id,
            type: { in: ['tool.egress_reconciled', 'step.outcome_unknown'] },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { taskId: task.id, entityId: attempt.id } }),
      ).toBe(0);
    },
  );

  it('reconciles a dead mutation as unknown exactly once after reconnect', async () => {
    const {
      task,
      steps: [step],
    } = await fixture(true);
    await dispatcher().enqueueStep(task.id, step);
    await prisma.msaidiziTaskStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', attemptCount: 1 },
    });
    const attempt = await prisma.msaidiziToolAttempt.create({
      data: {
        taskId: task.id,
        stepId: step.id,
        attemptNumber: 1,
        toolName: step.capability,
        argumentsRedacted: {},
        argsDigest: 'b'.repeat(64),
        idempotencyKey: randomUUID(),
        status: 'RUNNING',
      },
    });
    await prisma.backgroundJob.update({
      where: { id: (await jobFor(step.id)).id },
      data: {
        status: 'DEAD_LETTER',
        attempts: 1,
        errorMessage: 'Worker lease lost',
      },
    });
    await prisma.$disconnect();
    await connect();
    expect(await dispatcher().reconcileDeadStepJobs(task.id)).toBe(true);
    expect(await dispatcher().reconcileDeadStepJobs(task.id)).toBe(false);
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'NEEDS_ATTENTION',
    );
    expect(
      (await prisma.msaidiziToolAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
    ).toBe('UNKNOWN');
    expect(await dispatcher().enqueueStep(task.id, step)).toBe(false);
    expect((await jobFor(step.id)).status).toBe('DEAD_LETTER');
    expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(1);
  });
});
