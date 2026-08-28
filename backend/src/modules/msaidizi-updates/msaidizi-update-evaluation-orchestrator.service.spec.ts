import {
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateEvaluationRunStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  assertEvaluationRunBinding,
  MsaidiziUpdateEvaluationOrchestrator,
} from './msaidizi-update-evaluation-orchestrator.service';
import {
  GENERATED_UPDATE_POLICY_VERSION,
  GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
  generatedUpdateEvaluationRequestDigest,
  generatedUpdateManifest,
  generatedUpdateRequiredChecks,
  parseUpdateCandidateProposalArguments,
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
  updateCandidateProposalDigest,
} from './update-candidate-proposal.port';

describe('MsaidiziUpdateEvaluationOrchestrator', () => {
  it('accepts JSONB-reordered required checks while rejecting any immutable policy substitution', () => {
    const run = evaluationRun();
    run.requiredChecks = Object.fromEntries(
      Object.entries(generatedUpdateRequiredChecks()).reverse(),
    );
    expect(() => assertEvaluationRunBinding(run as never)).not.toThrow();

    run.policyDigest = 'f'.repeat(64);
    expect(() => assertEvaluationRunBinding(run as never)).toThrow(
      'Evaluation run immutable binding is invalid',
    );
  });

  it('terminalizes a cancelled owner with the database clock and never mutates terminal task usage', async () => {
    const run = evaluationRun({ taskStatus: MsaidiziTaskStatus.CANCELLING });
    const harness = orchestratorHarness(run);

    await expect(harness.service.heartbeat(run.id, run.leaseId!, usage())).resolves.toEqual({
      accepted: false,
      stop: true,
      failureCode: 'EVALUATION_TASK_AUTHORITY_CANCELLED',
    });
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateEvaluationRunStatus.FAILED,
          leaseId: null,
          leaseExpiresAt: null,
          completedAt: databaseNow,
        }),
      }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: MsaidiziUpdateCandidateStatus.FAILED } }),
    );
    expect('msaidiziTask' in harness.tx).toBe(false);
    const locks = harness.tx.$queryRaw.mock.calls.map(([query]) => query.join(''));
    const candidateLock = locks.findIndex(
      (sql) => sql.includes('FROM "msaidizi_update_candidates"') && sql.includes('FOR UPDATE'),
    );
    const principalLock = locks.findIndex((sql) => sql.includes('FROM "msaidizi_principals"'));
    const taskLock = locks.findIndex(
      (sql) => sql.includes('FROM "msaidizi_tasks"') && sql.includes('FOR SHARE'),
    );
    const mandateLock = locks.findIndex((sql) => sql.includes('FROM "msaidizi_mandates"'));
    const stepLock = locks.findIndex((sql) => sql.includes('FROM "msaidizi_task_steps"'));
    const runLock = locks.findIndex(
      (sql) =>
        sql.includes('FROM "msaidizi_update_evaluation_runs"') &&
        sql.includes('FOR UPDATE') &&
        !sql.includes('msaidizi_update_candidates'),
    );
    expect(candidateLock).toBeGreaterThanOrEqual(0);
    expect(principalLock).toBeGreaterThan(candidateLock);
    expect(taskLock).toBeGreaterThan(principalLock);
    expect(mandateLock).toBeGreaterThan(taskLock);
    expect(stepLock).toBeGreaterThan(mandateLock);
    expect(runLock).toBeGreaterThan(stepLock);
  });

  it('stops a live lease immediately after the exact v2 mandate grant is revoked', async () => {
    const run = evaluationRun();
    run.task.mandate.capabilities = [
      {
        capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
        version: '1',
        effects: ['WRITE'],
        dataClasses: [run.step.dataClass],
      },
    ];
    const harness = orchestratorHarness(run);

    await expect(harness.service.heartbeat(run.id, run.leaseId!, usage())).resolves.toMatchObject({
      accepted: false,
      stop: true,
      failureCode: 'EVALUATION_TASK_AUTHORITY_REVOKED',
    });
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leaseId: null, completedAt: databaseNow }),
      }),
    );
  });

  it('moves an expired running lease to NEEDS_ATTENTION and never requeues the whole evaluation', async () => {
    const run = evaluationRun();
    run.leaseExpiresAt = new Date(databaseNow.getTime() - 1);
    const harness = orchestratorHarness(run, { poll: true });

    await expect(harness.service.poll()).resolves.toEqual({ run: null });
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.id, status: MsaidiziUpdateEvaluationRunStatus.RUNNING },
        data: expect.objectContaining({
          status: MsaidiziUpdateEvaluationRunStatus.NEEDS_ATTENTION,
          failureCode: 'EVALUATION_RUNNING_LEASE_EXPIRED',
          leaseId: null,
        }),
      }),
    );
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: run.id }),
        data: expect.objectContaining({ status: MsaidiziUpdateEvaluationRunStatus.QUEUED }),
      }),
    );
  });

  it('requeues an expired prestart lease only after candidate-first authority locking', async () => {
    const run = evaluationRun();
    run.status = MsaidiziUpdateEvaluationRunStatus.LEASED;
    run.leaseExpiresAt = new Date(databaseNow.getTime() - 1);
    run.dispatchCount = 1;
    const harness = orchestratorHarness(run, { poll: true });

    await expect(harness.service.poll()).resolves.toEqual({ run: null });
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: run.id,
          candidateId: run.candidateId,
          status: MsaidiziUpdateEvaluationRunStatus.LEASED,
          leaseId: run.leaseId,
          leaseGeneration: run.leaseGeneration,
          dispatchCount: run.dispatchCount,
        }),
        data: expect.objectContaining({
          status: MsaidiziUpdateEvaluationRunStatus.QUEUED,
          leaseId: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    const sql = harness.tx.$queryRaw.mock.calls.map(([query]) => query.join(''));
    const candidateLock = sql.findIndex(
      (statement) =>
        statement.includes('FROM "msaidizi_update_candidates"') && statement.includes('FOR UPDATE'),
    );
    const principalLock = sql.findIndex((statement) =>
      statement.includes('FROM "msaidizi_principals"'),
    );
    const runLock = sql.findIndex(
      (statement) =>
        statement.includes('FROM "msaidizi_update_evaluation_runs"') &&
        statement.includes('FOR UPDATE') &&
        !statement.includes('msaidizi_update_candidates'),
    );
    const mutationOrder =
      harness.tx.msaidiziUpdateEvaluationRun.updateMany.mock.invocationCallOrder[0];
    expect(candidateLock).toBeGreaterThanOrEqual(0);
    expect(principalLock).toBeGreaterThan(candidateLock);
    expect(runLock).toBeGreaterThan(principalLock);
    expect(harness.tx.$queryRaw.mock.invocationCallOrder[runLock]).toBeLessThan(mutationOrder);
  });

  it('uses a fresh post-lock database clock before dispatching a queued run', async () => {
    const run = evaluationRun();
    run.status = MsaidiziUpdateEvaluationRunStatus.QUEUED;
    const expiredAfterWait = new Date(run.deadlineAt.getTime() + 1);
    const harness = orchestratorHarness(run, {
      poll: true,
      queuedSelection: true,
      databaseClocks: [databaseNow, expiredAfterWait],
    });

    await expect(harness.service.poll()).resolves.toEqual({ run: null });
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.id, status: MsaidiziUpdateEvaluationRunStatus.QUEUED },
        data: expect.objectContaining({
          status: MsaidiziUpdateEvaluationRunStatus.CANCELLED,
          failureCode: 'EVALUATION_TASK_WALL_TIME_EXCEEDED',
          completedAt: expiredAfterWait,
        }),
      }),
    );
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziUpdateEvaluationRunStatus.LEASED }),
      }),
    );
  });

  it('uses the database clock to cancel every active run when the global kill switch trips', async () => {
    const run = evaluationRun();
    const harness = orchestratorHarness(run, { kill: true });

    await expect(harness.service.enforceExecutionGate()).rejects.toThrow(
      'Autonomous update evaluation is disabled',
    );
    expect(harness.tx.msaidiziUpdateEvaluationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateEvaluationRunStatus.CANCELLED,
          completedAt: databaseNow,
          leaseId: null,
        }),
      }),
    );
  });
});

const databaseNow = new Date('2026-08-28T08:05:00.000Z');
const reservationClock = new Date('2026-08-28T08:00:00.000Z');
const taskId = '11111111-1111-4111-8111-111111111111';
const planVersionId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const candidateId = '55555555-5555-4555-8555-555555555555';
const artifactId = '66666666-6666-4666-8666-666666666666';
const mandateId = '77777777-7777-4777-8777-777777777777';
const principalId = '88888888-8888-4888-8888-888888888888';

function rawArguments() {
  const source = Buffer.from('export const evaluatedValue = 7;\n', 'utf8');
  return {
    name: 'Bounded evaluated application update',
    version: '2.0.0',
    scope: 'APPLICATION',
    rollbackVersion: '1.9.0',
    rationale: 'Exercise the bounded isolated evaluator ownership contract.',
    baseRevisionSha256: 'a'.repeat(64),
    changes: [
      {
        relativePath: 'backend/src/modules/orders/evaluated-value.ts',
        operation: 'ADD',
        expectedPreSha256: null,
        contentBase64: source.toString('base64'),
        contentSha256: createHash('sha256').update(source).digest('hex'),
      },
    ],
    evaluationBudget: {
      maxWallTimeSeconds: 600,
      maxCpuTimeSeconds: 1_200,
      maxBytesRead: '10485760',
      maxBytesWritten: '10485760',
      maxExternalEgressBytes: '1048576',
      maxModelTurns: 4,
      maxModelInputTokens: '10000',
      maxModelOutputTokens: '5000',
      maxModelCostMicrousd: '1000000',
    },
  };
}

function evaluationRun(overrides: { taskStatus?: MsaidiziTaskStatus } = {}) {
  const raw = rawArguments();
  const args = parseUpdateCandidateProposalArguments(raw);
  if (args.proposalKind !== 'GENERATED_PIPELINE') throw new Error('test fixture invalid');
  const proposalDigest = updateCandidateProposalDigest(taskId, planVersionId, stepId, args);
  const manifest = generatedUpdateManifest(taskId, planVersionId, stepId, attemptId, args);
  const evaluationRunId = `eval-${candidateId}`;
  const generatorModelId = 'generator-model-v2';
  const requestDigest = generatedUpdateEvaluationRequestDigest({
    candidateId,
    evaluationRunId,
    manifestSha256: manifest.sha256,
    proposalDigest,
    generatorModelId,
    args,
  });
  const deadlineAt = new Date(reservationClock.getTime() + 600_000);
  const step = {
    id: stepId,
    taskId,
    planVersionId,
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
    arguments: raw,
    expectedEffect: 'WRITE',
    dataClass: proposalDataClass('APPLICATION'),
    idempotent: true,
    mutation: true,
    planVersion: { id: planVersionId, taskId, version: 1, createdByUserId: 'user-1' },
  };
  return {
    id: '99999999-9999-4999-8999-999999999999',
    candidateId,
    taskId,
    planVersionId,
    stepId,
    attemptId,
    generationArtifactId: artifactId,
    generationArtifactSha256: manifest.sha256,
    generationManifestSha256: manifest.sha256,
    requestDigest,
    evaluationRunId,
    generatorPrincipalId: principalId,
    generatorModelId,
    policyVersion: GENERATED_UPDATE_POLICY_VERSION,
    policyDigest: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
    requiredChecks: generatedUpdateRequiredChecks(),
    provenance: {
      protectedSupervisorBoundary: 'EXCLUDED',
      protectedPathPolicyVersion: GENERATED_UPDATE_POLICY_VERSION,
      protectedPathPolicySha256: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
      taskWallTimeConsumedMsAtReservation: '0',
      taskWallTimeCheckpointAtReservation: reservationClock.toISOString(),
      wallTimeReservationClockAt: reservationClock.toISOString(),
      remainingTaskWallTimeMsAtReservation: '7200000',
      deadlineAt: deadlineAt.toISOString(),
    },
    status: MsaidiziUpdateEvaluationRunStatus.RUNNING as MsaidiziUpdateEvaluationRunStatus,
    maxWallTimeSeconds: 600,
    maxCpuTimeSeconds: 1_200,
    maxBytesRead: 10_485_760n,
    maxBytesWritten: 10_485_760n,
    maxExternalEgressBytes: 1_048_576n,
    maxModelTurns: 4,
    maxModelInputTokens: 10_000n,
    maxModelOutputTokens: 5_000n,
    maxModelCostMicrousd: 1_000_000n,
    usedCpuTimeSeconds: 1,
    usedBytesRead: 100n,
    usedBytesWritten: 100n,
    usedExternalEgressBytes: 0n,
    usedModelTurns: 2,
    usedModelInputTokens: 100n,
    usedModelOutputTokens: 50n,
    usedModelCostMicrousd: 10_000n,
    leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leaseGeneration: 1,
    leaseExpiresAt: new Date(databaseNow.getTime() + 60_000),
    dispatchCount: 1,
    failureCode: null,
    deadlineAt,
    queuedAt: reservationClock,
    leasedAt: new Date(reservationClock.getTime() + 1_000),
    startedAt: new Date(reservationClock.getTime() + 2_000),
    lastHeartbeatAt: databaseNow,
    completedAt: null,
    candidate: {
      id: candidateId,
      principalId,
      status: MsaidiziUpdateCandidateStatus.EVALUATING,
      proposalDigest,
      generatedSourceArtifactId: artifactId,
      generationManifestSha256: manifest.sha256,
      proposedByTaskId: taskId,
      proposedByPlanVersionId: planVersionId,
      proposedByStepId: stepId,
    },
    task: {
      id: taskId,
      status: overrides.taskStatus ?? MsaidiziTaskStatus.RUNNING,
      mode: MsaidiziTaskMode.AUTOPILOT,
      principalId,
      mandateId,
      maxWallTimeSeconds: 7_200,
      principal: { status: 'ACTIVE' },
      mandate: {
        id: mandateId,
        principalId,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-28T00:00:00.000Z'),
        expiresAt: new Date('2026-08-29T00:00:00.000Z'),
        capabilities: [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            version: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
            effects: ['WRITE'],
            dataClasses: [step.dataClass],
          },
        ],
      },
    },
    step,
    generationArtifact: {
      id: artifactId,
      taskId,
      stepId,
      sha256: manifest.sha256,
      encrypted: true,
      trustLevel: 'UNTRUSTED',
    },
  };
}

function usage() {
  return {
    leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cpuTimeSeconds: 2,
    bytesRead: '200',
    bytesWritten: '200',
    externalEgressBytes: '0',
    modelTurns: 2,
    modelInputTokens: '200',
    modelOutputTokens: '100',
    modelCostMicrousd: '20000',
  };
}

function orchestratorHarness(
  run: ReturnType<typeof evaluationRun>,
  options: {
    poll?: boolean;
    kill?: boolean;
    queuedSelection?: boolean;
    databaseClocks?: Date[];
  } = {},
) {
  let databaseClockIndex = 0;
  const findMany = jest.fn(async (args?: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    const clauses = Array.isArray(where.OR) ? (where.OR as Array<Record<string, unknown>>) : [];
    if (options.kill) return [run];
    if (!options.poll) return [];
    if (where.status === MsaidiziUpdateEvaluationRunStatus.LEASED) {
      return run.status === MsaidiziUpdateEvaluationRunStatus.LEASED &&
        run.leaseExpiresAt &&
        run.leaseExpiresAt <= databaseNow &&
        run.dispatchCount < 3
        ? [{ id: run.id, candidateId: run.candidateId }]
        : [];
    }
    if (clauses[0]?.deadlineAt) {
      const cancelledStatuses = new Set<MsaidiziTaskStatus>([
        MsaidiziTaskStatus.CANCELLING,
        MsaidiziTaskStatus.CANCELLED,
        MsaidiziTaskStatus.FAILED,
        MsaidiziTaskStatus.PARTIAL,
        MsaidiziTaskStatus.NEEDS_ATTENTION,
      ]);
      const taskCancelled = cancelledStatuses.has(run.task.status);
      return run.deadlineAt <= databaseNow || taskCancelled ? [run] : [];
    }
    if (clauses[0]?.status) {
      const expiredRunning =
        run.status === MsaidiziUpdateEvaluationRunStatus.RUNNING &&
        Boolean(run.leaseExpiresAt && run.leaseExpiresAt <= databaseNow);
      const exhaustedPrestart =
        run.status === MsaidiziUpdateEvaluationRunStatus.LEASED &&
        Boolean(run.leaseExpiresAt && run.leaseExpiresAt <= databaseNow) &&
        run.dispatchCount >= 3;
      return expiredRunning || exhaustedPrestart ? [run] : [];
    }
    if (
      where.status &&
      typeof where.status === 'object' &&
      'in' in (where.status as Record<string, unknown>)
    ) {
      return [run];
    }
    return [];
  });
  const tx = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('clock_timestamp')) {
        const clocks = options.databaseClocks ?? [databaseNow];
        const now = clocks[Math.min(databaseClockIndex, clocks.length - 1)];
        databaseClockIndex += 1;
        return [{ now }];
      }
      if (sql.includes('SKIP LOCKED')) {
        return options.queuedSelection ? [{ id: run.id }] : [];
      }
      if (
        sql.includes('msaidizi_update_evaluation_runs') &&
        sql.includes('msaidizi_update_candidates') &&
        sql.includes('msaidizi_tasks') &&
        !sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: run.id,
            candidateId: run.candidateId,
            taskId: run.taskId,
            stepId: run.stepId,
            principalId: run.task.principalId,
            mandateId: run.task.mandateId,
          },
        ];
      }
      if (sql.includes('msaidizi_update_candidates')) return [{ id: run.candidateId }];
      if (sql.includes('msaidizi_principals')) {
        return [{ id: run.task.principalId, status: run.task.principal.status }];
      }
      if (sql.includes('msaidizi_tasks')) return [{ id: run.taskId }];
      if (sql.includes('msaidizi_mandates')) return [{ id: run.task.mandateId }];
      if (sql.includes('msaidizi_task_steps')) return [{ id: run.stepId }];
      return [{ id: run.id }];
    }),
    msaidiziUpdateEvaluationRun: {
      findUnique: jest.fn().mockResolvedValue(run),
      findMany,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziUpdateCandidate: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (work) => work(tx)),
  };
  const service = new MsaidiziUpdateEvaluationOrchestrator(
    prisma as never,
    {} as never,
    { enabled: true, globalKillSwitchActive: options.kill ?? false } as never,
  );
  return { service, prisma, tx };
}
