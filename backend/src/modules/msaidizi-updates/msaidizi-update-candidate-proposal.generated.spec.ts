import {
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateEvaluationRunStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { MsaidiziUpdateCandidateProposalService } from './msaidizi-update-candidate-proposal.service';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from './update-candidate-proposal.port';

describe('Msaidizi generated update proposal orchestration', () => {
  it('fails before persistence when autonomous execution is disabled', async () => {
    const harness = generatedHarness();
    const service = generatedService(harness, false);

    await expect(service.propose(request)).rejects.toMatchObject({ code: 'AUTONOMY_DISABLED' });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.artifacts.prepareToolObservation).not.toHaveBeenCalled();
  });

  it('atomically binds generated source, reserves the full ceiling, and queues one VM run', async () => {
    const harness = generatedHarness();
    const service = generatedService(harness);

    const result = await service.propose(request);

    expect(result).toEqual(
      expect.objectContaining({
        status: MsaidiziUpdateCandidateStatus.EVALUATING,
        evaluationRunStatus: MsaidiziUpdateEvaluationRunStatus.QUEUED,
        replay: false,
      }),
    );
    expect(harness.tx.msaidiziTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelTurns: { increment: 4 },
          bytesRead: { increment: 10_485_760n },
          bytesWritten: { increment: 10_485_760n },
          externalEgressBytes: { increment: 1_048_576n },
        }),
      }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: MsaidiziUpdateCandidateStatus.EVALUATING,
        generatedSourceArtifactId: generationArtifactId,
        generationManifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(harness.tx.msaidiziUpdateEvaluationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: MsaidiziUpdateEvaluationRunStatus.QUEUED,
        generationArtifactId,
        generatorPrincipalId: principalId,
        generatorModelId: 'generator-model-v2',
        requiredChecks: expect.objectContaining({
          baseRevisionMatch: true,
          ntfsReparseHardLinkAndToctouIsolation: true,
          dualIndependentModelReview: true,
        }),
      }),
    });
    expect(harness.artifacts.finishPreparedToolObservation).toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
  });

  it.each([
    [MsaidiziUpdateCandidateStatus.EVALUATING, MsaidiziUpdateEvaluationRunStatus.LEASED],
    [MsaidiziUpdateCandidateStatus.EVALUATING, MsaidiziUpdateEvaluationRunStatus.RUNNING],
    [MsaidiziUpdateCandidateStatus.APPROVED, MsaidiziUpdateEvaluationRunStatus.SUCCEEDED],
    [MsaidiziUpdateCandidateStatus.ACTIVE, MsaidiziUpdateEvaluationRunStatus.SUCCEEDED],
    [MsaidiziUpdateCandidateStatus.REJECTED, MsaidiziUpdateEvaluationRunStatus.REJECTED],
    [MsaidiziUpdateCandidateStatus.FAILED, MsaidiziUpdateEvaluationRunStatus.CANCELLED],
  ])(
    'replays the immutable progressed state %s/%s without generating or reserving twice',
    async (candidateStatus, runStatus) => {
      const harness = generatedHarness();
      const service = generatedService(harness);
      await service.propose(request);
      harness.state.candidate!.status = candidateStatus;
      harness.state.run!.status = runStatus;
      jest.clearAllMocks();

      await expect(service.propose(request)).resolves.toEqual(
        expect.objectContaining({
          status: candidateStatus,
          evaluationRunStatus: runStatus,
          replay: true,
        }),
      );
      expect(harness.artifacts.prepareToolObservation).not.toHaveBeenCalled();
      expect(harness.tx.msaidiziTask.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
      expect(harness.tx.msaidiziUpdateEvaluationRun.create).not.toHaveBeenCalled();
    },
  );
});

const now = new Date('2026-08-28T08:00:00.000Z');
const taskId = '11111111-1111-4111-8111-111111111111';
const planVersionId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const mandateId = '55555555-5555-4555-8555-555555555555';
const principalId = '66666666-6666-4666-8666-666666666666';
const userId = '77777777-7777-4777-8777-777777777777';
const generationArtifactId = '88888888-8888-4888-8888-888888888888';
const request = { taskId, planVersionId, stepId, attemptId };

function generatedArguments() {
  const source = Buffer.from(
    'export const boundedGeneratedValue = (input: number): number => input + 1;\n',
    'utf8',
  );
  return {
    name: 'Bounded generated application update',
    version: '2.0.0',
    scope: 'APPLICATION',
    rollbackVersion: '1.9.0',
    rationale: 'Evaluate a bounded source change using the isolated Windows pipeline.',
    baseRevisionSha256: 'a'.repeat(64),
    changes: [
      {
        relativePath: 'backend/src/modules/orders/bounded-generated-value.ts',
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

function generatedHarness() {
  const argumentsValue = generatedArguments();
  const dataClass = proposalDataClass('APPLICATION');
  const mandate = {
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
        dataClasses: [dataClass],
      },
    ],
  };
  const task = {
    id: taskId,
    principalId,
    initiatedByUserId: userId,
    companyId: 'company-1',
    mandateId,
    mode: MsaidiziTaskMode.AUTOPILOT,
    status: MsaidiziTaskStatus.RUNNING,
    activePlanVersion: 1,
    startedAt: new Date('2026-08-28T07:55:00.000Z'),
    consumedWallTimeMs: 0n,
    wallTimeCheckpointAt: now,
    maxWallTimeSeconds: 7_200,
    maxModelTurns: 200,
    maxLocalBytes: 5_368_709_120n,
    maxExternalEgressBytes: 262_144_000n,
    maxModelCostUsd: new Prisma.Decimal(20),
    modelTurns: 1,
    inputTokens: 100n,
    outputTokens: 20n,
    bytesRead: 0n,
    bytesWritten: 0n,
    externalEgressBytes: 0n,
    reservedExternalEgressBytes: 0n,
    modelCostUsd: new Prisma.Decimal(0),
    proposalUsage: { model: 'Generator-Model-V2' },
    principal: { status: 'ACTIVE' },
    mandate,
  };
  const step = {
    id: stepId,
    taskId,
    planVersionId,
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
    arguments: argumentsValue,
    expectedEffect: 'WRITE',
    dataClass,
    idempotent: true,
    mutation: true,
    status: MsaidiziTaskStepStatus.RUNNING,
    budgets: {},
    bytesRead: 0n,
    bytesWritten: 0n,
    localIoAccountingValid: true,
    planVersion: { id: planVersionId, taskId, version: 1, createdByUserId: userId },
  };
  const state: {
    candidate: (Record<string, unknown> & { status: MsaidiziUpdateCandidateStatus }) | null;
    run: (Record<string, unknown> & { status: MsaidiziUpdateEvaluationRunStatus }) | null;
  } = { candidate: null, run: null };
  const tx = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('clock_timestamp')) return [{ now }];
      if (sql.includes('msaidizi_mandates')) return [{ id: mandateId }];
      return [{ id: taskId }];
    }),
    msaidiziTask: {
      findUnique: jest.fn().mockResolvedValue(task),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziMandate: { findUnique: jest.fn().mockResolvedValue(mandate) },
    msaidiziTaskStep: {
      findFirst: jest.fn().mockResolvedValue(step),
      findUnique: jest.fn().mockResolvedValue(step),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    msaidiziToolAttempt: {
      findFirst: jest.fn().mockResolvedValue({
        id: attemptId,
        status: MsaidiziToolAttemptStatus.RUNNING,
      }),
    },
    msaidiziUpdateCandidate: {
      findUnique: jest.fn(async () =>
        state.candidate ? { ...state.candidate, evaluationRun: state.run } : null,
      ),
      create: jest.fn(async ({ data }) => {
        state.candidate = { ...data, status: data.status };
        return state.candidate;
      }),
    },
    msaidiziUpdateEvaluationRun: {
      create: jest.fn(async ({ data }) => {
        state.run = { ...data, status: data.status };
        return state.run;
      }),
    },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const artifacts = {
    prepareToolObservation: jest.fn(async (input) => ({
      artifact: {
        id: generationArtifactId,
        sha256: input.persistedSha256,
        mimeType: 'application/json',
        kind: 'FILE',
        trustLevel: 'UNTRUSTED',
      },
      replay: false,
    })),
    commitPreparedToolObservation: jest.fn(async (_tx, prepared) => ({
      artifact: prepared.artifact,
    })),
    finishPreparedToolObservation: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    $transaction: jest.fn(async (work) => work(tx)),
    msaidiziUpdateCandidate: {
      findUnique: jest.fn(async () =>
        state.candidate ? { ...state.candidate, evaluationRun: state.run } : null,
      ),
    },
  };
  return { prisma, tx, artifacts, state };
}

function generatedService(harness: ReturnType<typeof generatedHarness>, enabled = true) {
  return new MsaidiziUpdateCandidateProposalService(
    harness.prisma as never,
    { enabled, globalKillSwitchActive: false } as never,
    {
      logStrictInTransaction: jest.fn((tx, input) => tx.auditLog.create({ data: input })),
    } as never,
    harness.artifacts as never,
  );
}
