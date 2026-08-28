import {
  MsaidiziDeviceStatus,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateDeploymentOperation,
  MsaidiziUpdateDeploymentStatus,
  MsaidiziUpdateEvaluationAttestationKind,
  MsaidiziUpdateEvaluationVerdict,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { MsaidiziUpdatesService } from './msaidizi-updates.service';
import {
  attestationBundleDigest,
  canonicalAttestationJson,
} from './msaidizi-evaluator-attestation.protocol';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from './update-candidate-proposal.port';

const CLOCK = new Date('2026-08-27T12:00:00.000Z');
const DWELL = { 0: 86_400, 5: 86_400, 25: 172_800, 100: 259_200 } as const;

describe('Msaidizi automatic update rollout', () => {
  beforeEach(() => jest.useFakeTimers({ now: CLOCK }));
  afterEach(() => jest.useRealTimers());

  it('defaults closed and queues nothing without immutable deployment opt-in', async () => {
    const harness = rolloutHarness({
      candidate: automaticCandidate({ approved: true }),
      automaticEnabled: false,
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual({
      scanned: 0,
      queued: 0,
      skippedEmpty: 0,
      pending: 0,
      disabled: true,
    });
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });

  it('derives ring-0 progression from the active mandate without a candidate toggle', async () => {
    const candidate = automaticCandidate({ approved: true });
    const harness = rolloutHarness({ candidate });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ scanned: 1, queued: 1, pending: 0, disabled: false }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          candidateId: candidate.id,
          ring: 0,
          automaticProgression: true,
        }),
      }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          automaticProgressionEnabled: true,
          automaticProgressionArmedById: candidate.proposedByTask.initiatedByUserId,
          automaticProgressionRing0DwellSeconds: DWELL[0],
          automaticProgressionRing100DwellSeconds: DWELL[100],
        }),
      }),
    );
  });

  it('does not self-authorize without the exact active persisted mandate', async () => {
    const candidate = automaticCandidate({ approved: true, mandateId: null });
    const harness = rolloutHarness({ candidate, mandateStatus: null });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ queued: 0, pending: 1 }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziUpdateCandidate.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'expired',
      options: { mandateExpiresAt: new Date(CLOCK.getTime() - 1) },
    },
    {
      label: 'forged wildcard grant',
      options: {
        mandateCapabilities: [
          {
            capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
            version: '1',
            effects: ['WRITE'],
            dataClasses: ['*'],
          },
        ],
      },
    },
  ])('rejects an invalid persisted mandate ($label) at the queue boundary', async ({ options }) => {
    const harness = rolloutHarness({
      candidate: automaticCandidate({ approved: true }),
      ...options,
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ queued: 0, pending: 1 }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });

  it('blocks progression under either central kill state', async () => {
    const harness = rolloutHarness({
      candidate: automaticCandidate({ approved: true }),
      killSwitch: true,
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ disabled: true, scanned: 0, queued: 0 }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });

  it('refuses an approved projection with incomplete isolated evaluation evidence', async () => {
    const harness = rolloutHarness({
      candidate: automaticCandidate({ approved: true }),
      evidence: null,
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ queued: 0, pending: 1 }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziUpdateCandidate.update).not.toHaveBeenCalled();
  });

  it('refuses tampered signed-evidence projections before any rollout mutation', async () => {
    const candidate = automaticCandidate({ approved: true });
    const evidence = automaticEvaluationEvidence(candidate).rows;
    evidence[0].canonicalClaims.reportArtifactSha256 = 'f'.repeat(64);
    const harness = rolloutHarness({ candidate, evidence });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ queued: 0, pending: 1 }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziUpdateCandidate.update).not.toHaveBeenCalled();
  });

  it('cannot progress beyond the immutable external ring ceiling', async () => {
    const harness = rolloutHarness({
      candidate: automaticCandidate({ rolloutRing: 5 }),
      maximumRing: 5,
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ queued: 0, pending: 1 }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });

  it('does not advance unless every current-ring APPLY is terminal SUCCEEDED', async () => {
    const harness = rolloutHarness({
      current: [
        { status: MsaidiziUpdateDeploymentStatus.SUCCEEDED },
        { status: MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION },
      ],
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual({
      scanned: 1,
      queued: 0,
      skippedEmpty: 0,
      pending: 1,
      disabled: false,
    });
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziUpdateCandidate.update).not.toHaveBeenCalled();
  });

  it.each([
    [0, 86_400],
    [5, 86_400],
    [25, 172_800],
  ] as const)(
    'holds ring %i until the exact protected %i-second inter-ring dwell boundary',
    async (ring, dwellSeconds) => {
      const healthyAt = new Date(CLOCK.getTime() - dwellSeconds * 1_000 + 1);
      const candidate = automaticCandidate({ rolloutRing: ring, healthyAt });
      const harness = rolloutHarness({ candidate });

      await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
        expect.objectContaining({ pending: 1, queued: 0, skippedEmpty: 0 }),
      );
      expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();

      jest.setSystemTime(new Date(CLOCK.getTime() + 1));
      await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
        expect.objectContaining({ pending: 0 }),
      );
      expect(
        harness.tx.msaidiziUpdateDeployment.upsert.mock.calls.length +
          harness.tx.msaidiziUpdateCandidate.update.mock.calls.length,
      ).toBeGreaterThan(0);
    },
  );

  it('uses the captured cohort and ignores a workstation enrolled after arming', async () => {
    const cohort = [deviceId(1), deviceId(2)];
    const candidate = automaticCandidate({ rolloutRing: 25, cohort });
    const harness = rolloutHarness({
      candidate,
      eligible: [...cohort, deviceId(3)],
      priorSucceeded: [{ deviceId: cohort[0] }],
    });

    const result = await harness.service.advanceAutomaticRollouts();

    expect(result).toEqual(expect.objectContaining({ queued: 1, pending: 0 }));
    expect(harness.tx.msaidiziUpdateDeployment.upsert).toHaveBeenCalledTimes(1);
    expect(harness.tx.msaidiziUpdateDeployment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deviceId: cohort[1],
          ring: 100,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
          automaticProgression: true,
        }),
      }),
    );
    expect(
      harness.tx.msaidiziUpdateDeployment.upsert.mock.calls.some(
        ([{ create }]) => create.deviceId === deviceId(3),
      ),
    ).toBe(false);
  });

  it('requires the complete captured cohort and 72-hour ring-100 stabilization before ACTIVE', async () => {
    const cohort = [deviceId(1), deviceId(2)];
    const healthyAt = new Date(CLOCK.getTime() - DWELL[100] * 1_000 + 1);
    const candidate = automaticCandidate({ rolloutRing: 100, cohort, healthyAt });
    const harness = rolloutHarness({
      candidate,
      priorSucceeded: cohort.map((id) => ({ deviceId: id })),
    });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ pending: 1 }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.update).not.toHaveBeenCalled();

    jest.setSystemTime(new Date(CLOCK.getTime() + 1));
    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ skippedEmpty: 1, pending: 0 }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.ACTIVE,
          deployedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('rechecks principal authority under lock at the queue boundary', async () => {
    const harness = rolloutHarness({ principalStatus: MsaidiziPrincipalStatus.DISABLED });

    await expect(harness.service.advanceAutomaticRollouts()).resolves.toEqual(
      expect.objectContaining({ pending: 1, queued: 0 }),
    );
    expect(harness.tx.msaidiziPrincipal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'principal-1' } }),
    );
    expect(harness.tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });
});

function rolloutHarness(
  options: {
    candidate?: ReturnType<typeof automaticCandidate>;
    current?: Array<{ status: MsaidiziUpdateDeploymentStatus }>;
    next?: Array<{ deviceId: string; status: MsaidiziUpdateDeploymentStatus }>;
    eligible?: string[];
    priorSucceeded?: Array<{ deviceId: string }>;
    principalStatus?: MsaidiziPrincipalStatus;
    mandateStatus?: MsaidiziMandateStatus | null;
    mandateStartsAt?: Date | null;
    mandateExpiresAt?: Date | null;
    mandateCapabilities?: unknown[];
    evidence?: ReturnType<typeof automaticEvaluationEvidence>['rows'] | null;
    maximumRing?: -1 | 0 | 5 | 25 | 100;
    automaticEnabled?: boolean;
    killSwitch?: boolean;
  } = {},
) {
  const candidate = options.candidate ?? automaticCandidate();
  const current = options.current ?? [{ status: MsaidiziUpdateDeploymentStatus.SUCCEEDED }];
  const next = options.next ?? [];
  const eligibleIds = options.eligible ?? candidate.testCohort;
  const priorSucceeded = options.priorSucceeded ?? [{ deviceId: eligibleIds[0] }];
  const upsert = jest.fn(async ({ create }) => ({
    ...create,
    status: MsaidiziUpdateDeploymentStatus.QUEUED,
  }));
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
    msaidiziUpdateCandidate: {
      findUnique: jest.fn().mockResolvedValue(candidate),
      update: jest.fn().mockResolvedValue({}),
    },
    msaidiziUpdateDeployment: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        if (where.ring === candidate.rolloutRing) return current;
        if (where.ring !== undefined) return next;
        return priorSucceeded;
      }),
      count: jest.fn().mockResolvedValue(0),
      upsert,
    },
    msaidiziDevice: {
      findMany: jest.fn(({ where }: { where: { id?: { in?: string[] } } }) => {
        const requested = where.id?.in;
        return eligibleIds
          .filter((id) => !requested || requested.includes(id))
          .map((id) => ({ id, status: MsaidiziDeviceStatus.ACTIVE }));
      }),
    },
    msaidiziPrincipal: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: options.principalStatus ?? MsaidiziPrincipalStatus.ACTIVE }),
    },
    msaidiziTask: {
      findUnique: jest.fn().mockResolvedValue({
        id: candidate.proposedByTaskId,
        principalId: candidate.principalId,
        initiatedByUserId: candidate.proposedByTask.initiatedByUserId,
        companyId: candidate.proposedByTask.companyId,
        mandateId: candidate.proposedByTask.mandateId,
        mode: MsaidiziTaskMode.AUTOPILOT,
        status: MsaidiziTaskStatus.COMPLETED,
        activePlanVersion: 1,
      }),
    },
    msaidiziMandate: {
      findUnique: jest.fn().mockResolvedValue(
        options.mandateStatus === null
          ? null
          : {
              id: candidate.proposedByTask.mandateId,
              principalId: candidate.principalId,
              status: options.mandateStatus ?? MsaidiziMandateStatus.ACTIVE,
              capabilities: options.mandateCapabilities ?? [
                {
                  capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
                  version: '1',
                  effects: ['WRITE'],
                  dataClasses: [proposalDataClass('APPLICATION')],
                },
              ],
              startsAt: options.mandateStartsAt ?? null,
              expiresAt: options.mandateExpiresAt ?? null,
            },
      ),
    },
    msaidiziTaskStep: {
      findUnique: jest.fn().mockResolvedValue(candidate.proposalStep),
    },
    msaidiziUpdateEvaluationAttestation: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          options.evidence === null
            ? []
            : (options.evidence ?? automaticEvaluationEvidence(candidate).rows),
        ),
    },
    msaidiziUpdateEvaluationRun: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const signer = {
    automaticRolloutEnabled: options.automaticEnabled ?? true,
    automaticRolloutMaximumRing: options.maximumRing ?? 100,
    automaticRolloutSweepSeconds: 15,
    healthTimeoutSeconds: 600,
    minimumHealthySoakSeconds: 300,
    minimumRingDwellSeconds: jest.fn((ring: keyof typeof DWELL) => DWELL[ring]),
    redeliverySeconds: 30,
    assertReady: jest.fn(),
    issue: jest.fn((claims: Record<string, unknown>) => {
      const manifestJson = JSON.stringify({
        ...claims,
        issuedAt: CLOCK.toISOString(),
        expiresAt: new Date(CLOCK.getTime() + 600_000).toISOString(),
      });
      return {
        manifestJson,
        manifestSha256: createHash('sha256').update(manifestJson).digest('hex'),
        signature: 'signature',
        signingKeyId: 'bootstrap-1',
      };
    }),
  };
  const audit = { logStrictInTransaction: jest.fn(), log: jest.fn() };
  const prisma = {
    msaidiziUpdateCandidate: { findMany: jest.fn().mockResolvedValue([{ id: candidate.id }]) },
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const autonomy = {
    enabled: true,
    autopilotEnabled: true,
    globalKillSwitchActive: options.killSwitch ?? false,
  } as const;
  return {
    tx,
    signer,
    service: new MsaidiziUpdatesService(
      prisma as never,
      audit as never,
      signer as never,
      autonomy as never,
    ),
  };
}

function automaticCandidate(
  options: {
    rolloutRing?: 0 | 5 | 25 | 100;
    cohort?: string[];
    healthyAt?: Date;
    approved?: boolean;
    mandateId?: string | null;
  } = {},
) {
  const rolloutRing = options.rolloutRing ?? 0;
  const cohort = [
    ...(options.cohort ?? Array.from({ length: 20 }, (_, index) => deviceId(index + 1))),
  ].sort();
  const healthyAt = options.healthyAt ?? new Date(CLOCK.getTime() - DWELL[rolloutRing] * 1_000);
  const cohortSha256 = deviceSetDigest(cohort);
  const approved = options.approved ?? false;
  const taskId = '11111111-1111-4111-8111-111111111111';
  const planVersionId = '22222222-2222-4222-8222-222222222222';
  const stepId = '33333333-3333-4333-8333-333333333333';
  const sourceArtifactId = '44444444-4444-4444-8444-444444444444';
  const rollbackArtifactId = '55555555-5555-4555-8555-555555555555';
  const reportArtifactId = '66666666-6666-4666-8666-666666666666';
  const candidateId = '77777777-7777-4777-8777-777777777777';
  const candidate = {
    id: candidateId,
    principalId: 'principal-1',
    proposedByTaskId: taskId,
    proposedByPlanVersionId: planVersionId,
    proposedByStepId: stepId,
    proposalIdempotencyKey: 'proposal-1',
    proposalDigest: '9'.repeat(64),
    proposalRationale: 'Measured update candidate',
    generatedSourceArtifactId: null,
    generationManifestSha256: null,
    sourceArtifactId,
    sourceArtifactSha256: 'a'.repeat(64),
    rollbackArtifactId,
    rollbackArtifactSha256: 'b'.repeat(64),
    evaluationReportArtifactId: reportArtifactId,
    evaluationReportArtifactSha256: 'c'.repeat(64),
    evaluationBundleDigest: '',
    evaluationDecidedAt: new Date('2026-08-20T00:00:00.000Z'),
    name: 'candidate',
    version: '1.0.0',
    rollbackVersion: '0.9.0',
    scope: 'APPLICATION',
    status: approved
      ? MsaidiziUpdateCandidateStatus.APPROVED
      : MsaidiziUpdateCandidateStatus.CANARY,
    evaluationSummary: {} as Record<string, unknown>,
    reviewerDecisions: [],
    rolloutRing,
    automaticProgressionEnabled: !approved,
    automaticProgressionArmedAt: approved ? null : new Date('2026-08-20T00:00:00.000Z'),
    automaticProgressionArmedById: approved ? null : 'user-1',
    automaticProgressionMinimumSoakSeconds: approved ? null : 300,
    automaticProgressionHealthTimeoutSeconds: approved ? null : 600,
    automaticProgressionRing0DwellSeconds: approved ? null : DWELL[0],
    automaticProgressionRing5DwellSeconds: approved ? null : DWELL[5],
    automaticProgressionRing25DwellSeconds: approved ? null : DWELL[25],
    automaticProgressionRing100DwellSeconds: approved ? null : DWELL[100],
    automaticProgressionCohortDeviceIds: approved ? null : cohort,
    automaticProgressionCohortSha256: approved ? null : cohortSha256,
    automaticProgressionCohortCapturedAt: approved ? null : new Date('2026-08-20T00:00:00.000Z'),
    automaticProgressionRingHealthyAt: approved ? null : healthyAt,
    automaticProgressionRingEvidenceSha256: approved
      ? null
      : ringEvidenceDigest(candidateId, rolloutRing, healthyAt, cohortSha256, DWELL[rolloutRing]),
    healthSummary: null,
    proposedByTask: {
      id: taskId,
      initiatedByUserId: 'user-1',
      companyId: 'company-1',
      mandateId: options.mandateId === undefined ? 'mandate-1' : options.mandateId,
    },
    sourceArtifact: {
      id: sourceArtifactId,
      taskId,
      sha256: 'a'.repeat(64),
      encrypted: true,
    },
    rollbackArtifact: {
      id: rollbackArtifactId,
      taskId,
      sha256: 'b'.repeat(64),
      encrypted: true,
    },
    proposalStep: {
      id: stepId,
      taskId,
      planVersionId,
      target: 'SELF_IMPROVEMENT',
      capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
      capabilityVersion: '1',
      arguments: {
        name: 'candidate',
        rationale: 'Measured update candidate',
        rollbackArtifactId,
        rollbackArtifactSha256: 'b'.repeat(64),
        rollbackVersion: '0.9.0',
        scope: 'APPLICATION',
        sourceArtifactId,
        sourceArtifactSha256: 'a'.repeat(64),
        version: '1.0.0',
      },
      expectedEffect: 'WRITE',
      dataClass: proposalDataClass('APPLICATION'),
      idempotent: true,
      mutation: true,
    },
    testCohort: cohort,
  };
  const evaluation = automaticEvaluationEvidence(candidate);
  candidate.evaluationBundleDigest = evaluation.bundleDigest;
  candidate.evaluationSummary = {
    protocol: 'MSAIDIZI-EVALUATION-BUNDLE-V1',
    bundleDigest: evaluation.bundleDigest,
    decision: MsaidiziUpdateCandidateStatus.APPROVED,
    runnerClaimsDigest: evaluation.runnerClaimsDigest,
  };
  return candidate;
}

function automaticEvaluationEvidence(candidate: {
  id: string;
  proposedByTaskId: string;
  proposedByPlanVersionId: string;
  proposedByStepId: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  rollbackArtifactId: string;
  rollbackArtifactSha256: string;
  evaluationReportArtifactId: string;
  evaluationReportArtifactSha256: string;
}) {
  const binding = {
    candidateId: candidate.id,
    taskId: candidate.proposedByTaskId,
    planVersionId: candidate.proposedByPlanVersionId,
    stepId: candidate.proposedByStepId,
    rollbackVersion: '0.9.0',
    evaluationRunId: 'evaluation-run-1',
    cleanSnapshotId: 'snapshot-1',
    toolchainVersions: { dotnet: '8.0.0', windows: '11.0' },
    sourceArtifactId: candidate.sourceArtifactId,
    sourceArtifactSha256: candidate.sourceArtifactSha256,
    rollbackArtifactId: candidate.rollbackArtifactId,
    rollbackArtifactSha256: candidate.rollbackArtifactSha256,
    reportArtifactId: candidate.evaluationReportArtifactId,
    reportArtifactSha256: candidate.evaluationReportArtifactSha256,
  };
  const runnerClaims = {
    schemaVersion: 1,
    type: 'UPDATE_EVALUATION_RUNNER',
    signerKeyId: 'runner-key',
    checks: {
      isolatedWindowsVm: true,
      tests: true,
      staticAnalysis: true,
      adversarialEvaluation: true,
      supervisorIntegrity: true,
      protectedBoundaryDiff: true,
    },
    verdict: MsaidiziUpdateEvaluationVerdict.PASS,
    failureCodes: [],
    issuedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: '2026-08-20T01:00:00.000Z',
    nonce: '88888888-8888-4888-8888-888888888888',
    ...binding,
  };
  const runnerClaimsDigest = canonicalDigest(runnerClaims);
  const runner = {
    ...binding,
    kind: MsaidiziUpdateEvaluationAttestationKind.RUNNER,
    signerKeyId: 'runner-key',
    claimsDigest: runnerClaimsDigest,
    canonicalClaims: runnerClaims,
    signature: canonicalSignature(1),
    verdict: MsaidiziUpdateEvaluationVerdict.PASS,
    runnerClaimsDigest: null,
    reviewerId: null,
    modelId: null,
  };
  const reviews = [
    { signerKeyId: 'review-key-1', reviewerId: 'reviewer-1', modelId: 'model-1' },
    { signerKeyId: 'review-key-2', reviewerId: 'reviewer-2', modelId: 'model-2' },
  ].map((identity, index) => {
    const claims = {
      schemaVersion: 1,
      type: 'UPDATE_MODEL_REVIEW',
      ...identity,
      runnerClaimsDigest,
      verdict: MsaidiziUpdateEvaluationVerdict.APPROVE,
      rationale: 'Independent approval',
      issuedAt: '2026-08-20T00:00:00.000Z',
      expiresAt: '2026-08-20T01:00:00.000Z',
      nonce:
        index === 0
          ? '99999999-9999-4999-8999-999999999999'
          : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ...binding,
    };
    return {
      ...binding,
      kind: MsaidiziUpdateEvaluationAttestationKind.MODEL_REVIEW,
      ...identity,
      claimsDigest: canonicalDigest(claims),
      canonicalClaims: claims,
      signature: canonicalSignature(index + 2),
      verdict: MsaidiziUpdateEvaluationVerdict.APPROVE,
      runnerClaimsDigest,
    };
  });
  return {
    rows: [runner, ...reviews],
    runnerClaimsDigest,
    bundleDigest: attestationBundleDigest(
      runnerClaimsDigest,
      reviews.map(({ claimsDigest }) => claimsDigest),
    ),
  };
}

function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(canonicalAttestationJson(value), 'utf8').digest('hex');
}

function canonicalSignature(fill: number): string {
  return Buffer.alloc(64, fill).toString('base64url');
}

function deviceId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function deviceSetDigest(deviceIds: readonly string[]): string {
  return createHash('sha256')
    .update([...deviceIds].sort().join('\0'), 'utf8')
    .digest('hex');
}

function ringEvidenceDigest(
  candidateId: string,
  ring: number,
  healthyAt: Date,
  cohortSha256: string,
  minimumRingDwellSeconds: number,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: 'MSAIDIZI-AUTOMATIC-RING-DWELL-V1',
        candidateId,
        ring,
        healthyAt: healthyAt.toISOString(),
        cohortSha256,
        minimumRingDwellSeconds,
      }),
      'utf8',
    )
    .digest('hex');
}
