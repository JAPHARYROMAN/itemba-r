import {
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateDeploymentOperation,
  MsaidiziUpdateDeploymentStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziUpdatesService } from './msaidizi-updates.service';

describe('MsaidiziUpdatesService', () => {
  const user = { id: 'user-1' } as AuthUser;

  it('keeps the trusted supervisor outside the update boundary', async () => {
    const prisma = { msaidiziTask: { findFirst: jest.fn() } };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      { log: jest.fn() } as never,
      signer() as never,
    );

    await expect(
      service.create(
        {
          proposedByTaskId: '11111111-1111-4111-8111-111111111111',
          sourceArtifactId: '22222222-2222-4222-8222-222222222222',
          rollbackArtifactId: '33333333-3333-4333-8333-333333333333',
          name: 'Replace the audit signer',
          version: '1.0.0',
          rollbackVersion: '0.9.0',
          scope: 'audit-signer',
        },
        user,
      ),
    ).rejects.toThrow('trusted supervisor boundary');
    expect(prisma.msaidiziTask.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the human evaluation endpoint disabled even for signed-shaped relays', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.DRAFT });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      msaidiziUpdateCandidate: {
        findFirst: jest.fn().mockResolvedValue(candidate),
        updateMany,
      },
    };
    const audit = { log: jest.fn() };
    const service = new MsaidiziUpdatesService(prisma as never, audit as never, signer() as never);

    await expect(
      service.submitEvaluation(
        candidate.id,
        {
          runner: { claimsJson: '{}', signature: 'A'.repeat(86) },
          reviews: [
            { claimsJson: '{}', signature: 'B'.repeat(86) },
            { claimsJson: '{}', signature: 'C'.repeat(86) },
          ],
        },
        user,
      ),
    ).rejects.toThrow('signed, verifier-bound evaluator attestations');
    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('refuses self-reported health outside the trusted supervisor channel', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.CANARY });
    let updateData: Record<string, unknown> = {};
    const audit = { log: jest.fn() };
    const prisma = {
      msaidiziUpdateCandidate: {
        findFirst: jest.fn().mockResolvedValue(candidate),
        updateMany: jest.fn(async ({ data }) => {
          updateData = data;
          return { count: 1 };
        }),
        findUnique: jest.fn(async () => ({ ...candidate, ...updateData })),
      },
    };
    const service = new MsaidiziUpdatesService(prisma as never, audit as never, signer() as never);

    await expect(
      service.reportHealth(
        candidate.id,
        { healthy: false, monitor: 'ring-0', metrics: { crashes: 1 }, reason: 'crash loop' },
        user,
      ),
    ).rejects.toThrow('trusted update supervisor');
    expect(prisma.msaidiziUpdateCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('filters update candidates by the caller current company scope', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new MsaidiziUpdatesService(
      { msaidiziUpdateCandidate: { findMany } } as never,
      { log: jest.fn() } as never,
      signer() as never,
    );

    await service.list(
      {},
      {
        ...user,
        companyId: 'company-1',
        companyAccess: [],
        roleScopes: ['COMPANY'],
      },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          proposedByTask: expect.objectContaining({
            companyId: { in: ['company-1'] },
          }),
        }),
      }),
    );
  });

  it('does not mix manual rollout rows into an armed automatic cohort', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.CANARY,
      rolloutRing: 0,
      automaticProgressionEnabled: true,
    });
    const updateSigner = signer();
    const prisma = {
      msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue(candidate) },
      msaidiziDevice: { findMany: jest.fn() },
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      { log: jest.fn() } as never,
      updateSigner as never,
    );

    await expect(service.rollout(candidate.id, { ring: 5 }, user)).rejects.toThrow(
      'automatic progression is armed',
    );
    expect(updateSigner.assertReady).not.toHaveBeenCalled();
    expect(prisma.msaidiziDevice.findMany).not.toHaveBeenCalled();
  });

  it('rechecks automatic arming under the candidate lock before manual queueing', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.APPROVED,
      automaticProgressionEnabled: false,
    });
    const armed = { ...candidate, automaticProgressionEnabled: true };
    const upsert = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
      msaidiziUpdateCandidate: { findUnique: jest.fn().mockResolvedValue(armed) },
      msaidiziUpdateDeployment: { upsert },
      msaidiziDevice: {
        findMany: jest.fn().mockResolvedValue([{ id: '55555555-5555-4555-8555-555555555555' }]),
      },
    };
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue(candidate) },
        msaidiziDevice: {
          findMany: jest.fn().mockResolvedValue([{ id: '55555555-5555-4555-8555-555555555555' }]),
        },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      { log: jest.fn() } as never,
      signer() as never,
    );

    await expect(service.rollout(candidate.id, { ring: 0 }, user)).rejects.toThrow(
      'automatic progression is armed',
    );
    expect(tx.msaidiziUpdateCandidate.findUnique).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fails closed when a selected device becomes ineligible inside the queue transaction', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.APPROVED });
    const upsert = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
      msaidiziUpdateCandidate: { findUnique: jest.fn().mockResolvedValue(candidate) },
      msaidiziDevice: { findMany: jest.fn().mockResolvedValue([]) },
      msaidiziUpdateDeployment: { upsert },
    };
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue(candidate) },
        msaidiziDevice: {
          findMany: jest.fn().mockResolvedValue([{ id: '55555555-5555-4555-8555-555555555555' }]),
        },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      { log: jest.fn() } as never,
      signer() as never,
    );

    await expect(service.rollout(candidate.id, { ring: 0 }, user)).rejects.toThrow(
      'no longer eligible',
    );
    expect(tx.msaidiziDevice.findMany).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('atomically gates APPLY dispatch while queueing rollback for an in-flight device', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.CANARY,
      rolloutRing: 5,
    });
    const apply = updateDeployment(candidate, {
      status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
      ring: 5,
    });
    const upsert = jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' }));
    const candidateUpdate = jest.fn(async ({ data }) => ({ ...candidate, ...data }));
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        update: candidateUpdate,
      },
      msaidiziUpdateDeployment: {
        findMany: jest.fn().mockResolvedValueOnce([apply]).mockResolvedValueOnce([]),
        upsert,
        count: jest.fn().mockResolvedValue(1),
      },
      msaidiziDevice: { findMany: jest.fn().mockResolvedValue([{ id: apply.deviceId }]) },
    };
    const audit = { log: jest.fn() };
    const updateSigner = signer();
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue(candidate) },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      audit as never,
      updateSigner as never,
    );

    const result = await service.rollback(candidate.id, user);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deviceId: apply.deviceId,
          operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
          ring: 5,
        }),
      }),
    );
    expect(candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: expect.objectContaining({ rollbackInProgress: true }),
        }),
      }),
    );
    expect(result.candidate.status).toBe(MsaidiziUpdateCandidateStatus.FAILED);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MSAIDIZI_UPDATE_ROLLBACK_QUEUED' }),
    );
  });

  it('manual rollback reuses an exact queued command from a lower ring', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.CANARY,
      rolloutRing: 25,
    });
    const apply = updateDeployment(candidate, {
      status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
      ring: 25,
    });
    const existing = updateDeployment(candidate, {
      id: '77777777-7777-4777-8777-777777777777',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
      ring: 5,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        update: jest.fn(async ({ data }) => ({ ...candidate, ...data })),
      },
      msaidiziUpdateDeployment: {
        findMany: jest.fn().mockResolvedValueOnce([apply]).mockResolvedValueOnce([existing]),
        upsert: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      msaidiziDevice: { findMany: jest.fn().mockResolvedValue([{ id: apply.deviceId }]) },
    };
    const updateSigner = signer();
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue(candidate) },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      { log: jest.fn() } as never,
      updateSigner as never,
    );

    const result = await service.rollback(candidate.id, user);

    expect(result.deployments).toEqual([
      expect.objectContaining({ id: existing.id, status: MsaidiziUpdateDeploymentStatus.QUEUED }),
    ]);
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(updateSigner.assertReady).not.toHaveBeenCalled();
    expect(updateSigner.issue).not.toHaveBeenCalled();
    expect(result.candidate.status).toBe(MsaidiziUpdateCandidateStatus.FAILED);
  });

  it('manual rollback accepts an exact proof despite a historical failed duplicate', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.ACTIVE,
      rolloutRing: 100,
    });
    const apply = updateDeployment(candidate, {
      status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
      ring: 100,
    });
    const failed = updateDeployment(candidate, {
      id: '77777777-7777-4777-8777-777777777771',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.FAILED,
      ring: 5,
    });
    const proof = updateDeployment(candidate, {
      id: '77777777-7777-4777-8777-777777777772',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK,
      ring: 25,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        update: jest.fn(async ({ data }) => ({ ...candidate, ...data })),
      },
      msaidiziUpdateDeployment: {
        findMany: jest.fn().mockResolvedValueOnce([apply]).mockResolvedValueOnce([failed, proof]),
        upsert: jest.fn(),
      },
      msaidiziDevice: { findMany: jest.fn().mockResolvedValue([{ id: apply.deviceId }]) },
    };
    const updateSigner = signer();
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findFirst: jest.fn().mockResolvedValue(candidate) },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      { log: jest.fn() } as never,
      updateSigner as never,
    );

    const result = await service.rollback(candidate.id, user);

    expect(result.deployments).toEqual([
      expect.objectContaining({ id: proof.id, status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK }),
    ]);
    expect(result.candidate.status).toBe(MsaidiziUpdateCandidateStatus.ROLLED_BACK);
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(updateSigner.issue).not.toHaveBeenCalled();
  });
});

function signer() {
  return {
    assertReady: jest.fn(),
    issue: jest.fn((claims: Record<string, unknown>) => {
      const manifestJson = JSON.stringify({
        ...claims,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
      return {
        manifestJson,
        manifestSha256: createHash('sha256').update(manifestJson).digest('hex'),
        signature: 'signature',
        signingKeyId: 'bootstrap-1',
      };
    }),
    healthTimeoutSeconds: 120,
    minimumHealthySoakSeconds: 60,
    minimumRingDwellSeconds: jest.fn((ring: number) =>
      ring === 25 ? 172_800 : ring === 100 ? 259_200 : 86_400,
    ),
    automaticRolloutEnabled: false,
    automaticRolloutSweepSeconds: 15,
    redeliverySeconds: 30,
  };
}

function updateDeployment(
  candidate: ReturnType<typeof updateCandidate>,
  overrides: Record<string, unknown> = {},
) {
  const deployment = {
    id: '66666666-6666-4666-8666-666666666666',
    candidateId: candidate.id,
    deviceId: '55555555-5555-4555-8555-555555555555',
    operation: MsaidiziUpdateDeploymentOperation.APPLY,
    ring: candidate.rolloutRing,
    targetId: candidate.scope,
    status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
    idempotencyKey: 'd'.repeat(64),
    manifestJson: '',
    manifestSha256: 'c'.repeat(64),
    manifestSignature: 'signature',
    signingKeyId: 'bootstrap-1',
    dispatchCount: 1,
    manifestHistory: [],
    deliveryLeaseId: '77777777-7777-4777-8777-777777777777',
    deliveryLeaseExpiresAt: new Date(Date.now() + 60_000),
    deliveryAcknowledgedAt: new Date(),
    resultDigest: 'e'.repeat(64),
    resultSummary: {},
    supervisorJournalHead: 'f'.repeat(64),
    queuedAt: new Date(),
    dispatchedAt: new Date(),
    startedAt: new Date(),
    healthCheckStartedAt: new Date(Date.now() - 61_000),
    healthySoakEvidenceSha256: null,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  deployment.manifestJson = JSON.stringify({
    schemaVersion: 2,
    deploymentId: deployment.id,
    candidateId: deployment.candidateId,
    deviceId: deployment.deviceId,
    operation: deployment.operation,
    ring: deployment.ring,
    targetId: deployment.targetId,
    version: candidate.version,
    rollbackVersion: candidate.rollbackVersion,
    sourceArtifactSha256: candidate.sourceArtifact.sha256,
    rollbackArtifactSha256: candidate.rollbackArtifact.sha256,
    healthTimeoutSeconds: 120,
    minimumHealthySoakSeconds: 60,
    minimumRingDwellSeconds:
      deployment.ring === 25 ? 172_800 : deployment.ring === 100 ? 259_200 : 86_400,
    deliveryLeaseId: deployment.deliveryLeaseId,
    deliveryAttempt: deployment.dispatchCount || 1,
    idempotencyKey: deployment.idempotencyKey,
  });
  return deployment;
}

function updateCandidate(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'candidate-1',
    principalId: 'principal-1',
    proposedByTaskId: '11111111-1111-4111-8111-111111111111',
    sourceArtifactId: '22222222-2222-4222-8222-222222222222',
    rollbackArtifactId: '33333333-3333-4333-8333-333333333333',
    name: 'candidate',
    version: '1.0.0',
    rollbackVersion: '0.9.0',
    scope: 'adapter',
    status: MsaidiziUpdateCandidateStatus.DRAFT,
    evaluationSummary: {},
    reviewerDecisions: [],
    rolloutRing: 0,
    automaticProgressionEnabled: false,
    automaticProgressionArmedAt: null,
    automaticProgressionArmedById: null,
    automaticProgressionMinimumSoakSeconds: null,
    automaticProgressionHealthTimeoutSeconds: null,
    healthSummary: null,
    createdAt: now,
    updatedAt: now,
    deployedAt: null,
    rolledBackAt: null,
    proposedByTask: {
      id: '11111111-1111-4111-8111-111111111111',
      initiatedByUserId: 'user-1',
      companyId: 'company-1',
    },
    sourceArtifact: {
      id: '22222222-2222-4222-8222-222222222222',
      taskId: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64),
      encrypted: true,
    },
    rollbackArtifact: {
      id: '33333333-3333-4333-8333-333333333333',
      taskId: '11111111-1111-4111-8111-111111111111',
      sha256: 'b'.repeat(64),
      encrypted: true,
    },
    ...overrides,
  };
}
