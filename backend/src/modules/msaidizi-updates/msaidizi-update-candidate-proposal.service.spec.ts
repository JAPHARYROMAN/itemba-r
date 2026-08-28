import {
  MsaidiziArtifactKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  MsaidiziTrustedArtifactPurpose,
  MsaidiziTrustLevel,
  MsaidiziUpdateCandidateStatus,
} from '@prisma/client';
import { MsaidiziUpdateCandidateProposalService } from './msaidizi-update-candidate-proposal.service';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
  updateCandidateProposalDigest,
  updateCandidateProposalIdempotencyKey,
} from './update-candidate-proposal.port';

describe('MsaidiziUpdateCandidateProposalService', () => {
  it('refuses a queued proposal before opening a transaction when the global kill switch is active', async () => {
    const harness = proposalHarness();
    const service = new MsaidiziUpdateCandidateProposalService(
      harness.prisma as never,
      { enabled: true, globalKillSwitchActive: true } as never,
      auditHarness() as never,
      {} as never,
    );

    await expect(service.propose(request)).rejects.toMatchObject({ code: 'GLOBAL_KILL_SWITCH' });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });

  it('creates only an attributed DRAFT and appends sanitized task/audit evidence', async () => {
    const harness = proposalHarness();
    const service = proposalService(harness.prisma);

    const result = await service.propose(request);

    expect(result).toEqual(
      expect.objectContaining({ candidateId, status: 'DRAFT', scope: 'ADAPTERS', replay: false }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        principalId,
        proposedByTaskId: taskId,
        proposedByPlanVersionId: planVersionId,
        proposedByStepId: stepId,
        proposalRationale: args.rationale,
        sourceArtifactSha256: sourceSha256,
        rollbackArtifactSha256: rollbackSha256,
        rollbackVersion,
        status: MsaidiziUpdateCandidateStatus.DRAFT,
        evaluationSummary: {},
        reviewerDecisions: [],
      }),
    });
    expect(harness.tx.msaidiziTaskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'update_candidate.proposed', taskId }),
      }),
    );
    expect(harness.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'MSAIDIZI_UPDATE_CANDIDATE_PROPOSED',
          taskId,
          stepId,
        }),
      }),
    );
    expect('update' in harness.tx.msaidiziUpdateCandidate).toBe(false);
    expect('msaidiziUpdateDeployment' in harness.tx).toBe(false);
  });

  it('fails closed when either artifact belongs to another task', async () => {
    const harness = proposalHarness({
      artifacts: [sourceArtifact(), rollbackArtifact({ taskId: otherTaskId })],
    });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).rejects.toMatchObject({
      code: 'UPDATE_PROPOSAL_CROSS_TASK_ARTIFACT',
    });
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });

  it('refuses protected supervisor scope hidden in candidate metadata', async () => {
    const harness = proposalHarness({
      step: reviewedStep({ arguments: { ...args, name: 'Audit signer replacement' } }),
    });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).rejects.toMatchObject({
      code: 'UPDATE_PROPOSAL_PROTECTED_SCOPE',
    });
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });

  it('refuses rather than redacts a credential in the durable rationale', async () => {
    const harness = proposalHarness({
      step: reviewedStep({
        arguments: { ...args, rationale: 'Use api_key=sk-proj-abcdefghijklmnop1234 while testing' },
      }),
    });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).rejects.toMatchObject({
      code: 'UPDATE_PROPOSAL_SECRET_REFUSED',
    });
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });

  it('returns the exact same DRAFT on replay without creating a second proposal or event', async () => {
    const proposalDigest = updateCandidateProposalDigest(taskId, planVersionId, stepId, {
      proposalKind: 'ARTIFACT_BACKED',
      ...args,
    });
    const existing = {
      id: candidateId,
      principalId,
      proposedByTaskId: taskId,
      proposedByPlanVersionId: planVersionId,
      proposedByStepId: stepId,
      proposalIdempotencyKey: updateCandidateProposalIdempotencyKey(taskId, planVersionId, stepId),
      proposalDigest,
      proposalRationale: args.rationale,
      sourceArtifactId,
      sourceArtifactSha256: sourceSha256,
      rollbackArtifactId,
      rollbackArtifactSha256: rollbackSha256,
      rollbackVersion,
      name: args.name,
      version: args.version,
      scope: args.scope,
      status: MsaidiziUpdateCandidateStatus.DRAFT,
    };
    const harness = proposalHarness({ existing });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).resolves.toEqual(
      expect.objectContaining({ candidateId, replay: true, status: 'DRAFT', proposalDigest }),
    );
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziTaskEvent.create).not.toHaveBeenCalled();
    expect(harness.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses an inactive mandate before inspecting or creating artifacts', async () => {
    const harness = proposalHarness({ task: reviewedTask({ mandateStatus: 'SUSPENDED' }) });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).rejects.toMatchObject({
      code: 'UPDATE_PROPOSAL_MANDATE_INACTIVE',
    });
    expect(harness.tx.msaidiziArtifact.findMany).not.toHaveBeenCalled();
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });

  it('refuses a step copied into an autonomously-created, unreviewed plan version', async () => {
    const harness = proposalHarness({
      step: reviewedStep({
        planVersion: { id: planVersionId, taskId, version: 1, createdByUserId: null },
      }),
    });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).rejects.toMatchObject({
      code: 'UPDATE_PROPOSAL_PLAN_NOT_REVIEWED',
    });
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });

  it('requires an exact mandate data class and rejects wildcard authority', async () => {
    const harness = proposalHarness({
      task: reviewedTask({ mandateDataClasses: ['*'] }),
    });
    const service = proposalService(harness.prisma);

    await expect(service.propose(request)).rejects.toMatchObject({
      code: 'UPDATE_PROPOSAL_MANDATE_SCOPE_DENIED',
    });
    expect(harness.tx.msaidiziUpdateCandidate.create).not.toHaveBeenCalled();
  });
});

const taskId = '11111111-1111-4111-8111-111111111111';
const otherTaskId = '99999999-9999-4999-8999-999999999999';
const planVersionId = '22222222-2222-4222-8222-222222222222';
const stepId = '33333333-3333-4333-8333-333333333333';
const sourceArtifactId = '44444444-4444-4444-8444-444444444444';
const rollbackArtifactId = '55555555-5555-4555-8555-555555555555';
const candidateId = '66666666-6666-4666-8666-666666666666';
const principalId = '77777777-7777-4777-8777-777777777777';
const userId = '88888888-8888-4888-8888-888888888888';
const mandateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attemptId = `attempt-${stepId}-1`;
const sourceSha256 = 'a'.repeat(64);
const rollbackSha256 = 'b'.repeat(64);
const rollbackVersion = '0.9.0';
const args = {
  name: 'Itemba adapter candidate',
  version: '1.0.0',
  scope: 'ADAPTERS' as const,
  sourceArtifactId,
  sourceArtifactSha256: sourceSha256,
  rollbackArtifactId,
  rollbackArtifactSha256: rollbackSha256,
  rollbackVersion,
  rationale: 'Reduce bounded adapter latency with a recoverable implementation.',
};
const request = { taskId, planVersionId, stepId, attemptId };

function proposalService(prisma: unknown) {
  return new MsaidiziUpdateCandidateProposalService(
    prisma as never,
    { enabled: true, globalKillSwitchActive: false } as never,
    auditHarness() as never,
    {} as never,
  );
}

function auditHarness() {
  return {
    logStrictInTransaction: jest.fn(
      (tx: { auditLog: { create: (input: unknown) => unknown } }, input) =>
        tx.auditLog.create({ data: input }),
    ),
  };
}

function proposalHarness(
  overrides: {
    task?: ReturnType<typeof reviewedTask>;
    step?: ReturnType<typeof reviewedStep>;
    artifacts?: Array<ReturnType<typeof sourceArtifact>>;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  const task = overrides.task ?? reviewedTask();
  const step = overrides.step ?? reviewedStep();
  const artifacts = overrides.artifacts ?? [sourceArtifact(), rollbackArtifact()];
  const existing = overrides.existing ? { evaluationRun: null, ...overrides.existing } : null;
  const create = jest.fn(async ({ data }) => ({ id: candidateId, ...data }));
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: taskId }])
      .mockResolvedValueOnce([{ now: new Date() }])
      .mockResolvedValueOnce([{ id: mandateId }]),
    msaidiziTask: { findUnique: jest.fn().mockResolvedValue(task) },
    msaidiziMandate: { findUnique: jest.fn().mockResolvedValue(task.mandate) },
    msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(step) },
    msaidiziToolAttempt: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: attemptId, status: MsaidiziToolAttemptStatus.RUNNING }),
    },
    msaidiziArtifact: { findMany: jest.fn().mockResolvedValue(artifacts) },
    msaidiziUpdateCandidate: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create,
    },
    msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (database: typeof tx) => unknown) => callback(tx)),
    msaidiziUpdateCandidate: {
      findUnique: jest.fn().mockResolvedValue(existing),
    },
  };
  return { prisma, tx };
}

function reviewedTask(overrides: { mandateStatus?: string; mandateDataClasses?: string[] } = {}) {
  return {
    id: taskId,
    principalId,
    initiatedByUserId: userId,
    companyId: 'company-1',
    mandateId,
    mode: MsaidiziTaskMode.AUTOPILOT,
    status: MsaidiziTaskStatus.RUNNING,
    activePlanVersion: 1,
    principal: { status: MsaidiziPrincipalStatus.ACTIVE },
    mandate: {
      id: mandateId,
      principalId,
      status: overrides.mandateStatus ?? 'ACTIVE',
      startsAt: new Date(0),
      expiresAt: new Date(Date.now() + 60_000),
      capabilities: [
        {
          capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
          version: '1',
          effects: ['WRITE'],
          dataClasses: overrides.mandateDataClasses ?? [proposalDataClass(args.scope)],
        },
      ],
    },
  };
}

function reviewedStep(overrides: Record<string, unknown> = {}) {
  return {
    id: stepId,
    taskId,
    planVersionId,
    target: 'SELF_IMPROVEMENT',
    capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
    capabilityVersion: '1',
    arguments: args,
    expectedEffect: 'WRITE',
    dataClass: proposalDataClass(args.scope),
    idempotent: true,
    mutation: true,
    status: MsaidiziTaskStepStatus.RUNNING,
    planVersion: { id: planVersionId, taskId, version: 1, createdByUserId: userId },
    ...overrides,
  };
}

function sourceArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: sourceArtifactId,
    taskId,
    stepId,
    kind: MsaidiziArtifactKind.FILE,
    mimeType: 'application/octet-stream',
    sha256: sourceSha256,
    byteSize: 1024n,
    encrypted: true,
    dataClass: proposalDataClass(args.scope),
    trustLevel: MsaidiziTrustLevel.TRUSTED,
    trustedPurpose: MsaidiziTrustedArtifactPurpose.SOURCE,
    trustedEvidence: {
      taskId,
      planVersionId,
      stepId,
      candidateId: null,
      purpose: MsaidiziTrustedArtifactPurpose.SOURCE,
      claimsDigest: 'c'.repeat(64),
      signature: 'A'.repeat(86),
    },
    provenance: { source: 'trusted-isolated-build', contentSha256: sourceSha256 },
    ...overrides,
  };
}

function rollbackArtifact(overrides: Record<string, unknown> = {}) {
  return sourceArtifact({
    id: rollbackArtifactId,
    sha256: rollbackSha256,
    trustedPurpose: MsaidiziTrustedArtifactPurpose.ROLLBACK,
    trustedEvidence: {
      taskId,
      planVersionId,
      stepId,
      candidateId: null,
      purpose: MsaidiziTrustedArtifactPurpose.ROLLBACK,
      claimsDigest: 'd'.repeat(64),
      signature: 'B'.repeat(86),
    },
    provenance: { source: 'trusted-recovery-vault', contentSha256: rollbackSha256 },
    ...overrides,
  });
}
