import { ConfigService } from '@nestjs/config';
import { BackgroundJobType, MsaidiziToolAttemptStatus } from '@prisma/client';
import { JobHandlerRegistry } from '../job-worker/job-handler.registry';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from '../msaidizi-updates/update-candidate-proposal.port';
import { MsaidiziTaskDispatcherService } from './msaidizi-task-dispatcher.service';
import { deriveErpEgressSettlement, MsaidiziTaskStepHandler } from './msaidizi-task-step.handler';

function config(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function crudCoverage(releaseQualified = true) {
  return {
    report: jest.fn().mockReturnValue({
      releaseGate: {
        status: releaseQualified ? 'passed' : 'failed',
        blockers: releaseQualified ? [] : [{ code: 'eligible_operations_unverified', count: 1 }],
      },
    }),
  };
}

function auditHarness() {
  return { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) };
}

interface DispatcherTaskSnapshot {
  id: string;
  status: string;
  activePlanVersion: number;
  startedAt: Date | null;
  consumedWallTimeMs: bigint;
  wallTimeCheckpointAt: Date | null;
  maxWallTimeSeconds: number;
  attemptedToolCalls: number;
  maxAttemptedToolCalls: number;
  mutations: number;
  maxMutations: number;
}

interface DispatcherTestApi {
  finishTask(taskId: string, status: string, failureCode: string | null): Promise<void>;
  enqueueStep(
    taskId: string,
    step: { id: string; idempotent: boolean; mutation: boolean },
  ): Promise<boolean>;
  advance(task: DispatcherTaskSnapshot): Promise<number>;
  startQueued(batch: number): Promise<number>;
  pauseRemaining(taskId: string): Promise<void>;
  cancelRemaining(taskId: string): Promise<void>;
  reconcileGlobalKill(): Promise<void>;
  reconcileDeadStepJobs(taskId: string): Promise<boolean>;
}

function dispatcherTestApi(dispatcher: MsaidiziTaskDispatcherService): DispatcherTestApi {
  return dispatcher as unknown as DispatcherTestApi;
}

function stepHandlerPolicyApi(handler: MsaidiziTaskStepHandler) {
  return handler as unknown as {
    policyRejection(loaded: unknown): Promise<string | null>;
  };
}

function stepHandlerBudgetApi(handler: MsaidiziTaskStepHandler) {
  return handler as unknown as {
    reserveAttempt(
      task: Record<string, unknown>,
      step: Record<string, unknown>,
    ): Promise<{
      id: string;
      number: number;
    } | null>;
    reserveErpEgressBudget(
      taskId: string,
      stepId: string,
      attemptId: string,
      stepBudgets: Record<string, unknown>,
      requestedBytes: number,
    ): Promise<{ ok: true; bytes: number } | { ok: false; code: string }>;
    settleAttemptInTransaction(
      tx: unknown,
      taskId: string,
      attemptId: string,
      data: Record<string, unknown>,
      egress?: {
        reservedExternalEgressBytes: number;
        chargedExternalEgressBytes: number;
        verified: boolean;
      },
    ): Promise<void>;
    reserveErpResponseBudget(
      taskId: string,
      stepId: string,
      stepBudgets?: Record<string, unknown>,
    ): Promise<number | null>;
    reconcileErpResponseBudget(
      taskId: string,
      stepId: string,
      reservedBytes: number,
      usedBytes: number,
    ): Promise<void>;
    responsePersistenceFailure(
      taskId: string,
      stepId: string,
      attemptId: string,
      mutation: boolean,
      status: number,
      reason: string,
      error?: string,
    ): Promise<void>;
    markAttemptRunning(taskId: string, attemptId: string): Promise<boolean>;
    settleRejected(
      taskId: string,
      stepId: string,
      attemptId: string,
      reason: string,
    ): Promise<void>;
    succeed(
      taskId: string,
      stepId: string,
      attemptId: string,
      status: number,
      bytes: number,
      resultSha256: string,
      entityIdentifiers: Record<string, string>,
    ): Promise<void>;
  };
}

function rejectedSettlementHarness(options: { attemptWon?: number; stepWon?: number } = {}) {
  const attemptUpdateMany = jest.fn().mockResolvedValue({ count: options.attemptWon ?? 1 });
  const stepUpdateMany = jest.fn().mockResolvedValue({ count: options.stepWon ?? 1 });
  const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const eventCreate = jest.fn().mockResolvedValue({});
  const audit = auditHarness();
  const prisma = {
    msaidiziToolAttempt: { updateMany: attemptUpdateMany },
    msaidiziTaskStep: { updateMany: stepUpdateMany },
    msaidiziTask: {
      updateMany: taskUpdateMany,
      findUnique: jest.fn().mockResolvedValue({
        principalId: 'principal-rejected',
        initiatedByUserId: 'user-rejected',
        mandateId: 'mandate-rejected',
        companyId: 'company-rejected',
      }),
    },
    msaidiziTaskEvent: { create: eventCreate },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) =>
    work(prisma),
  );
  const handler = new MsaidiziTaskStepHandler(
    prisma as never,
    new JobHandlerRegistry(),
    {} as never,
    {} as never,
    new ManifestProvider(),
    {} as never,
    {} as never,
    crudCoverage() as never,
    audit as never,
  );
  return {
    handler,
    attemptUpdateMany,
    stepUpdateMany,
    taskUpdateMany,
    eventCreate,
    audit,
  };
}

describe('Msaidizi task step execution', () => {
  it('settles a governed rejection before or after the durable dispatch boundary', async () => {
    const harness = rejectedSettlementHarness();

    await expect(
      stepHandlerBudgetApi(harness.handler).settleRejected(
        'task-rejected',
        'step-rejected',
        'attempt-rejected',
        'LIVE_MANDATE_CAPABILITY_DENIED',
      ),
    ).resolves.toBeUndefined();

    expect(harness.attemptUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt-rejected',
        taskId: 'task-rejected',
        stepId: 'step-rejected',
        status: {
          in: [MsaidiziToolAttemptStatus.REQUESTED, MsaidiziToolAttemptStatus.RUNNING],
        },
      },
      data: expect.objectContaining({
        status: MsaidiziToolAttemptStatus.REJECTED,
        rejectionReason: 'LIVE_MANDATE_CAPABILITY_DENIED',
        endedAt: expect.any(Date),
      }),
    });
    expect(harness.stepUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'step-rejected',
          taskId: 'task-rejected',
          status: 'RUNNING',
        },
        data: expect.objectContaining({ status: 'NEEDS_ATTENTION' }),
      }),
    );
    expect(harness.taskUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          attemptedToolCalls: expect.anything(),
          executedToolCalls: expect.anything(),
          mutations: expect.anything(),
        }),
      }),
    );
    expect(harness.eventCreate).toHaveBeenCalledTimes(1);
    expect(harness.audit.logStrictInTransaction).toHaveBeenCalledTimes(1);
    expect(harness.audit.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'MSAIDIZI_ERP_ACTION_REJECTED',
        taskId: 'task-rejected',
        stepId: 'step-rejected',
        entityId: 'attempt-rejected',
      }),
    );
  });

  it('fails closed when a concurrent terminal settlement wins the attempt CAS', async () => {
    const harness = rejectedSettlementHarness({ attemptWon: 0 });

    await expect(
      stepHandlerBudgetApi(harness.handler).settleRejected(
        'task-rejected',
        'step-rejected',
        'attempt-rejected',
        'LIVE_MANDATE_CAPABILITY_DENIED',
      ),
    ).rejects.toThrow('Rejected tool-attempt settlement CAS lost');

    expect(harness.stepUpdateMany).not.toHaveBeenCalled();
    expect(harness.taskUpdateMany).not.toHaveBeenCalled();
    expect(harness.eventCreate).not.toHaveBeenCalled();
    expect(harness.audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('rolls the attempt settlement back when the running step CAS is lost', async () => {
    const harness = rejectedSettlementHarness({ stepWon: 0 });

    await expect(
      stepHandlerBudgetApi(harness.handler).settleRejected(
        'task-rejected',
        'step-rejected',
        'attempt-rejected',
        'LIVE_MANDATE_CAPABILITY_DENIED',
      ),
    ).rejects.toThrow('Rejected task-step settlement CAS lost');

    expect(harness.attemptUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.taskUpdateMany).not.toHaveBeenCalled();
    expect(harness.eventCreate).not.toHaveBeenCalled();
    expect(harness.audit.logStrictInTransaction).not.toHaveBeenCalled();
  });

  it('checks the global kill switch before reserving an attempt or dispatching a side effect', async () => {
    const task = {
      id: 'task-killed',
      status: 'RUNNING',
      activePlanVersion: 1,
      principal: { status: 'ACTIVE' },
    };
    const step = { id: 'step-killed', status: 'LEASED' };
    const registry = new JobHandlerRegistry();
    const handler = new MsaidiziTaskStepHandler(
      {} as never,
      registry,
      { globalKillSwitchActive: true } as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );
    const internals = handler as unknown as {
      load: jest.Mock;
      reserveAttempt: jest.Mock;
      rejectWithoutDispatch: jest.Mock;
    };
    internals.load = jest.fn().mockResolvedValue({
      task,
      step,
      plan: { version: 1 },
    });
    internals.reserveAttempt = jest.fn();
    internals.rejectWithoutDispatch = jest.fn().mockResolvedValue(undefined);
    handler.onModuleInit();

    await expect(
      registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!({
        jobId: 'job-killed',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        correlationId: task.id,
        attempts: 0,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId: task.id,
          stepId: step.id,
          maxAttempts: 1,
        },
        checkpoint: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({ data: { rejected: true, reason: 'global kill switch active' } });

    expect(internals.reserveAttempt).not.toHaveBeenCalled();
    expect(internals.rejectWithoutDispatch).toHaveBeenCalledWith(
      task.id,
      step.id,
      'GLOBAL_KILL_SWITCH',
    );
  });

  it('fails closed on an exhausted immutable step mutation budget before reserving an attempt', async () => {
    const task = {
      id: 'task-step-budget',
      status: 'RUNNING',
      activePlanVersion: 1,
      principal: { status: 'ACTIVE' },
    };
    const step = {
      id: 'step-budgeted-mutation',
      status: 'LEASED',
      attemptCount: 0,
      mutation: true,
      startedAt: null,
      budgets: { maxMutations: 0 },
    };
    const registry = new JobHandlerRegistry();
    const handler = new MsaidiziTaskStepHandler(
      {} as never,
      registry,
      { globalKillSwitchActive: false } as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );
    const internals = handler as unknown as {
      load: jest.Mock;
      reserveAttempt: jest.Mock;
      rejectWithoutDispatch: jest.Mock;
    };
    internals.load = jest.fn().mockResolvedValue({ task, step, plan: { version: 1 } });
    internals.reserveAttempt = jest.fn();
    internals.rejectWithoutDispatch = jest.fn().mockResolvedValue(undefined);
    handler.onModuleInit();

    await expect(
      registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!({
        jobId: 'job-step-budget',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        correlationId: task.id,
        attempts: 0,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId: task.id,
          stepId: step.id,
          maxAttempts: 1,
        },
        checkpoint: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({
      data: { rejected: true, reason: 'STEP_MUTATION_BUDGET_EXHAUSTED' },
    });

    expect(internals.reserveAttempt).not.toHaveBeenCalled();
    expect(internals.rejectWithoutDispatch).toHaveBeenCalledWith(
      task.id,
      step.id,
      'STEP_MUTATION_BUDGET_EXHAUSTED',
    );
  });

  it('preserves the first step start across a retry so its wall-time ceiling cannot reset', async () => {
    const firstStartedAt = new Date('2026-08-25T05:00:00.000Z');
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const stepUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const wallTimeCheckpointAt = new Date();
    const tx = {
      msaidiziTask: {
        updateMany: taskUpdate,
        findUnique: jest.fn().mockResolvedValue({
          consumedWallTimeMs: 0n,
          wallTimeCheckpointAt,
          maxWallTimeSeconds: 7_200,
        }),
      },
      msaidiziTaskStep: { updateMany: stepUpdate },
      msaidiziToolAttempt: { create: jest.fn().mockResolvedValue({}) },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const audit = auditHarness();
    const handler = new MsaidiziTaskStepHandler(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      audit as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).reserveAttempt(
        {
          id: 'task-step-retry-wall-clock',
          principalId: 'principal-1',
          initiatedByUserId: 'user-1',
          mandateId: null,
          companyId: 'company-1',
          status: 'RUNNING',
          attemptedToolCalls: 1,
          maxAttemptedToolCalls: 10,
          mutations: 0,
          maxMutations: 10,
          startedAt: new Date(),
          consumedWallTimeMs: 0n,
          wallTimeCheckpointAt,
          maxWallTimeSeconds: 7_200,
        },
        {
          id: 'step-retry-wall-clock',
          status: 'RUNNING',
          attemptCount: 1,
          mutation: false,
          capability: 'erp.read',
          arguments: { path: '/example', query: {}, body: null },
          startedAt: firstStartedAt,
        },
      ),
    ).resolves.toEqual({ id: 'attempt-step-retry-wall-clock-2', number: 2 });

    const stepMutation = stepUpdate.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(stepMutation.where).toMatchObject({
      id: 'step-retry-wall-clock',
      attemptCount: 1,
      startedAt: firstStartedAt,
    });
    expect(stepMutation.data).not.toHaveProperty('startedAt');
    expect(audit.logStrictInTransaction).toHaveBeenCalledTimes(1);
  });

  it('never reserves a second mutation attempt for a replayed or duplicate job', async () => {
    const transaction = jest.fn();
    const handler = new MsaidiziTaskStepHandler(
      { $transaction: transaction } as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).reserveAttempt(
        {
          id: 'task-one-shot-mutation',
          attemptedToolCalls: 1,
          maxAttemptedToolCalls: 5,
          mutations: 1,
          maxMutations: 5,
          startedAt: new Date(),
          consumedWallTimeMs: 0n,
          wallTimeCheckpointAt: new Date(),
          maxWallTimeSeconds: 7_200,
        },
        {
          id: 'step-one-shot-mutation',
          status: 'RUNNING',
          attemptCount: 1,
          mutation: true,
        },
      ),
    ).resolves.toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('fences a same-job stale-lease retry as UNKNOWN and rejects the original late success', async () => {
    const attemptUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const lateAttemptUpdate = jest
      .fn()
      .mockRejectedValue(new Error('attempt is no longer RUNNING'));
    const stepUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const lateStepUpdate = jest.fn();
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const eventCreate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'attempt-existing-write',
          status: MsaidiziToolAttemptStatus.RUNNING,
          resultSummary: null,
        }),
        updateMany: attemptUpdateMany,
        update: lateAttemptUpdate,
      },
      msaidiziTaskStep: { updateMany: stepUpdateMany, update: lateStepUpdate },
      msaidiziTask: { updateMany: taskUpdateMany },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      backgroundJob: { findFirst: jest.fn().mockResolvedValue(null) },
      msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const registry = new JobHandlerRegistry();
    const invoke = jest.fn();
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      registry,
      { globalKillSwitchActive: false } as never,
      {} as never,
      new ManifestProvider(),
      { invoke } as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );
    const internals = handler as unknown as { load: jest.Mock };
    internals.load = jest.fn().mockResolvedValue({
      task: {
        id: 'task-existing-write',
        status: 'RUNNING',
        activePlanVersion: 1,
        principal: { status: 'ACTIVE' },
      },
      step: {
        id: 'step-existing-write',
        status: 'RUNNING',
        mutation: true,
        attemptCount: 1,
      },
      plan: { version: 1 },
    });
    handler.onModuleInit();
    const checkpoint = jest.fn().mockResolvedValue(undefined);

    await expect(
      registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!({
        jobId: 'job-existing-write',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId: 'task-existing-write',
          stepId: 'step-existing-write',
          maxAttempts: 1,
        },
        correlationId: 'task-existing-write',
        attempts: 1,
        checkpoint,
      }),
    ).resolves.toEqual({ data: { ok: false, uncertainOutcome: true, replayBlocked: true } });

    expect(checkpoint).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-existing-write',
          status: MsaidiziToolAttemptStatus.RUNNING,
        },
        data: expect.objectContaining({
          status: MsaidiziToolAttemptStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: 'MUTATION_RETRY_BLOCKED',
        }),
      }),
    );
    expect(stepUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'step-existing-write',
          taskId: 'task-existing-write',
          status: 'RUNNING',
        },
        data: expect.objectContaining({ status: 'NEEDS_ATTENTION' }),
      }),
    );
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-existing-write',
          status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] },
        },
        data: expect.objectContaining({
          status: 'NEEDS_ATTENTION',
          failureCode: 'MUTATION_RETRY_BLOCKED',
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalled();
    await expect(
      stepHandlerBudgetApi(handler).succeed(
        'task-existing-write',
        'step-existing-write',
        'attempt-existing-write',
        200,
        2,
        'A'.repeat(64),
        {},
      ),
    ).rejects.toThrow('attempt is no longer RUNNING');
    expect(lateAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-existing-write',
          status: MsaidiziToolAttemptStatus.RUNNING,
        },
      }),
    );
    expect(lateStepUpdate).not.toHaveBeenCalled();
  });

  it('leaves a mutation attempt untouched when a distinct live step job still owns it', async () => {
    const transaction = jest.fn();
    const registry = new JobHandlerRegistry();
    const invoke = jest.fn();
    const handler = new MsaidiziTaskStepHandler(
      {
        backgroundJob: { findFirst: jest.fn().mockResolvedValue({ id: 'job-original-owner' }) },
        msaidiziHostAction: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: transaction,
      } as never,
      registry,
      { globalKillSwitchActive: false } as never,
      {} as never,
      new ManifestProvider(),
      { invoke } as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );
    const internals = handler as unknown as { load: jest.Mock };
    internals.load = jest.fn().mockResolvedValue({
      task: {
        id: 'task-live-owner',
        status: 'RUNNING',
        activePlanVersion: 1,
        principal: { status: 'ACTIVE' },
      },
      step: {
        id: 'step-live-owner',
        status: 'RUNNING',
        mutation: true,
        attemptCount: 1,
      },
      plan: { version: 1 },
    });
    handler.onModuleInit();

    await expect(
      registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!({
        jobId: 'job-duplicate',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId: 'task-live-owner',
          stepId: 'step-live-owner',
          maxAttempts: 1,
        },
        correlationId: 'task-live-owner',
        attempts: 0,
        checkpoint: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({
      data: { skipped: true, reason: 'original mutation owner is still active' },
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('lets cancellation win the pre-dispatch CAS without starting the attempt', async () => {
    const attemptUpdate = jest.fn();
    const tx = {
      msaidiziTask: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziToolAttempt: { update: attemptUpdate },
    };
    const handler = new MsaidiziTaskStepHandler(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).markAttemptRunning('task-cancelling', 'attempt-requested'),
    ).resolves.toBe(false);
    expect(attemptUpdate).not.toHaveBeenCalled();
  });

  it('cannot replace a reconciled UNKNOWN attempt with a late handler success', async () => {
    const attemptUpdate = jest.fn().mockRejectedValue(new Error('attempt is no longer RUNNING'));
    const stepUpdate = jest.fn();
    const taskUpdate = jest.fn();
    const eventCreate = jest.fn();
    const tx = {
      msaidiziToolAttempt: { update: attemptUpdate },
      msaidiziTaskStep: { update: stepUpdate },
      msaidiziTask: { update: taskUpdate },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const handler = new MsaidiziTaskStepHandler(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).succeed(
        'task-needs-attention',
        'step-needs-attention',
        'attempt-unknown',
        200,
        2,
        'a'.repeat(64),
        {},
      ),
    ).rejects.toThrow('attempt is no longer RUNNING');
    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-unknown', status: MsaidiziToolAttemptStatus.RUNNING },
      }),
    );
    expect(stepUpdate).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('invokes the DRAFT proposal port only for the exact reviewed self-improvement step', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const planVersionId = '22222222-2222-4222-8222-222222222222';
    const stepId = '33333333-3333-4333-8333-333333333333';
    const userId = '44444444-4444-4444-8444-444444444444';
    const task = {
      id: taskId,
      principalId: 'principal-1',
      initiatedByUserId: userId,
      mandateId: 'mandate-1',
      companyId: 'company-1',
      status: 'RUNNING',
      mode: 'AUTOPILOT',
      activePlanVersion: 1,
      attemptedToolCalls: 0,
      maxAttemptedToolCalls: 5,
      mutations: 0,
      maxMutations: 2,
      startedAt: new Date(),
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: new Date(),
      maxWallTimeSeconds: 7_200,
      principal: { grants: [], status: 'ACTIVE' },
      mandate: {
        status: 'ACTIVE',
        startsAt: null,
        expiresAt: null,
        capabilities: [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            version: '1',
            effects: ['WRITE'],
            dataClasses: [proposalDataClass('ADAPTERS')],
          },
        ],
      },
    };
    const arguments_ = {
      name: 'Adapter candidate',
      version: '1.0.0',
      rollbackVersion: '0.9.0',
      scope: 'ADAPTERS',
      sourceArtifactId: '55555555-5555-4555-8555-555555555555',
      sourceArtifactSha256: 'a'.repeat(64),
      rollbackArtifactId: '66666666-6666-4666-8666-666666666666',
      rollbackArtifactSha256: 'b'.repeat(64),
      rationale: 'Prepare a bounded and recoverable adapter improvement.',
    };
    const step = {
      id: stepId,
      taskId,
      status: 'LEASED',
      attemptCount: 0,
      mutation: true,
      idempotent: true,
      target: 'SELF_IMPROVEMENT',
      capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
      capabilityVersion: '1',
      expectedEffect: 'WRITE',
      dataClass: proposalDataClass('ADAPTERS'),
      arguments: arguments_,
      planVersion: { id: planVersionId, version: 1, createdByUserId: userId },
    };
    const prisma = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue(task),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue(step),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziToolAttempt: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: unknown) => {
      if (Array.isArray(work)) return Promise.all(work);
      return (work as (client: typeof prisma) => unknown)(prisma);
    });
    const registry = new JobHandlerRegistry();
    const proposal = {
      propose: jest.fn().mockResolvedValue({
        candidateId: '77777777-7777-4777-8777-777777777777',
        status: 'DRAFT',
        scope: 'ADAPTERS',
        proposalDigest: 'c'.repeat(64),
        sourceArtifactSha256: 'a'.repeat(64),
        rollbackArtifactSha256: 'b'.repeat(64),
        replay: false,
      }),
    };
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      registry,
      {
        enabled: true,
        autopilotEnabled: true,
        hostExecutionEnabled: false,
        principalGrants: [],
      } as never,
      { allowedTiers: ['green', 'amber'] } as never,
      new ManifestProvider(),
      { invoke: jest.fn() } as never,
      { issue: jest.fn() } as never,
      crudCoverage() as never,
      auditHarness() as never,
      undefined,
      undefined,
      proposal as never,
    );
    handler.onModuleInit();

    const run = registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!;
    await expect(
      run({
        jobId: 'job-proposal',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        correlationId: taskId,
        attempts: 0,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId,
          stepId,
          maxAttempts: 1,
        },
        checkpoint: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({
      data: {
        ok: true,
        candidateId: '77777777-7777-4777-8777-777777777777',
        replay: false,
      },
    });
    expect(proposal.propose).toHaveBeenCalledWith({
      taskId,
      planVersionId,
      stepId,
      attemptId: `attempt-${stepId}-1`,
    });
  });

  it('turns an uncertain mutation into NEEDS_ATTENTION and resolves without retrying', async () => {
    const task = {
      id: 'task-1',
      status: 'RUNNING',
      mode: 'COLLABORATIVE',
      activePlanVersion: 1,
      attemptedToolCalls: 0,
      maxAttemptedToolCalls: 5,
      mutations: 0,
      maxMutations: 2,
      bytesRead: 0n,
      bytesWritten: 0n,
      maxLocalBytes: 1_000_000n,
      startedAt: new Date(),
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: new Date(),
      maxWallTimeSeconds: 7200,
      hostExecutionAllowed: false,
      principal: { grants: ['customers.update'], status: 'ACTIVE' },
      mandate: null,
    };
    const step = {
      id: 'step-1',
      taskId: task.id,
      status: 'LEASED',
      attemptCount: 0,
      mutation: true,
      idempotent: false,
      target: 'ERP',
      capability: 'CustomersController.update',
      expectedEffect: 'WRITE',
      budgets: { maxLocalBytes: 1_000_000 },
      bytesRead: 0n,
      bytesWritten: 0n,
      localIoAccountingValid: true,
      arguments: { path: { id: 'customer-1' }, query: {}, body: { name: 'Neema' } },
      planVersion: { version: 1 },
    };

    const prisma = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue(task),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTaskStep: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(step)
          .mockResolvedValue({ ...step, status: 'RUNNING' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziToolAttempt: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: unknown) => {
      if (Array.isArray(work)) return Promise.all(work);
      if (typeof work !== 'function') throw new Error('unexpected transaction input');
      return (work as (client: typeof prisma) => unknown)(prisma);
    });

    const manifest = new ManifestProvider();
    manifest.setForTesting([
      {
        id: 'CustomersController.update',
        controller: 'CustomersController',
        handler: 'update',
        verb: 'PATCH',
        path: 'customers/:id',
        permissions: ['customers.update'],
        anyPermissions: [],
        roles: [],
        apiScopes: [],
        guard: 'permission',
        tier: 'amber',
        tierReason: 'write-verb',
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: true },
        agentExcluded: false,
      },
    ]);
    const registry = new JobHandlerRegistry();
    const invoker = {
      invoke: jest.fn().mockResolvedValue({
        ok: false,
        status: 0,
        body: null,
        error: 'transport outcome unknown',
      }),
    };
    const notifications = {
      notifyMsaidiziTaskTerminal: jest.fn().mockResolvedValue(true),
    };
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      registry,
      { enabled: true, hostExecutionEnabled: false, principalGrants: ['*'] } as never,
      { allowedTiers: ['green', 'amber'] } as never,
      manifest,
      invoker as never,
      { issue: jest.fn().mockResolvedValue({ accessToken: 'short-lived' }) } as never,
      crudCoverage() as never,
      auditHarness() as never,
      undefined,
      notifications as never,
    );
    handler.onModuleInit();

    const run = registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!;
    await expect(
      run({
        jobId: 'job-1',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        correlationId: task.id,
        attempts: 0,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId: task.id,
          stepId: step.id,
          maxAttempts: 1,
        },
        checkpoint: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({ data: { ok: false, uncertainOutcome: true } });

    expect(invoker.invoke).toHaveBeenCalledTimes(1);
    expect(prisma.msaidiziToolAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziToolAttemptStatus.UNKNOWN,
          uncertainOutcome: true,
        }),
      }),
    );
    expect(prisma.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'NEEDS_ATTENTION',
          failureCode: 'UNKNOWN_WRITE_OUTCOME',
        }),
      }),
    );
    expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledWith(
      prisma,
      task.id,
      'NEEDS_ATTENTION',
    );
  });

  it('rejects a persisted task when a restarted deployment removed its capability grant', async () => {
    const manifest = new ManifestProvider();
    manifest.setForTesting([
      {
        id: 'CustomersController.update',
        controller: 'CustomersController',
        handler: 'update',
        verb: 'PATCH',
        path: 'customers/:id',
        permissions: ['customers.update'],
        anyPermissions: [],
        roles: [],
        apiScopes: [],
        guard: 'permission',
        tier: 'amber',
        tierReason: 'write-verb',
        params: { path: ['id'], query: [], freeFormQuery: false, hasBody: true },
        agentExcluded: false,
      },
    ]);
    const handler = new MsaidiziTaskStepHandler(
      {} as never,
      new JobHandlerRegistry(),
      {
        enabled: true,
        hostExecutionEnabled: false,
        // The principal row still contains customers.update, but deployment
        // configuration after restart has revoked it.
        principalGrants: [],
      } as never,
      { allowedTiers: ['green', 'amber'] } as never,
      manifest,
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerPolicyApi(handler).policyRejection({
        task: {
          mode: 'COLLABORATIVE',
          principal: { grants: ['customers.update'], status: 'ACTIVE' },
          mandate: null,
        },
        step: {
          target: 'ERP',
          capability: 'CustomersController.update',
          expectedEffect: 'WRITE',
          mutation: true,
        },
        plan: { version: 1 },
      }),
    ).resolves.toBe('DEPLOYMENT_PRINCIPAL_PERMISSION_DENIED');
  });

  it('cannot downgrade a manifest-classified external ERP action to an ordinary write', async () => {
    const manifest = new ManifestProvider();
    manifest.setForTesting([
      {
        id: 'SyntheticExternalController.send',
        controller: 'SyntheticExternalController',
        handler: 'send',
        verb: 'POST',
        path: 'synthetic-external/send',
        permissions: ['synthetic.send'],
        anyPermissions: [],
        roles: [],
        apiScopes: [],
        guard: 'permission',
        tier: 'red',
        tierReason: 'metered-external-egress',
        params: { path: [], query: [], freeFormQuery: false, hasBody: true },
        agentExcluded: false,
        externalEgress: { metering: 'adapter-receipt-v1', reservationBytes: 8192 },
      },
    ]);
    const handler = new MsaidiziTaskStepHandler(
      {} as never,
      new JobHandlerRegistry(),
      { enabled: true, principalGrants: ['*'] } as never,
      { allowedTiers: ['red'] } as never,
      manifest,
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );
    const loaded = {
      task: {
        mode: 'AUTOPILOT',
        principal: { grants: ['synthetic.send'], status: 'ACTIVE' },
        maxWallTimeSeconds: 7200,
        consumedWallTimeMs: 0n,
        wallTimeCheckpointAt: new Date(),
        maxModelTurns: 200,
        maxAttemptedToolCalls: 500,
        maxMutations: 100,
        maxLocalBytes: 5_368_709_120n,
        maxExternalEgressBytes: 262_144_000n,
        maxModelCostUsd: { toNumber: () => 20 },
        mandate: {
          status: 'ACTIVE',
          startsAt: null,
          expiresAt: null,
          capabilities: [
            {
              capability: 'SyntheticExternalController.send',
              version: '1',
              effects: ['EXTERNAL'],
              dataClasses: ['internal'],
            },
          ],
          budgets: {
            maxWallTimeSeconds: 7200,
            maxModelTurns: 200,
            maxAttemptedToolCalls: 500,
            maxMutations: 100,
            maxLocalBytes: 5_368_709_120,
            maxExternalEgressBytes: 262_144_000,
            maxModelCostUsd: 20,
          },
        },
      },
      step: {
        target: 'ERP',
        capability: 'SyntheticExternalController.send',
        capabilityVersion: '1',
        expectedEffect: 'WRITE',
        dataClass: 'internal',
        mutation: true,
      },
      plan: { version: 1 },
    };

    await expect(stepHandlerPolicyApi(handler).policyRejection(loaded)).resolves.toBe(
      'EFFECT_MISMATCH',
    );
    await expect(
      stepHandlerPolicyApi(handler).policyRejection({
        ...loaded,
        step: { ...loaded.step, expectedEffect: 'EXTERNAL' },
      }),
    ).resolves.toBeNull();
  });

  it('rejects ERP dispatch when current signed CRUD evidence no longer passes release', async () => {
    const handler = new MsaidiziTaskStepHandler(
      {} as never,
      new JobHandlerRegistry(),
      { enabled: true, principalGrants: ['*'] } as never,
      { allowedTiers: ['green'] } as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage(false) as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerPolicyApi(handler).policyRejection({
        task: {
          mode: 'COLLABORATIVE',
          principal: { grants: ['*'], status: 'ACTIVE' },
          mandate: null,
        },
        step: {
          target: 'ERP',
          capability: 'ExpensesController.findAll',
          expectedEffect: 'READ',
          mutation: false,
        },
        plan: { version: 1 },
      }),
    ).resolves.toBe('ERP_CRUD_RELEASE_GATE_BLOCKED');
  });

  it('reserves ERP response bytes before dispatch and refunds only the unused balance', async () => {
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const stepUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'RUNNING',
          bytesRead: 25n,
          bytesWritten: 25n,
          maxLocalBytes: 100n,
        }),
        updateMany: taskUpdateMany,
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'step-io',
          taskId: 'task-io',
          status: 'RUNNING',
          budgets: { maxLocalBytes: 100 },
          bytesRead: 10n,
          bytesWritten: 0n,
          localIoAccountingValid: true,
        }),
        updateMany: stepUpdateMany,
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) =>
      work(prisma),
    );
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    const reservation = await stepHandlerBudgetApi(handler).reserveErpResponseBudget(
      'task-io',
      'step-io',
      { maxLocalBytes: 100 },
    );
    expect(reservation).toBe(50);
    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ bytesRead: 25n, bytesWritten: 25n }),
        data: expect.objectContaining({ bytesRead: { increment: 50n } }),
      }),
    );

    await stepHandlerBudgetApi(handler).reconcileErpResponseBudget('task-io', 'step-io', 50, 17);
    expect(taskUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'task-io', bytesRead: { gte: 50n } },
        data: expect.objectContaining({ bytesRead: { decrement: 33n } }),
      }),
    );
    expect(stepUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'step-io',
          localIoAccountingValid: true,
        }),
        data: expect.objectContaining({ bytesRead: { decrement: 33n } }),
      }),
    );
  });

  it('makes an oversized mutation response NEEDS_ATTENTION without retrying the action', async () => {
    const prisma = {
      msaidiziToolAttempt: { update: jest.fn().mockResolvedValue({}) },
      msaidiziTaskStep: { update: jest.fn().mockResolvedValue({}) },
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          principalId: 'principal-1',
          initiatedByUserId: 'user-1',
          mandateId: 'mandate-1',
          companyId: 'company-1',
        }),
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) =>
      work(prisma),
    );
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await stepHandlerBudgetApi(handler).responsePersistenceFailure(
      'task-io',
      'step-io',
      'attempt-io',
      true,
      200,
      'ERP_RESPONSE_BUDGET_EXCEEDED',
      'bounded reader cancelled the response',
    );

    expect(prisma.msaidiziToolAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziToolAttemptStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: 'ERP_RESPONSE_BUDGET_EXCEEDED',
        }),
      }),
    );
    expect(prisma.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'NEEDS_ATTENTION',
          failureCode: 'ERP_RESPONSE_BUDGET_EXCEEDED',
        }),
      }),
    );
  });

  it('caps an ERP response reservation at the immutable step-local byte remainder', async () => {
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const stepUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'RUNNING',
          bytesRead: 10n,
          bytesWritten: 0n,
          maxLocalBytes: 1_000n,
        }),
        updateMany: taskUpdateMany,
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'step-io',
          taskId: 'task-step-io',
          status: 'RUNNING',
          budgets: { maxLocalBytes: 20 },
          bytesRead: 13n,
          bytesWritten: 0n,
          localIoAccountingValid: true,
        }),
        updateMany: stepUpdateMany,
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) =>
      work(prisma),
    );
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).reserveErpResponseBudget('task-step-io', 'step-io', {
        maxLocalBytes: 20,
      }),
    ).resolves.toBe(7);
    expect(stepUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bytesRead: { increment: 7n } }),
      }),
    );
  });

  it('reserves a classified ERP egress maximum against task and step ceilings atomically', async () => {
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const attemptUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'RUNNING',
          externalEgressBytes: 100n,
          reservedExternalEgressBytes: 200n,
          maxExternalEgressBytes: 10_000n,
        }),
        updateMany: taskUpdateMany,
      },
      msaidiziToolAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            resultSummary: {
              externalEgress: {
                settlementStatus: 'SETTLED',
                chargedExternalEgressBytes: 300,
              },
            },
          },
        ]),
        updateMany: attemptUpdateMany,
      },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) =>
      work(prisma),
    );
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).reserveErpEgressBudget(
        'task-egress',
        'step-egress',
        'attempt-egress',
        { maxExternalEgressBytes: 2_000 },
        1_000,
      ),
    ).resolves.toEqual({ ok: true, bytes: 1_000 });
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          externalEgressBytes: 100n,
          reservedExternalEgressBytes: 200n,
        }),
        data: expect.objectContaining({
          reservedExternalEgressBytes: { increment: 1_000n },
        }),
      }),
    );
    expect(attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'attempt-egress',
          status: MsaidiziToolAttemptStatus.REQUESTED,
        }),
        data: expect.objectContaining({
          resultSummary: expect.objectContaining({
            externalEgress: expect.objectContaining({
              settlementStatus: 'RESERVED',
              reservedExternalEgressBytes: 1_000,
            }),
          }),
        }),
      }),
    );
  });

  it('enforces the immutable step egress ceiling before task reservation', async () => {
    const updateMany = jest.fn();
    const prisma = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'RUNNING',
          externalEgressBytes: 0n,
          reservedExternalEgressBytes: 0n,
          maxExternalEgressBytes: 10_000n,
        }),
        updateMany,
      },
      msaidiziToolAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            resultSummary: {
              externalEgress: {
                settlementStatus: 'SETTLED',
                chargedExternalEgressBytes: 750,
              },
            },
          },
        ]),
      },
    };
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );

    await expect(
      stepHandlerBudgetApi(handler).reserveErpEgressBudget(
        'task-egress',
        'step-egress',
        'attempt-egress',
        { maxExternalEgressBytes: 1_000 },
        500,
      ),
    ).resolves.toEqual({ ok: false, code: 'STEP_EXTERNAL_EGRESS_BUDGET_EXHAUSTED' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('settles ERP egress once with attempt CAS and task charge in the same transaction', async () => {
    const attemptUpdateMany = jest.fn().mockResolvedValueOnce({ count: 1 });
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziToolAttempt: { updateMany: attemptUpdateMany },
      msaidiziTask: { updateMany: taskUpdateMany },
    };
    const handler = new MsaidiziTaskStepHandler(
      {} as never,
      new JobHandlerRegistry(),
      {} as never,
      {} as never,
      new ManifestProvider(),
      {} as never,
      {} as never,
      crudCoverage() as never,
      auditHarness() as never,
    );
    const settlement = {
      reservedExternalEgressBytes: 8_000,
      chargedExternalEgressBytes: 1_250,
      verified: true,
    };

    await stepHandlerBudgetApi(handler).settleAttemptInTransaction(
      tx,
      'task-egress',
      'attempt-egress',
      { status: MsaidiziToolAttemptStatus.SUCCEEDED },
      settlement,
    );
    expect(attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-egress', status: MsaidiziToolAttemptStatus.RUNNING },
      }),
    );
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-egress',
          reservedExternalEgressBytes: { gte: 8_000n },
        },
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 8_000n },
          externalEgressBytes: { increment: 1_250n },
        }),
      }),
    );

    attemptUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      stepHandlerBudgetApi(handler).settleAttemptInTransaction(
        tx,
        'task-egress',
        'attempt-egress',
        { status: MsaidiziToolAttemptStatus.SUCCEEDED },
        settlement,
      ),
    ).rejects.toThrow(/already settled/i);
    expect(taskUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('full-charges missing, malformed, or unverifiable ERP metering evidence', () => {
    const binding = {
      taskId: 'task-egress',
      planVersionId: 'plan-egress',
      stepId: 'step-egress',
      attemptId: 'attempt-egress',
      capabilityId: 'SyntheticExternalController.send',
      capabilityVersion: '1',
      argumentsSha256: 'a'.repeat(64),
      reservedExternalEgressBytes: 8192,
    };
    expect(
      deriveErpEgressSettlement(
        {
          ok: true,
          status: 200,
          body: { accepted: true },
          responseSha256: 'b'.repeat(64),
          egressReceiptError: 'ERP_EGRESS_RECEIPT_MISSING',
        },
        binding,
        'b'.repeat(64),
      ),
    ).toEqual({
      reservedExternalEgressBytes: 8192,
      chargedExternalEgressBytes: 8192,
      verified: false,
      errorCode: 'ERP_EGRESS_RECEIPT_MISSING',
    });
    expect(
      deriveErpEgressSettlement(
        {
          ok: true,
          status: 200,
          body: { accepted: true },
          responseSha256: 'b'.repeat(64),
          egressReceipt: { receiptId: 'tampered' } as never,
        },
        binding,
        'b'.repeat(64),
      ),
    ).toMatchObject({
      chargedExternalEgressBytes: 8192,
      verified: false,
      errorCode: 'ERP_EGRESS_RECEIPT_MALFORMED',
    });
  });
});

describe('Msaidizi task dispatch retry units', () => {
  it('atomically stops on a committed step condition before leasing the next mutation', async () => {
    const nextMutation = {
      id: 'step-next-mutation',
      stepKey: 'next-mutation',
      sequence: 2,
      status: 'READY',
      dependencies: ['checkpoint'],
      mutation: true,
      idempotent: false,
      attemptCount: 0,
      budgets: { maxLocalBytes: 1_000 },
      bytesRead: 0n,
      bytesWritten: 0n,
      localIoAccountingValid: true,
      stopConditions: {},
      toolAttempts: [],
    };
    const checkpoint = {
      id: 'step-checkpoint',
      stepKey: 'checkpoint',
      sequence: 1,
      status: 'SUCCEEDED',
      dependencies: [],
      mutation: false,
      idempotent: true,
      attemptCount: 1,
      budgets: { maxLocalBytes: 1_000 },
      bytesRead: 0n,
      bytesWritten: 0n,
      localIoAccountingValid: true,
      stopConditions: { runtime: { onSuccess: true } },
      toolAttempts: [{ resultSummary: { ok: true, httpStatus: 200, emptyResult: false } }],
    };
    const taskUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const stepUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'RUNNING' }]),
      msaidiziTaskStep: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(checkpoint),
        updateMany: stepUpdate,
      },
      msaidiziTask: { updateMany: taskUpdate },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      backgroundJob: { findMany: jest.fn().mockResolvedValue([]) },
      msaidiziTaskStep: { findMany: jest.fn().mockResolvedValue([checkpoint, nextMutation]) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const adaptive = { gate: jest.fn() };
    const notifications = { notifyMsaidiziTaskTerminal: jest.fn().mockResolvedValue(true) };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
      undefined,
      notifications as never,
      adaptive as never,
    );

    await expect(
      dispatcherTestApi(dispatcher).advance({
        id: 'task-stop-condition',
        status: 'RUNNING',
        activePlanVersion: 1,
        startedAt: new Date(),
        consumedWallTimeMs: 0n,
        wallTimeCheckpointAt: new Date(),
        maxWallTimeSeconds: 7_200,
        attemptedToolCalls: 1,
        maxAttemptedToolCalls: 1,
        mutations: 0,
        maxMutations: 10,
      }),
    ).resolves.toBe(0);

    expect(adaptive.gate).not.toHaveBeenCalled();
    expect(stepUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: checkpoint.id },
          status: { in: ['PENDING', 'READY'] },
        }),
        data: expect.objectContaining({ status: 'SKIPPED' }),
      }),
    );
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          failureCode: null,
          statusDetail: 'STEP_STOP_ON_SUCCESS',
        }),
      }),
    );
    expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledWith(
      tx,
      'task-stop-condition',
      'COMPLETED',
    );
  });

  it('runs durable kill reconciliation instead of silently abandoning dispatcher work', async () => {
    const dispatcher = new MsaidiziTaskDispatcherService(
      {} as never,
      { enabled: true } as never,
      config({
        MSAIDIZI_TASK_WORKER_ENABLED: 'true',
        JOB_WORKER_ENABLED: 'true',
        MSAIDIZI_GLOBAL_KILL_SWITCH: 'true',
      }),
    );
    const reconcile = jest.fn().mockResolvedValue(undefined);
    (dispatcher as unknown as { reconcileGlobalKill: typeof reconcile }).reconcileGlobalKill =
      reconcile;

    await expect(dispatcher.dispatchOnce()).resolves.toEqual({
      started: 0,
      processed: 0,
      enqueued: 0,
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('reconciles terminal outcome memory on every worker tick, including while dispatch is killed', async () => {
    const runtimeMemory = { reconcileTerminalOutcomes: jest.fn().mockResolvedValue({}) };
    const dispatcher = new MsaidiziTaskDispatcherService(
      {} as never,
      { enabled: true } as never,
      config({
        MSAIDIZI_TASK_WORKER_ENABLED: 'true',
        JOB_WORKER_ENABLED: 'true',
        MSAIDIZI_GLOBAL_KILL_SWITCH: 'true',
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      runtimeMemory as never,
    );
    (dispatcher as unknown as { reconcileGlobalKill: jest.Mock }).reconcileGlobalKill = jest
      .fn()
      .mockResolvedValue(undefined);

    await dispatcher.dispatchOnce(7);

    expect(runtimeMemory.reconcileTerminalOutcomes).toHaveBeenCalledWith(7);
  });

  it('persists one database-owned wall-time checkpoint before advancing active tasks', async () => {
    const checkpoint = jest.fn().mockResolvedValue({ count: 2 });
    const dispatcher = new MsaidiziTaskDispatcherService(
      {
        msaidiziTask: {
          updateMany: checkpoint,
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as never,
      { enabled: true } as never,
      config({ MSAIDIZI_TASK_WORKER_ENABLED: 'true', JOB_WORKER_ENABLED: 'true' }),
    );
    (dispatcher as unknown as { startQueued: jest.Mock }).startQueued = jest
      .fn()
      .mockResolvedValue(0);

    await expect(dispatcher.dispatchOnce()).resolves.toEqual({
      started: 0,
      processed: 0,
      enqueued: 0,
    });
    expect(checkpoint).toHaveBeenCalledWith({
      where: {
        startedAt: { not: null },
        endedAt: null,
        status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] },
      },
      data: { lastCheckpointAt: expect.any(Date) },
    });
  });

  it('revokes device authority, pauses queued/running work, and preserves cancellation intent', async () => {
    const tasks = [
      { id: 'queued', status: 'QUEUED', stateVersion: 1 },
      { id: 'running', status: 'RUNNING', stateVersion: 2 },
      { id: 'pausing', status: 'PAUSING', stateVersion: 3 },
      { id: 'cancelling', status: 'CANCELLING', stateVersion: 4 },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziTask: { findMany: jest.fn().mockResolvedValue(tasks) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const devices = { reconcileGlobalKill: jest.fn().mockResolvedValue({}) };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
      undefined,
      undefined,
      undefined,
      devices as never,
    );
    const pause = jest.fn().mockResolvedValue(undefined);
    const cancel = jest.fn().mockResolvedValue(undefined);
    (dispatcher as unknown as { pauseRemaining: typeof pause }).pauseRemaining = pause;
    (dispatcher as unknown as { cancelRemaining: typeof cancel }).cancelRemaining = cancel;

    await dispatcherTestApi(dispatcher).reconcileGlobalKill();

    expect(devices.reconcileGlobalKill).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'queued', status: 'QUEUED', stateVersion: 1 },
        data: expect.objectContaining({ status: 'PAUSED', stateVersion: { increment: 1 } }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'running', status: 'RUNNING', stateVersion: 2 },
        data: expect.objectContaining({ status: 'PAUSING', stateVersion: { increment: 1 } }),
      }),
    );
    expect(pause).toHaveBeenCalledWith('running');
    expect(pause).toHaveBeenCalledWith('pausing');
    expect(cancel).toHaveBeenCalledWith('cancelling');
  });

  it('can finish pausing while an undispatched host action remains staged for explicit resume', async () => {
    const finish = jest.fn();
    const prisma = {
      backgroundJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziTaskStep: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
    );
    (dispatcher as unknown as { finishTask: typeof finish }).finishTask = finish;

    await dispatcherTestApi(dispatcher).pauseRemaining('task-1');

    expect(prisma.msaidiziTaskStep.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        taskId: 'task-1',
        status: 'RUNNING',
        OR: expect.arrayContaining([
          { hostActions: { none: {} } },
          expect.objectContaining({ hostActions: expect.any(Object) }),
        ]),
      }),
    });
    expect(finish).toHaveBeenCalledWith('task-1', 'PAUSED', null);
  });

  it('cannot overwrite a won cancellation request with a late completion', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      msaidiziTask: { updateMany },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      { enabled: true } as never,
      config(),
    );

    await dispatcherTestApi(dispatcher).finishTask('task-cancelling', 'COMPLETED', null);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-cancelling', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(tx.msaidiziTaskEvent.create).not.toHaveBeenCalled();
  });

  it('cancels broker-staged host work without waiting for an offline device to poll', async () => {
    const finish = jest.fn();
    const devices = { cancelUndispatchedTaskActions: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      backgroundJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziTaskStep: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
      undefined,
      undefined,
      undefined,
      devices as never,
    );
    (dispatcher as unknown as { finishTask: typeof finish }).finishTask = finish;

    await dispatcherTestApi(dispatcher).cancelRemaining('task-offline-device');

    expect(devices.cancelUndispatchedTaskActions).toHaveBeenCalledWith('task-offline-device');
    expect(finish).toHaveBeenCalledWith('task-offline-device', 'CANCELLED', null);
  });

  it('closes a cancelled transient-read retry without touching live or mutation steps', async () => {
    const finish = jest.fn();
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      backgroundJob: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ payload: { stepId: 'step-live-read' } }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziTaskStep: {
        findFirst: jest.fn(),
        updateMany,
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
    );
    (dispatcher as unknown as { finishTask: typeof finish }).finishTask = finish;

    await dispatcherTestApi(dispatcher).cancelRemaining('task-cancel-read-retry');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: 'task-cancel-read-retry',
          mutation: false,
          status: 'RUNNING',
          id: { notIn: ['step-live-read'] },
          hostActions: {
            none: { status: { in: ['DISPATCHED', 'RUNNING'] } },
          },
        }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(finish).toHaveBeenCalledWith('task-cancel-read-retry', 'CANCELLED', null);
  });

  it.each(['COMPLETED', 'PARTIAL', 'FAILED', 'NEEDS_ATTENTION'] as const)(
    'emits one transaction-coupled %s notification only for the winning terminal CAS',
    async (status) => {
      const updateMany = jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const tx = {
        msaidiziTask: { updateMany },
        msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      const notifications = {
        notifyMsaidiziTaskTerminal: jest.fn().mockResolvedValue(true),
      };
      const dispatcher = new MsaidiziTaskDispatcherService(
        { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
        { enabled: true } as never,
        config(),
        undefined,
        notifications as never,
      );

      await dispatcherTestApi(dispatcher).finishTask('task-terminal', status, null);
      await dispatcherTestApi(dispatcher).finishTask('task-terminal', status, null);

      expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledWith(
        tx,
        'task-terminal',
        status,
      );
      expect(tx.msaidiziTaskEvent.create).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ wallTimeCheckpointAt: null, endedAt: expect.any(Date) }),
        }),
      );
    },
  );

  it('keeps the first-start wall clock open when PAUSING settles as PAUSED', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      { enabled: true } as never,
      config(),
    );

    await dispatcherTestApi(dispatcher).finishTask('task-paused', 'PAUSED', null);

    const data = updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('endedAt');
    expect(data).not.toHaveProperty('wallTimeCheckpointAt');
  });

  it('never configures a mutation job for whole-step retry', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ status: 'RUNNING' }]),
      msaidiziTaskStep: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      backgroundJob: { upsert },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
    );

    await dispatcherTestApi(dispatcher).enqueueStep('task-1', {
      id: 'step-write',
      idempotent: true,
      mutation: true,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
          maxAttempts: 1,
        }),
      }),
    );
  });

  it('serializes sibling claims across two dispatcher instances', async () => {
    const states = new Map([
      ['step-a', 'READY'],
      ['step-b', 'READY'],
    ]);
    const stepRows = () =>
      Array.from(states, ([id, status], sequence) => ({
        id,
        stepKey: id,
        sequence,
        status,
        dependencies: [],
        mutation: false,
        idempotent: true,
        budgets: { maxLocalBytes: 1_000 },
        bytesRead: 0n,
        bytesWritten: 0n,
        localIoAccountingValid: true,
      }));
    let lockTail = Promise.resolve();
    const lockCalls = jest.fn();
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      backgroundJob: { findMany: jest.fn().mockResolvedValue([]) },
      msaidiziTaskStep: { findMany: jest.fn().mockImplementation(stepRows) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (work: unknown) => {
      let release: (() => void) | undefined;
      const tx = {
        $queryRaw: jest.fn(async () => {
          lockCalls();
          const previous = lockTail;
          let unlock!: () => void;
          lockTail = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          await previous;
          release = unlock;
          return [{ status: 'RUNNING' }];
        }),
        msaidiziTaskStep: {
          count: jest.fn(
            async () =>
              Array.from(states.values()).filter((status) => ['LEASED', 'RUNNING'].includes(status))
                .length,
          ),
          updateMany: jest.fn(async ({ where, data }) => {
            if (states.get(where.id) !== where.status) return { count: 0 };
            states.set(where.id, data.status);
            return { count: 1 };
          }),
        },
        backgroundJob: { upsert },
        msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      try {
        if (typeof work !== 'function') throw new Error('unexpected transaction input');
        return await (work as (client: typeof tx) => unknown)(tx);
      } finally {
        release?.();
      }
    });
    const first = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
    );
    const second = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
    );
    const runningTask = {
      id: 'task-1',
      status: 'RUNNING',
      activePlanVersion: 1,
      startedAt: new Date(),
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: new Date(),
      maxWallTimeSeconds: 7_200,
      attemptedToolCalls: 0,
      maxAttemptedToolCalls: 10,
      mutations: 0,
      maxMutations: 10,
    };

    const results = await Promise.all([
      dispatcherTestApi(first).advance(runningTask),
      dispatcherTestApi(second).advance(runningTask),
    ]);

    expect(results.reduce((total, result) => total + result, 0)).toBe(1);
    expect(Array.from(states.values()).filter((status) => status === 'LEASED')).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(lockCalls).toHaveBeenCalled();
  });

  it('reconciles a dead mutation before finalizing a cancellation after restart', async () => {
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const cancelQueuedJobs = jest.fn();
    const tx = {
      msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'attempt-1',
          status: MsaidiziToolAttemptStatus.RUNNING,
          resultSummary: {
            externalEgress: {
              settlementStatus: 'RESERVED',
              metering: 'adapter-receipt-v1',
              reservedExternalEgressBytes: 8_192,
              chargedExternalEgressBytes: 0,
            },
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      msaidiziTask: { updateMany: taskUpdateMany },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      backgroundJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'job-dead',
            payload: { stepId: 'step-write' },
            errorMessage: 'worker lease expired',
          },
        ]),
        updateMany: cancelQueuedJobs,
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue({ id: 'step-write', mutation: true }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true } as never,
      config(),
    );

    await expect(
      dispatcherTestApi(dispatcher).advance({
        id: 'task-cancelling',
        status: 'CANCELLING',
        activePlanVersion: 1,
        startedAt: new Date(),
        consumedWallTimeMs: 0n,
        wallTimeCheckpointAt: new Date(),
        maxWallTimeSeconds: 7_200,
        attemptedToolCalls: 1,
        maxAttemptedToolCalls: 10,
        mutations: 1,
        maxMutations: 10,
      }),
    ).resolves.toBe(0);

    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-cancelling',
          status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] },
        },
        data: expect.objectContaining({
          status: 'NEEDS_ATTENTION',
          failureCode: 'UNKNOWN_WRITE_OUTCOME',
        }),
      }),
    );
    expect(tx.msaidiziTaskStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'step-write',
          taskId: 'task-cancelling',
          status: { in: ['LEASED', 'RUNNING'] },
        },
        data: expect.objectContaining({ status: 'NEEDS_ATTENTION' }),
      }),
    );
    expect(tx.msaidiziToolAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-1', status: MsaidiziToolAttemptStatus.RUNNING },
        data: expect.objectContaining({
          status: MsaidiziToolAttemptStatus.UNKNOWN,
          resultSummary: {
            externalEgress: expect.objectContaining({
              settlementStatus: 'SETTLED',
              verified: false,
              reservedExternalEgressBytes: 8_192,
              chargedExternalEgressBytes: 8_192,
              errorCode: 'ERP_EGRESS_RECEIPT_MISSING',
            }),
          },
        }),
      }),
    );
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task-cancelling',
          reservedExternalEgressBytes: { gte: 8_192n },
        },
        data: expect.objectContaining({
          reservedExternalEgressBytes: { decrement: 8_192n },
          externalEgressBytes: { increment: 8_192n },
        }),
      }),
    );
    expect(cancelQueuedJobs).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal step when dead-job discovery races late completion', async () => {
    const stepUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const attemptFindFirst = jest.fn();
    const taskUpdateMany = jest.fn();
    const eventCreate = jest.fn();
    const tx = {
      msaidiziTaskStep: { updateMany: stepUpdateMany },
      msaidiziToolAttempt: { findFirst: attemptFindFirst },
      msaidiziTask: { updateMany: taskUpdateMany },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      {
        backgroundJob: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'job-stale-discovery',
              payload: { stepId: 'step-late-success' },
              errorMessage: 'worker lease expired',
            },
          ]),
        },
        msaidiziTaskStep: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'step-late-success',
            mutation: true,
          }),
        },
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as never,
      { enabled: true } as never,
      config(),
    );

    await expect(
      dispatcherTestApi(dispatcher).reconcileDeadStepJobs('task-late-success'),
    ).resolves.toBe(false);

    expect(stepUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'step-late-success',
        taskId: 'task-late-success',
        status: { in: ['LEASED', 'RUNNING'] },
      },
      data: { status: 'NEEDS_ATTENTION', endedAt: expect.any(Date) },
    });
    expect(attemptFindFirst).not.toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('does not treat a dead step job as an unknown write after durable host handoff', async () => {
    const stepFindFirst = jest.fn().mockResolvedValue(null);
    const transaction = jest.fn();
    const dispatcher = new MsaidiziTaskDispatcherService(
      {
        backgroundJob: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'job-died-after-host-queue',
              payload: { stepId: 'step-owned-by-host-action' },
              errorMessage: 'worker lease expired after queue commit',
            },
          ]),
        },
        msaidiziTaskStep: { findFirst: stepFindFirst },
        $transaction: transaction,
      } as never,
      { enabled: true } as never,
      config(),
    );

    await expect(
      dispatcherTestApi(dispatcher).reconcileDeadStepJobs('task-host-owned'),
    ).resolves.toBe(false);

    expect(stepFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'step-owned-by-host-action',
        taskId: 'task-host-owned',
        status: { in: ['LEASED', 'RUNNING'] },
        hostActions: {
          none: { status: { in: ['QUEUED', 'DISPATCHED', 'RUNNING'] } },
        },
      },
      select: { id: true, mutation: true },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rolls back dead-step reconciliation when a no-egress attempt settles first', async () => {
    const attemptUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const taskUpdateMany = jest.fn();
    const eventCreate = jest.fn();
    const tx = {
      msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'attempt-late-success',
          status: MsaidiziToolAttemptStatus.RUNNING,
          resultSummary: null,
        }),
        updateMany: attemptUpdateMany,
      },
      msaidiziTask: { updateMany: taskUpdateMany },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      {
        backgroundJob: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'job-no-egress-race',
              payload: { stepId: 'step-no-egress-race' },
              errorMessage: 'worker lease expired',
            },
          ]),
        },
        msaidiziTaskStep: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'step-no-egress-race',
            mutation: true,
          }),
        },
        $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      } as never,
      { enabled: true } as never,
      config(),
    );

    await expect(
      dispatcherTestApi(dispatcher).reconcileDeadStepJobs('task-no-egress-race'),
    ).rejects.toThrow('Dead mutation attempt reconciliation CAS lost');

    expect(attemptUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-late-success',
          status: MsaidiziToolAttemptStatus.RUNNING,
        },
        data: expect.objectContaining({ status: MsaidiziToolAttemptStatus.UNKNOWN }),
      }),
    );
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('requires both the Msaidizi and generic job workers before dispatching', async () => {
    const findMany = jest.fn();
    const dispatcher = new MsaidiziTaskDispatcherService(
      { msaidiziTask: { findMany } } as never,
      { enabled: true } as never,
      config({ MSAIDIZI_TASK_WORKER_ENABLED: 'true', JOB_WORKER_ENABLED: 'false' }),
    );

    await expect(dispatcher.dispatchOnce()).resolves.toEqual({
      started: 0,
      processed: 0,
      enqueued: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('holds a schedule row lock and leaves later QUEUE occurrences queued', async () => {
    const updateMany = jest.fn();
    const checkpoint = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'schedule-1' }]),
      msaidiziTask: { count: jest.fn().mockResolvedValue(1), updateMany },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: {
        updateMany: checkpoint,
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'later-task',
            stateVersion: 0,
            mode: 'AUTOPILOT',
            scheduleId: 'schedule-1',
            createdAt: new Date('2026-08-25T05:01:00.000Z'),
            startedAt: null,
            consumedWallTimeMs: 0n,
            wallTimeCheckpointAt: null,
            maxWallTimeSeconds: 7_200,
            principal: { status: 'ACTIVE' },
            mandate: { status: 'ACTIVE', startsAt: null, expiresAt: null },
            schedule: { concurrencyMode: 'QUEUE' },
          },
        ]),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true, autopilotEnabled: true } as never,
      config(),
    );

    await expect(dispatcherTestApi(dispatcher).startQueued(20)).resolves.toBe(0);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziTask.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scheduleId: 'schedule-1' }),
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(checkpoint).toHaveBeenCalledWith({
      where: { status: 'QUEUED', startedAt: { not: null }, endedAt: null },
      data: { lastCheckpointAt: expect.any(Date) },
    });
  });

  it('preserves the first task start when a paused task is resumed', async () => {
    const firstStartedAt = new Date(Date.now() - 60_000);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const checkpoint = jest.fn().mockResolvedValue({ count: 1 });
    const eventCreate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziTask: { updateMany },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      msaidiziTask: {
        updateMany: checkpoint,
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'resumed-task',
            stateVersion: 4,
            mode: 'WORK_WITH_ME',
            scheduleId: null,
            createdAt: new Date(),
            startedAt: firstStartedAt,
            consumedWallTimeMs: 60_000n,
            wallTimeCheckpointAt: new Date(),
            maxWallTimeSeconds: 7_200,
            principal: { status: 'ACTIVE' },
            mandate: null,
            schedule: null,
          },
        ]),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true, autopilotEnabled: true } as never,
      config(),
    );

    await expect(dispatcherTestApi(dispatcher).startQueued(20)).resolves.toBe(1);

    const mutation = updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(mutation.where).toMatchObject({
      id: 'resumed-task',
      status: 'QUEUED',
      stateVersion: 4,
      startedAt: firstStartedAt,
    });
    expect(mutation.data).not.toHaveProperty('startedAt');
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'resumed-task',
        type: 'task.running',
        payload: expect.objectContaining({
          startedAt: firstStartedAt.toISOString(),
          resumedAt: expect.any(String),
        }),
      }),
    });
    expect(checkpoint).toHaveBeenCalledTimes(1);
  });

  it('expires a resumed queued task before dispatch when paused time spent its wall ceiling', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const checkpoint = jest.fn().mockResolvedValue({ count: 1 });
    const eventCreate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziTask: { updateMany },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      msaidiziTask: {
        updateMany: checkpoint,
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'expired-resumed-task',
            stateVersion: 7,
            mode: 'WORK_WITH_ME',
            scheduleId: null,
            createdAt: new Date(),
            startedAt: new Date(Date.now() - 5_000),
            consumedWallTimeMs: 5_000n,
            wallTimeCheckpointAt: new Date(),
            maxWallTimeSeconds: 1,
            principal: { status: 'ACTIVE' },
            mandate: null,
            schedule: null,
          },
        ]),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma as never,
      { enabled: true, autopilotEnabled: true } as never,
      config(),
    );

    await expect(dispatcherTestApi(dispatcher).startQueued(20)).resolves.toBe(0);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'expired-resumed-task',
          status: 'QUEUED',
          stateVersion: 7,
        },
        data: expect.objectContaining({
          status: 'NEEDS_ATTENTION',
          failureCode: 'WALL_TIME_EXHAUSTED',
          statusDetail: 'Task wall-time ceiling elapsed while the task was paused or queued',
        }),
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'expired-resumed-task',
        type: 'task.dispatch_rejected',
        payload: { failureCode: 'WALL_TIME_EXHAUSTED' },
      }),
    });
  });
});
