import {
  MsaidiziArtifactKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTrustLevel,
  MsaidiziTrustedArtifactPurpose,
  MsaidiziUpdateCandidateStatus,
} from '@prisma/client';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalAttestationJson,
  parseArtifactAttestation,
  parseEvaluationRunnerAttestation,
  parseModelReviewAttestation,
} from './msaidizi-evaluator-attestation.protocol';
import { MsaidiziUpdateEvaluationService } from './msaidizi-update-evaluation.service';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from './update-candidate-proposal.port';

describe('MsaidiziUpdateEvaluationService', () => {
  it('removes the Multer temp file when signature verification rejects before ingestion', async () => {
    const harness = evaluationHarness();
    harness.keys.verify.mockImplementationOnce(() => {
      throw new Error('SIGNATURE_INVALID');
    });
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-evaluator-reject-'));
    const temporaryPath = path.join(temporaryRoot, 'upload.tmp');
    await fs.writeFile(temporaryPath, 'untrusted evaluator bytes');
    const envelope = signedEnvelope(
      artifactClaims({
        artifactId: sourceArtifactId,
        artifactPurpose: 'SOURCE',
        candidateId: null,
        name: 'source.zip',
        mimeType: 'application/zip',
        byteSize: '25',
        sha256: sourceSha256,
        nonce: '10101010-1010-4010-8010-101010101010',
      }),
      'S',
    );

    try {
      await expect(
        harness.service.ingestTrustedArtifact(
          { path: temporaryPath } as Express.Multer.File,
          envelope,
        ),
      ).rejects.toThrow('SIGNATURE_INVALID');
      await expect(fs.stat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(harness.artifactIngestion).not.toHaveBeenCalled();
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('atomically approves only one runner plus two independent signed approvals', async () => {
    const harness = evaluationHarness();
    const result = await harness.service.submit(candidateId, signedBundle());

    expect(result).toEqual(
      expect.objectContaining({
        candidateId,
        status: MsaidiziUpdateCandidateStatus.APPROVED,
        replay: false,
        deploymentCreated: false,
      }),
    );
    expect(harness.attestations).toHaveLength(3);
    expect(harness.candidate.status).toBe(MsaidiziUpdateCandidateStatus.APPROVED);
    expect(harness.tx.msaidiziUpdateCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          principal: { status: MsaidiziPrincipalStatus.ACTIVE },
          proposedByTask: expect.objectContaining({
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
          }),
        }),
      }),
    );
    expect(harness.tx.msaidiziTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'update_candidate.evaluation_decided' }),
      }),
    );
    expect('msaidiziUpdateDeployment' in harness.tx).toBe(false);
  });

  it('rejects on trusted negative evidence without creating a deployment', async () => {
    const harness = evaluationHarness();
    const result = await harness.service.submit(
      candidateId,
      signedBundle({
        runner: {
          checks: {
            isolatedWindowsVm: true,
            tests: false,
            staticAnalysis: true,
            adversarialEvaluation: true,
            supervisorIntegrity: true,
            protectedBoundaryDiff: true,
          },
          verdict: 'FAIL',
          failureCodes: ['TESTS_FAILED'],
        },
      }),
    );

    expect(result).toMatchObject({
      status: MsaidiziUpdateCandidateStatus.REJECTED,
      deploymentCreated: false,
    });
    expect(harness.candidate.status).toBe(MsaidiziUpdateCandidateStatus.REJECTED);
    expect('msaidiziUpdateDeployment' in harness.tx).toBe(false);
  });

  it.each([
    ['signer', { secondReview: { signerKeyId: 'review-key-a' } }, 'SIGNERS_NOT_INDEPENDENT'],
    ['reviewer', { secondReview: { reviewerId: 'reviewer-a' } }, 'REVIEWERS_NOT_INDEPENDENT'],
    ['model', { secondReview: { modelId: 'model-a-v1' } }, 'MODELS_NOT_INDEPENDENT'],
  ])('fails closed for duplicate %s identity', async (_label, overrides, code) => {
    const harness = evaluationHarness();
    await expect(harness.service.submit(candidateId, signedBundle(overrides))).rejects.toThrow(
      code,
    );
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses cross-task and ordinary untrusted artifacts', async () => {
    const crossTask = evaluationHarness({
      artifacts: artifacts().map((artifact, index) =>
        index === 0 ? { ...artifact, taskId: otherTaskId } : artifact,
      ),
    });
    await expect(crossTask.service.submit(candidateId, signedBundle())).rejects.toThrow(
      'EVALUATION_ARTIFACT_UNTRUSTED',
    );
    expect(crossTask.tx.msaidiziUpdateCandidate.updateMany).not.toHaveBeenCalled();

    const ordinaryUpload = evaluationHarness({
      artifacts: artifacts().map((artifact, index) =>
        index === 0
          ? {
              ...artifact,
              trustLevel: MsaidiziTrustLevel.UNTRUSTED,
              trustedPurpose: null,
              trustedEvidence: null,
            }
          : artifact,
      ),
    });
    await expect(ordinaryUpload.service.submit(candidateId, signedBundle())).rejects.toThrow(
      'EVALUATION_ARTIFACT_UNTRUSTED',
    );
  });

  it('refuses an inactive mandate even when all signatures are otherwise accepted', async () => {
    const candidate = candidateContext();
    candidate.proposedByTask.mandate.status = 'SUSPENDED';
    const harness = evaluationHarness({ candidate });

    await expect(harness.service.submit(candidateId, signedBundle())).rejects.toThrow(
      'EVALUATION_MANDATE_INACTIVE',
    );
    expect(harness.attestations).toHaveLength(0);
  });

  it.each([
    MsaidiziTaskStatus.CANCELLING,
    MsaidiziTaskStatus.CANCELLED,
    MsaidiziTaskStatus.FAILED,
    MsaidiziTaskStatus.PARTIAL,
    MsaidiziTaskStatus.NEEDS_ATTENTION,
  ])('refuses legacy artifact-backed approval after task status becomes %s', async (status) => {
    const candidate = candidateContext();
    candidate.proposedByTask.status = status;
    const harness = evaluationHarness({ candidate });

    await expect(harness.service.submit(candidateId, signedBundle())).rejects.toThrow(
      'EVALUATION_CANDIDATE_BINDING_INVALID',
    );
    expect(harness.tx.msaidiziUpdateCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('rejects secret-bearing signed rationale before opening a transaction', async () => {
    const harness = evaluationHarness();
    await expect(
      harness.service.submit(
        candidateId,
        signedBundle({
          firstReview: {
            rationale: 'authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890',
          },
        }),
      ),
    ).rejects.toThrow('ATTESTATION_DLP_REJECTED');
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns an exact replay and rejects changed evidence after decision', async () => {
    const harness = evaluationHarness();
    const bundle = signedBundle();
    const first = await harness.service.submit(candidateId, bundle);
    const replay = await harness.service.submit(candidateId, bundle);

    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(harness.attestations).toHaveLength(3);
    await expect(
      harness.service.submit(
        candidateId,
        signedBundle({ firstReview: { rationale: 'A materially different signed rationale.' } }),
      ),
    ).rejects.toThrow('Evaluation evidence replay does not match');
    expect(harness.attestations).toHaveLength(3);
  });

  it('serializes concurrent redelivery into one decision plus one exact replay', async () => {
    const harness = evaluationHarness({ serializeTransactions: true });
    const bundle = signedBundle();
    const results = await Promise.all([
      harness.service.submit(candidateId, bundle),
      harness.service.submit(candidateId, bundle),
    ]);

    expect(results.map((result) => result.replay).sort()).toEqual([false, true]);
    expect(harness.attestations).toHaveLength(3);
    expect(harness.tx.msaidiziUpdateCandidate.updateMany).toHaveBeenCalledTimes(1);
  });

  it('passes the authoritative database clock to every signature verification', async () => {
    const harness = evaluationHarness();
    await harness.service.submit(candidateId, signedBundle());

    expect(harness.keys.verify).toHaveBeenCalled();
    for (const call of harness.keys.verify.mock.calls) {
      expect(call[2]).toEqual(verificationNow);
    }
  });

  it('serializes a completed-task approval behind the global principal latch', async () => {
    const candidate = candidateContext();
    candidate.proposedByTask.status = MsaidiziTaskStatus.COMPLETED;
    const harness = evaluationHarness({
      candidate,
      livePrincipalStatus: MsaidiziPrincipalStatus.DISABLED,
    });

    await expect(harness.service.submit(candidateId, signedBundle())).rejects.toThrow(
      'EVALUATION_PRINCIPAL_INACTIVE',
    );
    expect(harness.tx.msaidiziUpdateCandidate.updateMany).not.toHaveBeenCalled();
    const principalLock = harness.tx.$queryRaw.mock.calls
      .map(([query]) => (Array.isArray(query) ? query.join(' ') : String(query)))
      .find((sql) => sql.includes('msaidizi_principals'));
    expect(principalLock).toContain('FOR SHARE');
  });

  it('rechecks the PostgreSQL clock after lock waits immediately before the final CAS', async () => {
    const candidate = candidateContext();
    candidate.proposedByTask.mandate.expiresAt = new Date(verificationNow.getTime() + 500);
    const harness = evaluationHarness({
      candidate,
      transactionClocks: [verificationNow, new Date(verificationNow.getTime() + 1_000)],
    });

    await expect(harness.service.submit(candidateId, signedBundle())).rejects.toThrow(
      'EVALUATION_MANDATE_INACTIVE',
    );
    expect(harness.tx.msaidiziUpdateCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('normalizes generator identities and forbids generator self-approval by signer or model', () => {
    const harness = evaluationHarness();
    const runner = parseEvaluationRunnerAttestation(
      signedEnvelope(generatedRunnerClaims({ signerKeyId: 'independent-runner' }), 'R'),
    );
    const safeReviews = [
      parseModelReviewAttestation(
        signedEnvelope(generatedReviewClaims({ runnerClaimsDigest: runner.claimsDigest }), 'A'),
      ),
      parseModelReviewAttestation(
        signedEnvelope(
          generatedReviewClaims({
            signerKeyId: 'independent-review-b',
            runnerClaimsDigest: runner.claimsDigest,
            reviewerId: 'independent-reviewer-b',
            modelId: 'independent-model-b',
            nonce: '17171717-1717-4717-8717-171717171717',
          }),
          'B',
        ),
      ),
    ];
    const boundary = harness.service as unknown as {
      assertGeneratedReviewIndependence: (
        run: Record<string, unknown>,
        runner: unknown,
        reviews: unknown[],
      ) => void;
    };
    const run = {
      generatorPrincipalId: 'Generator-Principal',
      generatorModelId: 'Generator-Model-V2',
    };

    expect(() =>
      boundary.assertGeneratedReviewIndependence(run, runner, safeReviews),
    ).not.toThrow();

    const selfRunner = parseEvaluationRunnerAttestation(
      signedEnvelope(generatedRunnerClaims({ signerKeyId: 'generator-principal' }), 'R'),
    );
    expect(() => boundary.assertGeneratedReviewIndependence(run, selfRunner, safeReviews)).toThrow(
      'EVALUATION_GENERATOR_SELF_APPROVAL',
    );

    const selfReview = parseModelReviewAttestation(
      signedEnvelope(
        generatedReviewClaims({
          runnerClaimsDigest: runner.claimsDigest,
          modelId: 'GENERATOR-MODEL-V2',
        }),
        'A',
      ),
    );
    expect(() =>
      boundary.assertGeneratedReviewIndependence(run, runner, [selfReview, safeReviews[1]]),
    ).toThrow('EVALUATION_GENERATOR_SELF_APPROVAL');
  });

  it('fails closed when a generated run is presented with legacy unsigned-binding evidence', () => {
    const harness = evaluationHarness();
    const bundle = signedBundle();
    const runner = parseEvaluationRunnerAttestation(bundle.runner);
    const reviews = bundle.reviews.map(parseModelReviewAttestation);
    const boundary = harness.service as unknown as {
      assertSignedGenerationBinding: (
        run: Record<string, unknown>,
        runner: unknown,
        reviews: unknown[],
      ) => void;
    };

    expect(() =>
      boundary.assertSignedGenerationBinding({ step: generatedProposalStep() }, runner, reviews),
    ).toThrow('EVALUATION_GENERATED_BINDING_REQUIRED');
  });

  it('matches signed terminal usage and lease generation to the locked durable counters', () => {
    const harness = evaluationHarness();
    const runner = parseEvaluationRunnerAttestation(
      signedEnvelope(generatedRunnerClaims({ signerKeyId: 'independent-runner' }), 'R'),
    );
    const reviews = [
      parseModelReviewAttestation(
        signedEnvelope(generatedReviewClaims({ runnerClaimsDigest: runner.claimsDigest }), 'A'),
      ),
      parseModelReviewAttestation(
        signedEnvelope(
          generatedReviewClaims({
            signerKeyId: 'independent-review-b',
            runnerClaimsDigest: runner.claimsDigest,
            reviewerId: 'independent-reviewer-b',
            modelId: 'independent-model-b',
            nonce: '17171717-1717-4717-8717-171717171717',
          }),
          'B',
        ),
      ),
    ];
    const boundary = harness.service as unknown as {
      assertGeneratedTerminalAccounting: (
        run: Record<string, unknown>,
        runner: unknown,
        reviews: unknown[],
        now: Date,
      ) => void;
    };
    const usage = generatedTerminalAccounting().finalUsage;
    const run = {
      status: 'RUNNING',
      leaseId: 'active-lease',
      leaseGeneration: 1,
      leaseExpiresAt: new Date(verificationNow.getTime() + 60_000),
      deadlineAt: new Date(verificationNow.getTime() + 120_000),
      startedAt: new Date(verificationNow.getTime() - 10_000),
      maxWallTimeSeconds: 600,
      maxCpuTimeSeconds: 600,
      maxBytesRead: 10_000n,
      maxBytesWritten: 10_000n,
      maxExternalEgressBytes: 10_000n,
      maxModelTurns: 10,
      maxModelInputTokens: 10_000n,
      maxModelOutputTokens: 10_000n,
      maxModelCostMicrousd: 1_000_000n,
      usedCpuTimeSeconds: usage.cpuTimeSeconds,
      usedBytesRead: BigInt(usage.bytesRead),
      usedBytesWritten: BigInt(usage.bytesWritten),
      usedExternalEgressBytes: BigInt(usage.externalEgressBytes),
      usedModelTurns: usage.modelTurns,
      usedModelInputTokens: BigInt(usage.modelInputTokens),
      usedModelOutputTokens: BigInt(usage.modelOutputTokens),
      usedModelCostMicrousd: BigInt(usage.modelCostMicrousd),
    };

    expect(() =>
      boundary.assertGeneratedTerminalAccounting(run, runner, reviews, verificationNow),
    ).not.toThrow();
    expect(() =>
      boundary.assertGeneratedTerminalAccounting(
        { ...run, usedBytesRead: run.usedBytesRead + 1n },
        runner,
        reviews,
        verificationNow,
      ),
    ).toThrow('EVALUATION_TERMINAL_ACCOUNTING_MISMATCH');
    const reviewWithDifferentUsage = parseModelReviewAttestation(
      signedEnvelope(
        generatedReviewClaims({
          signerKeyId: 'independent-review-c',
          runnerClaimsDigest: runner.claimsDigest,
          reviewerId: 'independent-reviewer-c',
          modelId: 'independent-model-c',
          nonce: '18181818-1818-4818-8818-181818181818',
          finalUsage: { ...usage, bytesRead: '101' },
        }),
        'C',
      ),
    );
    expect(() =>
      boundary.assertGeneratedTerminalAccounting(
        run,
        runner,
        [reviews[0], reviewWithDifferentUsage],
        verificationNow,
      ),
    ).toThrow('EVALUATION_TERMINAL_ACCOUNTING_MISMATCH');
    const reviewWithDifferentLeaseGeneration = parseModelReviewAttestation(
      signedEnvelope(
        generatedReviewClaims({
          signerKeyId: 'independent-review-d',
          runnerClaimsDigest: runner.claimsDigest,
          reviewerId: 'independent-reviewer-d',
          modelId: 'independent-model-d',
          nonce: '19191919-1919-4919-8919-191919191919',
          evaluationLeaseGeneration: 2,
        }),
        'D',
      ),
    );
    expect(() =>
      boundary.assertGeneratedTerminalAccounting(
        run,
        runner,
        [reviews[0], reviewWithDifferentLeaseGeneration],
        verificationNow,
      ),
    ).toThrow('EVALUATION_TERMINAL_ACCOUNTING_MISMATCH');
    expect(() =>
      boundary.assertGeneratedTerminalAccounting(
        { ...run, maxCpuTimeSeconds: usage.cpuTimeSeconds - 1 },
        runner,
        reviews,
        verificationNow,
      ),
    ).toThrow('EVALUATION_TERMINAL_BUDGET_INVALID');
  });
});

const candidateId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const otherTaskId = '20202020-2020-4020-8020-202020202020';
const planVersionId = '33333333-3333-4333-8333-333333333333';
const stepId = '44444444-4444-4444-8444-444444444444';
const sourceArtifactId = '55555555-5555-4555-8555-555555555555';
const rollbackArtifactId = '66666666-6666-4666-8666-666666666666';
const reportArtifactId = '77777777-7777-4777-8777-777777777777';
const principalId = '88888888-8888-4888-8888-888888888888';
const userId = '99999999-9999-4999-8999-999999999999';
const mandateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceSha256 = 'a'.repeat(64);
const rollbackSha256 = 'b'.repeat(64);
const reportSha256 = 'c'.repeat(64);
const rollbackVersion = '0.9.0';
const dataClass = proposalDataClass('ADAPTERS');
const verificationNow = new Date('2026-08-25T10:05:00.000Z');

function evaluationHarness(
  overrides: {
    candidate?: ReturnType<typeof candidateContext>;
    artifacts?: Array<Record<string, unknown>>;
    serializeTransactions?: boolean;
    livePrincipalStatus?: MsaidiziPrincipalStatus;
    transactionClocks?: Date[];
  } = {},
) {
  const candidate = overrides.candidate ?? candidateContext();
  const artifactRows = overrides.artifacts ?? artifacts();
  const attestations: Array<Record<string, unknown>> = [];
  let transactionClockIndex = 0;
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray | string) => {
      const sql = Array.isArray(query) ? query.join(' ') : String(query);
      if (sql.includes('msaidizi_update_candidates')) return [{ id: candidateId }];
      if (sql.includes('msaidizi_principals')) {
        return [
          {
            id: principalId,
            status: overrides.livePrincipalStatus ?? candidate.proposedByTask.principal.status,
          },
        ];
      }
      if (sql.includes('msaidizi_tasks')) {
        return [{ id: taskId, principalId, mandateId: candidate.proposedByTask.mandateId }];
      }
      if (sql.includes('msaidizi_mandates')) return [{ id: mandateId }];
      if (sql.includes('msaidizi_task_steps')) return [{ id: stepId }];
      if (sql.includes('msaidizi_update_evaluation_runs')) return [];
      if (sql.includes('clock_timestamp()')) {
        const clocks = overrides.transactionClocks ?? [verificationNow];
        const now = clocks[Math.min(transactionClockIndex, clocks.length - 1)];
        transactionClockIndex += 1;
        return [{ now }];
      }
      return [];
    }),
    msaidiziUpdateCandidate: {
      findUnique: jest.fn(async () => candidate),
      updateMany: jest.fn(async ({ data }) => {
        if (candidate.evaluationBundleDigest) return { count: 0 };
        Object.assign(candidate, data);
        return { count: 1 };
      }),
    },
    msaidiziArtifact: { findMany: jest.fn().mockResolvedValue(artifactRows) },
    msaidiziUpdateEvaluationRun: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    msaidiziUpdateEvaluationAttestation: {
      create: jest.fn(async ({ data }) => {
        attestations.push(data);
        return data;
      }),
      findMany: jest.fn(async () => attestations.map(({ claimsDigest }) => ({ claimsDigest }))),
    },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  let transactionTail: Promise<unknown> = Promise.resolve();
  const transaction = jest.fn((callback: (database: typeof tx) => Promise<unknown>) => {
    if (!overrides.serializeTransactions) return callback(tx);
    const current = transactionTail.then(() => callback(tx));
    transactionTail = current.catch(() => undefined);
    return current;
  });
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ now: verificationNow }]),
    $transaction: transaction,
  };
  const keys = { verify: jest.fn() };
  const artifactIngestion = jest.fn();
  const service = new MsaidiziUpdateEvaluationService(
    prisma as never,
    keys as never,
    { ingestTrustedUpdateArtifact: artifactIngestion } as never,
    {
      logStrictInTransaction: jest.fn((client: typeof tx, input: unknown) =>
        client.auditLog.create({ data: input }),
      ),
    } as never,
    {
      enforceExecutionGate: jest.fn().mockResolvedValue(undefined),
      assertExecutionGateOpen: jest.fn(),
    } as never,
  );
  return { service, prisma, tx, candidate, attestations, keys, artifactIngestion };
}

function candidateContext() {
  const args = {
    name: 'Itemba adapter candidate',
    version: '1.0.0',
    scope: 'ADAPTERS',
    sourceArtifactId,
    sourceArtifactSha256: sourceSha256,
    rollbackArtifactId,
    rollbackArtifactSha256: rollbackSha256,
    rollbackVersion,
    rationale: 'A bounded, recoverable adapter improvement.',
  };
  const proposedByStep = {
    id: stepId,
    taskId,
    planVersionId,
    stepKey: 'self-improvement-proposal',
    sequence: 1,
    name: 'Propose update candidate',
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: '1',
    arguments: args,
    dependencies: [],
    expectedEffect: 'WRITE',
    dataClass,
    preconditions: {},
    recovery: null,
    budgets: {},
    stopConditions: {},
    idempotent: true,
    mutation: true,
    status: 'COMPLETED',
    attemptCount: 1,
    startedAt: new Date(),
    checkpointedAt: new Date(),
    endedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const proposedByTask = {
    id: taskId,
    principalId,
    initiatedByUserId: userId,
    companyId: 'company-1',
    mandateId,
    mode: MsaidiziTaskMode.AUTOPILOT,
    status: MsaidiziTaskStatus.RUNNING as MsaidiziTaskStatus,
    activePlanVersion: 1,
    principal: { status: MsaidiziPrincipalStatus.ACTIVE },
    mandate: {
      id: mandateId,
      principalId,
      status: 'ACTIVE',
      startsAt: new Date(0),
      expiresAt: new Date(Date.now() + 60_000),
      capabilities: [
        {
          capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
          version: '1',
          effects: ['WRITE'],
          dataClasses: [dataClass],
        },
      ],
    },
  };
  return {
    id: candidateId,
    principalId,
    proposedByTaskId: taskId,
    proposedByPlanVersionId: planVersionId,
    proposedByStepId: stepId,
    proposalIdempotencyKey: 'proposal-idempotency',
    proposalDigest: 'd'.repeat(64),
    proposalRationale: args.rationale,
    sourceArtifactId,
    sourceArtifactSha256: sourceSha256,
    rollbackArtifactId,
    rollbackArtifactSha256: rollbackSha256,
    rollbackVersion,
    evaluationReportArtifactId: null as string | null,
    evaluationReportArtifactSha256: null as string | null,
    evaluationBundleDigest: null as string | null,
    evaluationDecidedAt: null as Date | null,
    name: args.name,
    version: args.version,
    scope: args.scope,
    status: MsaidiziUpdateCandidateStatus.DRAFT,
    evaluationSummary: {},
    reviewerDecisions: [],
    rolloutRing: 0,
    healthSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deployedAt: null,
    rolledBackAt: null,
    proposedByTask,
    proposedByPlanVersion: {
      id: planVersionId,
      taskId,
      version: 1,
      createdByUserId: userId,
      summary: 'Reviewed update plan',
      objective: 'Produce a bounded update proposal',
      inputs: {},
      stopConditions: {},
      budgetSnapshot: {},
      planDigest: 'e'.repeat(64),
      createdAt: new Date(),
    },
    proposedByStep,
  };
}

function artifacts() {
  return [
    trustedArtifact(
      'SOURCE',
      sourceArtifactId,
      sourceSha256,
      null,
      'source.zip',
      'application/zip',
    ),
    trustedArtifact(
      'ROLLBACK',
      rollbackArtifactId,
      rollbackSha256,
      null,
      'rollback.zip',
      'application/zip',
    ),
    trustedArtifact(
      'REPORT',
      reportArtifactId,
      reportSha256,
      candidateId,
      'evaluation-report.json',
      'application/json',
    ),
  ];
}

function trustedArtifact(
  purpose: 'SOURCE' | 'ROLLBACK' | 'REPORT',
  id: string,
  sha256: string,
  boundCandidateId: string | null,
  name: string,
  mimeType: string,
) {
  const claims = artifactClaims({
    artifactId: id,
    artifactPurpose: purpose,
    candidateId: boundCandidateId,
    name,
    mimeType,
    sha256,
    nonce:
      purpose === 'SOURCE'
        ? '10101010-1010-4010-8010-101010101010'
        : purpose === 'ROLLBACK'
          ? '12121212-1212-4212-8212-121212121212'
          : '13131313-1313-4313-8313-131313131313',
  });
  const envelope = signedEnvelope(claims, purpose.charAt(0));
  const parsed = parseArtifactAttestation(envelope);
  return {
    id,
    taskId,
    stepId,
    kind: MsaidiziArtifactKind.FILE,
    name,
    mimeType,
    storageKey: `${id}.msa`,
    sha256,
    byteSize: 4096n,
    encrypted: true,
    dataClass,
    trustLevel: MsaidiziTrustLevel.TRUSTED,
    trustedPurpose: purpose as MsaidiziTrustedArtifactPurpose,
    provenance: { source: 'signed-update-verifier', claimsDigest: parsed.claimsDigest },
    createdAt: new Date(),
    trustedEvidence: {
      id: `${id}-evidence`,
      artifactId: id,
      taskId,
      planVersionId,
      stepId,
      candidateId: boundCandidateId,
      purpose: purpose as MsaidiziTrustedArtifactPurpose,
      signerKeyId: parsed.claims.signerKeyId,
      claimsDigest: parsed.claimsDigest,
      nonce: parsed.claims.nonce,
      canonicalClaims: JSON.parse(parsed.claimsJson),
      signature: parsed.signature,
      evaluationRunId: parsed.claims.evaluationRunId,
      cleanSnapshotId: parsed.claims.cleanSnapshotId,
      toolchainVersions: parsed.claims.toolchainVersions,
      issuedAt: new Date(parsed.claims.issuedAt),
      expiresAt: new Date(parsed.claims.expiresAt),
      receivedAt: new Date(),
    },
  };
}

function signedBundle(
  overrides: {
    runner?: Record<string, unknown>;
    firstReview?: Record<string, unknown>;
    secondReview?: Record<string, unknown>;
  } = {},
) {
  const runner = signedEnvelope(runnerClaims(overrides.runner), 'R');
  const runnerDigest = parseEvaluationRunnerAttestation(runner).claimsDigest;
  return {
    runner,
    reviews: [
      signedEnvelope(
        reviewClaims({ runnerClaimsDigest: runnerDigest, ...overrides.firstReview }),
        'A',
      ),
      signedEnvelope(
        reviewClaims({
          signerKeyId: 'review-key-b',
          runnerClaimsDigest: runnerDigest,
          reviewerId: 'reviewer-b',
          modelId: 'model-b-v1',
          nonce: '15151515-1515-4515-8515-151515151515',
          ...overrides.secondReview,
        }),
        'B',
      ),
    ],
  };
}

function binding() {
  return {
    candidateId,
    taskId,
    planVersionId,
    stepId,
    sourceArtifactId,
    sourceArtifactSha256: sourceSha256,
    rollbackArtifactId,
    rollbackArtifactSha256: rollbackSha256,
    rollbackVersion,
    reportArtifactId,
    reportArtifactSha256: reportSha256,
    evaluationRunId: 'evaluation-run-001',
    cleanSnapshotId: 'windows-clean-snapshot-001',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
  };
}

function runnerClaims(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: 'UPDATE_EVALUATION_RUNNER',
    signerKeyId: 'runner-key',
    ...binding(),
    checks: {
      isolatedWindowsVm: true,
      tests: true,
      staticAnalysis: true,
      adversarialEvaluation: true,
      supervisorIntegrity: true,
      protectedBoundaryDiff: true,
    },
    verdict: 'PASS',
    failureCodes: [],
    issuedAt: '2026-08-25T10:00:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    nonce: '14141414-1414-4414-8414-141414141414',
    ...overrides,
  };
}

function reviewClaims(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: 'UPDATE_MODEL_REVIEW',
    signerKeyId: 'review-key-a',
    ...binding(),
    runnerClaimsDigest: 'f'.repeat(64),
    reviewerId: 'reviewer-a',
    modelId: 'model-a-v1',
    verdict: 'APPROVE',
    rationale: 'All signed checks and the protected-boundary diff pass.',
    issuedAt: '2026-08-25T10:01:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    nonce: '16161616-1616-4616-8616-161616161616',
    ...overrides,
  };
}

function generatedEvaluationBinding() {
  return {
    requestDigest: '1'.repeat(64),
    generationArtifactId: '18181818-1818-4818-8818-181818181818',
    generationArtifactSha256: '2'.repeat(64),
    generationManifestSha256: '2'.repeat(64),
    protectedPolicyVersion: 'msaidizi-generated-update-policy/v1',
    protectedPolicySha256: '3'.repeat(64),
    baseRevisionSha256: '4'.repeat(64),
  };
}

function generatedRunnerClaims(overrides: Record<string, unknown> = {}) {
  return {
    ...runnerClaims(),
    schemaVersion: 2,
    ...generatedEvaluationBinding(),
    ...generatedTerminalAccounting(),
    checks: {
      ...runnerClaims().checks,
      baseRevisionMatch: true,
      ntfsReparseHardLinkAndToctouIsolation: true,
    },
    ...overrides,
  };
}

function generatedReviewClaims(overrides: Record<string, unknown> = {}) {
  return {
    ...reviewClaims(),
    schemaVersion: 2,
    ...generatedEvaluationBinding(),
    ...generatedTerminalAccounting(),
    ...overrides,
  };
}

function generatedTerminalAccounting() {
  return {
    evaluationLeaseGeneration: 1,
    finalUsage: {
      cpuTimeSeconds: 10,
      bytesRead: '100',
      bytesWritten: '100',
      externalEgressBytes: '0',
      modelTurns: 2,
      modelInputTokens: '100',
      modelOutputTokens: '50',
      modelCostMicrousd: '10000',
    },
  };
}

function generatedProposalStep() {
  const source = Buffer.from('export const generated = true;\n', 'utf8');
  return {
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
    arguments: {
      name: 'Generated evidence boundary test',
      version: '2.0.0',
      scope: 'APPLICATION',
      rollbackVersion: '1.9.0',
      rationale: 'Require exact signed isolated evaluation evidence.',
      baseRevisionSha256: '4'.repeat(64),
      changes: [
        {
          relativePath: 'backend/src/modules/orders/generated-evidence.ts',
          operation: 'ADD',
          expectedPreSha256: null,
          contentBase64: source.toString('base64'),
          contentSha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
      evaluationBudget: {
        maxWallTimeSeconds: 600,
        maxCpuTimeSeconds: 1_200,
        maxBytesRead: '1048576',
        maxBytesWritten: '1048576',
        maxExternalEgressBytes: '0',
        maxModelTurns: 2,
        maxModelInputTokens: '1000',
        maxModelOutputTokens: '1000',
        maxModelCostMicrousd: '100000',
      },
    },
    expectedEffect: 'WRITE',
    dataClass: proposalDataClass('APPLICATION'),
    idempotent: true,
    mutation: true,
  };
}

function artifactClaims(overrides: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    type: 'TRUSTED_UPDATE_ARTIFACT',
    signerKeyId: 'artifact-verifier-key',
    taskId,
    planVersionId,
    stepId,
    byteSize: '4096',
    dataClass,
    evaluationRunId: 'evaluation-run-001',
    cleanSnapshotId: 'windows-clean-snapshot-001',
    toolchainVersions: { dotnet: '8.0.8', node: '22.14.0' },
    provenance: {
      producer: 'ISOLATED_WINDOWS_VERIFIER',
      source: 'CLEAN_SNAPSHOT_BUILD',
    },
    issuedAt: '2026-08-25T10:00:00.000Z',
    expiresAt: '2026-08-25T10:10:00.000Z',
    ...overrides,
  };
}

function signedEnvelope(claims: unknown, signatureSeed: string) {
  return {
    claimsJson: canonicalAttestationJson(claims),
    signature: Buffer.alloc(64, signatureSeed, 'ascii').toString('base64url'),
  };
}
