import {
  MsaidiziDeviceStatus,
  MsaidiziPrincipalStatus,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateDeploymentOperation,
  MsaidiziUpdateDeploymentStatus,
} from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { directMtlsPeer } from '../msaidizi-devices/direct-mtls-peer';
import { MsaidiziUpdatesService } from './msaidizi-updates.service';

jest.mock('../msaidizi-devices/direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

const peer = {
  certificateSha256: 'A'.repeat(64),
  publicKeyPem: 'PUBLIC KEY',
  publicKeySha256: 'B'.repeat(64),
  publicKeySpkiSha256: 'C'.repeat(64),
  validFrom: new Date(0),
  validTo: new Date(Date.now() + 60_000),
  chainAuthorized: true,
};

describe('Msaidizi trusted update supervisor channel', () => {
  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue(peer);
  });

  it('queues signed commands without claiming that deployment already happened', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.APPROVED });
    const upsert = jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' }));
    const prisma = {
      msaidiziUpdateCandidate: {
        findFirst: jest.fn().mockResolvedValue(candidate),
        updateMany: jest.fn(),
      },
      msaidiziDevice: {
        findMany: jest.fn().mockResolvedValue([{ id: peerDeviceId }]),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          $queryRaw: jest.fn().mockResolvedValue([{ id: peerDeviceId }]),
          msaidiziUpdateCandidate: { findUnique: jest.fn().mockResolvedValue(candidate) },
          msaidiziDevice: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: peerDeviceId, status: MsaidiziDeviceStatus.ACTIVE }]),
          },
          msaidiziUpdateDeployment: { upsert },
        }),
      ),
    };
    const signer = {
      assertReady: jest.fn(),
      healthTimeoutSeconds: 120,
      minimumHealthySoakSeconds: 60,
      minimumRingDwellSeconds: jest.fn().mockReturnValue(86_400),
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
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      signer as never,
    );

    const result = await service.rollout(candidate.id, { ring: 0 }, user);

    expect(result.candidate.status).toBe(MsaidiziUpdateCandidateStatus.APPROVED);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deviceId: peerDeviceId,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
        }),
      }),
    );
    expect(prisma.msaidiziUpdateCandidate.updateMany).not.toHaveBeenCalled();
  });

  it('promotes only after the assigned mTLS supervisor proves exact activation', async () => {
    const deployment = updateDeployment();
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: peerDeviceId }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      {} as never,
    );

    const result = await service.supervisorResult(successResult(deployment), {} as never);

    expect(result).toEqual(
      expect.objectContaining({ accepted: true, replay: false, status: 'SUCCEEDED' }),
    );
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.CANARY,
          rolloutRing: 0,
        }),
      }),
    );
  });

  it('accepts .NET round-trip UTC timestamps in signed healthy-soak evidence', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-27T09:17:20.632Z'));
      const healthCheckStartedAt = new Date('2026-08-27T09:16:18.632Z');
      const deployment = updateDeployment({
        healthCheckStartedAt,
        startedAt: healthCheckStartedAt,
      });
      const tx = {
        msaidiziUpdateDeployment: {
          findFirst: jest.fn().mockResolvedValue(deployment),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          count: jest.fn().mockResolvedValue(0),
        },
        msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
      };
      const service = new MsaidiziUpdatesService(
        resultPrisma(tx, deployment.deviceId) as never,
        auditHarness() as never,
        {} as never,
      );
      const dto = successResult(deployment);
      dto.health.healthySince = '2026-08-27T09:16:18.6324120+00:00';
      dto.health.healthyThrough = '2026-08-27T09:17:18.6324120+00:00';

      await expect(service.supervisorResult(dto, {} as never)).resolves.toEqual(
        expect.objectContaining({ accepted: true, replay: false, status: 'SUCCEEDED' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['a non-UTC offset', '2026-08-27T09:16:18.6324120+03:00'],
    ['an impossible calendar date', '2026-02-30T09:16:18.6324120+00:00'],
    ['a noncanonical precision', '2026-08-27T09:16:18.63Z'],
    ['trailing data', '2026-08-27T09:16:18.632Z\n'],
  ])('rejects %s in healthy-soak evidence', async (_case, healthySince) => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-27T09:17:20.632Z'));
      const healthCheckStartedAt = new Date('2026-08-27T09:16:18.632Z');
      const deployment = updateDeployment({
        healthCheckStartedAt,
        startedAt: healthCheckStartedAt,
      });
      const tx = {
        msaidiziUpdateDeployment: {
          findFirst: jest.fn().mockResolvedValue(deployment),
          updateMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
      };
      const service = new MsaidiziUpdatesService(
        resultPrisma(tx, deployment.deviceId) as never,
        auditHarness() as never,
        {} as never,
      );
      const dto = successResult(deployment);
      dto.health.healthySince = healthySince;
      dto.health.healthyThrough = '2026-08-27T09:17:18.6324120+00:00';

      await expect(service.supervisorResult(dto, {} as never)).rejects.toThrow(
        'timestamps are invalid',
      );
      expect(tx.msaidiziUpdateDeployment.updateMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not mark an automatic ring 100 ACTIVE while an eligible device is unproven', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.CANARY,
      rolloutRing: 25,
      automaticProgressionEnabled: true,
      automaticProgressionMinimumSoakSeconds: 60,
      automaticProgressionHealthTimeoutSeconds: 120,
      automaticProgressionRing0DwellSeconds: 86_400,
      automaticProgressionRing5DwellSeconds: 86_400,
      automaticProgressionRing25DwellSeconds: 172_800,
      automaticProgressionRing100DwellSeconds: 259_200,
      automaticProgressionCohortDeviceIds: [peerDeviceId, '55555555-5555-4555-8555-555555555559'],
      automaticProgressionCohortSha256: deviceSetDigest([
        peerDeviceId,
        '55555555-5555-4555-8555-555555555559',
      ]),
      automaticProgressionCohortCapturedAt: new Date(),
    });
    const deployment = updateDeployment({
      ring: 100,
      automaticProgression: true,
      candidate,
    });
    deployment.manifestJson = manifestFor(deployment);
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([{ deviceId: deployment.deviceId }]),
      },
      msaidiziDevice: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: deployment.deviceId },
            { id: '55555555-5555-4555-8555-555555555559' },
          ]),
      },
      msaidiziUpdateCandidate: { update },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await service.supervisorResult(successResult(deployment), {} as never);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.CANARY,
          healthSummary: expect.objectContaining({
            automaticProgression: expect.objectContaining({
              awaitingFullEligiblePopulation: true,
              uncoveredDeviceCount: 1,
            }),
          }),
        }),
      }),
    );
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziUpdateCandidateStatus.ACTIVE }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'MSAIDIZI_UPDATE_AUTOMATIC_POPULATION_INCOMPLETE',
        }),
      }),
    );
  });

  it('does not redeliver a command after APPLYING/HEALTH_CHECK crossed the mutation boundary', async () => {
    const deployment = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
      updatedAt: new Date(0),
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany,
        findUnique: jest.fn().mockResolvedValue(deployment),
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({ status: MsaidiziUpdateCandidateStatus.APPROVED }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: peerDeviceId }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      { assertReady: jest.fn(), redeliverySeconds: 30 } as never,
    );

    const result = await service.pollSupervisor({ deviceId: peerDeviceId }, {} as never);

    expect(result).toEqual({ deploymentId: null });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('accepts an idempotent ACK replay after the first response is lost', async () => {
    const deployment = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      deliveryAcknowledgedAt: null,
    });
    const updateMany = jest.fn(async ({ data }) => {
      Object.assign(deployment, data);
      return { count: 1 };
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        findUnique: jest.fn().mockResolvedValue(deployment),
        updateMany,
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          status: MsaidiziUpdateCandidateStatus.APPROVED,
          automaticProgressionEnabled: false,
          principalId: deployment.candidate.principalId,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );
    const acknowledgement = {
      deviceId: deployment.deviceId,
      deploymentId: deployment.id,
      deliveryLeaseId: deployment.deliveryLeaseId,
      manifestSha256: deployment.manifestSha256,
    };

    // The caller deliberately ignores the first successful response to model
    // an ACK-response loss, then replays the durable outbox entry.
    await expect(
      service.acknowledgeSupervisorDelivery(acknowledgement, {} as never),
    ).resolves.toEqual({ accepted: true, replay: false });
    await expect(
      service.acknowledgeSupervisorDelivery(acknowledgement, {} as never),
    ).resolves.toEqual({ accepted: true, replay: true });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale ACK from crossing the APPLYING fence after the candidate failed', async () => {
    const deployment = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      deliveryAcknowledgedAt: new Date(),
    });
    const updateMany = jest.fn();
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        findUnique: jest.fn().mockResolvedValue(deployment),
        updateMany,
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          automaticProgressionEnabled: false,
          principalId: deployment.candidate.principalId,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(
      service.supervisorProgress(applyingProgress(deployment), {} as never),
    ).rejects.toThrow('candidate no longer permits dispatch');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([MsaidiziUpdateCandidateStatus.APPROVED, MsaidiziUpdateCandidateStatus.CANARY])(
    'allows %s to cross the APPLYING fence under the locked current state',
    async (candidateStatus) => {
      const deployment = updateDeployment({
        status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
        deliveryAcknowledgedAt: new Date(),
      });
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        msaidiziUpdateDeployment: {
          findFirst: jest.fn().mockResolvedValue(deployment),
          findUnique: jest.fn().mockResolvedValue(deployment),
          updateMany,
        },
        msaidiziUpdateCandidate: {
          findUnique: jest.fn().mockResolvedValue({
            status: candidateStatus,
            automaticProgressionEnabled: false,
            principalId: deployment.candidate.principalId,
          }),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
      };
      const signer = signerHarness();
      const service = new MsaidiziUpdatesService(
        resultPrisma(tx, deployment.deviceId) as never,
        auditHarness() as never,
        signer as never,
      );

      await expect(
        service.supervisorProgress(applyingProgress(deployment), {} as never),
      ).resolves.toEqual({ accepted: true });
      expect(signer.assertReady).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: MsaidiziUpdateDeploymentStatus.DISPATCHED }),
          data: expect.objectContaining({ status: MsaidiziUpdateDeploymentStatus.APPLYING }),
        }),
      );
    },
  );

  it('accepts APPLYING replay evidence after the candidate later failed', async () => {
    const deployment = updateDeployment({ status: MsaidiziUpdateDeploymentStatus.APPLYING });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const candidateFindUnique = jest.fn().mockResolvedValue({
      status: MsaidiziUpdateCandidateStatus.FAILED,
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        findUnique: jest.fn().mockResolvedValue(deployment),
        updateMany,
      },
      msaidiziUpdateCandidate: { findUnique: candidateFindUnique },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const signer = signerHarness();
    signer.assertReady.mockImplementation(() => {
      throw new ServiceUnavailableException('kill switch active');
    });
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await expect(
      service.supervisorProgress(applyingProgress(deployment), {} as never),
    ).resolves.toEqual({ accepted: true });
    expect(candidateFindUnique).not.toHaveBeenCalled();
    expect(signer.assertReady).not.toHaveBeenCalled();
  });

  it.each([
    ['candidate automatic progression disabled', false, false],
    ['global Autopilot kill active', true, true],
  ])('rechecks %s at the APPLYING fence', async (_case, candidateEnabled, kill) => {
    const deployment = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      deliveryAcknowledgedAt: new Date(),
      automaticProgression: true,
    });
    const updateMany = jest.fn();
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        findUnique: jest.fn().mockResolvedValue(deployment),
        updateMany,
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          status: MsaidiziUpdateCandidateStatus.APPROVED,
          automaticProgressionEnabled: candidateEnabled,
          principalId: deployment.candidate.principalId,
        }),
      },
      msaidiziPrincipal: {
        findUnique: jest.fn().mockResolvedValue({ status: MsaidiziPrincipalStatus.ACTIVE }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const signer = signerHarness();
    signer.automaticRolloutEnabled = true;
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signer as never,
      {
        enabled: true,
        autopilotEnabled: true,
        globalKillSwitchActive: kill,
      } as never,
    );

    await expect(
      service.supervisorProgress(applyingProgress(deployment), {} as never),
    ).rejects.toThrow('Automatic rollout authority is unavailable');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('re-signs an expired delivery without changing action identity and accepts cached old-attempt evidence', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED });
    const deployment = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      candidate,
      deliveryAcknowledgedAt: new Date(0),
      deliveryLeaseExpiresAt: new Date(0),
      updatedAt: new Date(0),
    });
    deployment.manifestJson = manifestFor(deployment);
    const oldManifestSha256 = deployment.manifestSha256;
    const oldDeliveryLeaseId = deployment.deliveryLeaseId;
    const stableIdempotencyKey = deployment.idempotencyKey;
    const candidateUpdate = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn(async ({ data }) => {
      if (data.dispatchCount) {
        Object.assign(deployment, data, {
          dispatchCount: deployment.dispatchCount + 1,
          updatedAt: new Date(),
        });
      } else {
        Object.assign(deployment, data);
      }
      return { count: 1 };
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        findUnique: jest.fn().mockResolvedValue(deployment),
        updateMany,
        findMany: jest.fn().mockResolvedValue([]),
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          automaticProgressionEnabled: false,
          principalId: candidate.principalId,
        }),
        update: candidateUpdate,
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    const redelivery = await service.pollSupervisor({ deviceId: deployment.deviceId }, {} as never);

    expect(redelivery).toEqual(
      expect.objectContaining({ deploymentId: deployment.id, deliveryLeaseId: expect.any(String) }),
    );
    expect(redelivery.manifestSha256).not.toBe(oldManifestSha256);
    expect(redelivery.deliveryLeaseId).not.toBe(oldDeliveryLeaseId);
    expect(deployment.idempotencyKey).toBe(stableIdempotencyKey);
    expect(deployment.manifestHistory).toEqual([
      {
        manifestSha256: oldManifestSha256,
        deliveryLeaseId: oldDeliveryLeaseId,
        deliveryAttempt: 1,
        deliveryAcknowledgedAt: '1970-01-01T00:00:00.000Z',
      },
    ]);

    await expect(
      service.acknowledgeSupervisorDelivery(
        {
          deviceId: deployment.deviceId,
          deploymentId: deployment.id,
          deliveryLeaseId: oldDeliveryLeaseId,
          manifestSha256: oldManifestSha256,
        },
        {} as never,
      ),
    ).rejects.toThrow('invalid or expired');
    await expect(
      service.acknowledgeSupervisorDelivery(
        {
          deviceId: deployment.deviceId,
          deploymentId: deployment.id,
          deliveryLeaseId: redelivery.deliveryLeaseId!,
          manifestSha256: redelivery.manifestSha256!,
        },
        {} as never,
      ),
    ).resolves.toEqual({ accepted: true, replay: false });

    const cachedResult = {
      ...failedResult(deployment),
      manifestSha256: oldManifestSha256,
    };
    await expect(service.supervisorResult(cachedResult, {} as never)).resolves.toEqual(
      expect.objectContaining({ accepted: true, replay: false, status: 'FAILED' }),
    );
    // Model a lost result response: the durable Windows outbox repeats the
    // exact original evidence and receives an idempotent replay response.
    await expect(service.supervisorResult(cachedResult, {} as never)).resolves.toEqual(
      expect.objectContaining({ accepted: true, replay: true, status: 'FAILED' }),
    );
    expect(candidateUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects terminal evidence for the current delivery attempt before its ACK', async () => {
    const deployment = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      deliveryAcknowledgedAt: null,
    });
    const updateMany = jest.fn();
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany,
      },
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(service.supervisorResult(failedResult(deployment), {} as never)).rejects.toThrow(
      'acknowledged signed update manifest',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects terminal evidence from an expired historical attempt that was never ACKed', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED });
    const deployment = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      candidate,
      deliveryAcknowledgedAt: null,
      deliveryLeaseExpiresAt: new Date(0),
      updatedAt: new Date(0),
    });
    deployment.manifestJson = manifestFor(deployment);
    const expiredManifestSha256 = deployment.manifestSha256;
    const updateMany = jest.fn(async ({ data }) => {
      Object.assign(deployment, data, {
        dispatchCount: deployment.dispatchCount + 1,
        updatedAt: new Date(),
      });
      return { count: 1 };
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        findUnique: jest.fn().mockResolvedValue(deployment),
        updateMany,
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          automaticProgressionEnabled: false,
          principalId: candidate.principalId,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(
      service.pollSupervisor({ deviceId: deployment.deviceId }, {} as never),
    ).resolves.toEqual(expect.objectContaining({ deploymentId: deployment.id }));
    expect(deployment.manifestHistory).toEqual([
      expect.objectContaining({
        manifestSha256: expiredManifestSha256,
        deliveryAcknowledgedAt: null,
      }),
    ]);
    updateMany.mockClear();

    await expect(
      service.supervisorResult(
        { ...failedResult(deployment), manifestSha256: expiredManifestSha256 },
        {} as never,
      ),
    ).rejects.toThrow('acknowledged signed update manifest');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('commits terminal evidence and a durable recovery request when rollback signing is unavailable', async () => {
    const deployment = updateDeployment();
    const candidateUpdate = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn(async ({ data }) => {
      Object.assign(deployment, data);
      return { count: 1 };
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany,
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ deviceId: deployment.deviceId }])
          .mockResolvedValueOnce([]),
        upsert: jest.fn(),
      },
      msaidiziUpdateCandidate: { update: candidateUpdate },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const signer = signerHarness();
    signer.assertReady.mockImplementation(() => {
      throw new ServiceUnavailableException('kill switch active');
    });
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await expect(service.supervisorResult(failedResult(deployment), {} as never)).resolves.toEqual(
      expect.objectContaining({ accepted: true, replay: false, status: 'FAILED' }),
    );
    expect(deployment.resultDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          recoveryPending: true,
          recoveryLastErrorCode: 'TRUSTED_SIGNER_UNAVAILABLE',
        }),
      }),
    );
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });

  it('drains only retryable signer recovery records after authority is restored', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.FAILED,
      recoveryPending: true,
      recoveryRequestedAt: new Date(Date.now() - 60_000),
      recoveryLastErrorCode: 'TRUSTED_SIGNER_UNAVAILABLE',
    });
    const source = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.FAILED,
      resultDigest: '9'.repeat(64),
      candidate,
    });
    source.manifestJson = manifestFor(source);
    const upsert = jest.fn(async ({ create }) => ({
      ...create,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    }));
    const candidateUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        update: candidateUpdate,
      },
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(source),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ deviceId: source.deviceId }])
          .mockResolvedValueOnce([]),
        upsert,
      },
      msaidiziDevice: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: source.deviceId, status: MsaidiziDeviceStatus.ACTIVE }]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
    };
    const pending = jest.fn().mockResolvedValue([{ id: candidate.id }]);
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findMany: pending, updateMany: jest.fn() },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(service.advancePendingRecoveries()).resolves.toEqual({
      scanned: 1,
      queued: 1,
      pending: 0,
      disabled: false,
    });
    expect(pending).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recoveryLastErrorCode: {
            in: ['TRUSTED_SIGNER_UNAVAILABLE', 'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED'],
          },
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recoveryPending: false,
          recoveryLastErrorCode: null,
          healthSummary: expect.objectContaining({ rollbackInProgress: true }),
        }),
      }),
    );
  });

  it('drains pre-boundary device-disable recovery from a successful signed peer only', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.FAILED,
      recoveryPending: true,
      recoveryRequestedAt: new Date(Date.now() - 60_000),
      recoveryLastErrorCode: 'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED',
    });
    const successfulPeer = updateDeployment({
      deviceId: '55555555-5555-4555-8555-555555555551',
      ring: 5,
      status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
      resultDigest: '9'.repeat(64),
      candidate,
    });
    successfulPeer.manifestJson = manifestFor(successfulPeer);
    const disabledPreBoundaryDeviceId = '55555555-5555-4555-8555-555555555552';
    const upsert = jest.fn(async ({ create }) => ({
      ...create,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    }));
    const candidateUpdate = jest.fn().mockResolvedValue({});
    const sourceLookup = jest.fn().mockResolvedValue(successfulPeer);
    const tx = {
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue(candidate),
        update: candidateUpdate,
      },
      msaidiziUpdateDeployment: {
        findFirst: sourceLookup,
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { deviceId: successfulPeer.deviceId, resultSummary: null },
            {
              deviceId: disabledPreBoundaryDeviceId,
              resultSummary: {
                source: 'device-disable-reconciliation',
                mutationStarted: false,
                updateBoundaryCrossed: false,
              },
            },
          ])
          .mockResolvedValueOnce([]),
        upsert,
      },
      msaidiziDevice: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: successfulPeer.deviceId, status: MsaidiziDeviceStatus.ACTIVE },
          ]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: candidate.id }]),
    };
    const pending = jest.fn().mockResolvedValue([{ id: candidate.id }]);
    const service = new MsaidiziUpdatesService(
      {
        msaidiziUpdateCandidate: { findMany: pending, updateMany: jest.fn() },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(service.advancePendingRecoveries()).resolves.toEqual({
      scanned: 1,
      queued: 1,
      pending: 0,
      disabled: false,
    });
    expect(sourceLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
          resultDigest: { not: null },
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ deviceId: successfulPeer.deviceId }),
      }),
    );
    expect(upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ deviceId: disabledPreBoundaryDeviceId }),
      }),
    );
    expect(candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recoveryPending: false,
          recoveryLastErrorCode: null,
        }),
      }),
    );
  });

  it('accepts exact late terminal evidence from KILLED but never from REVOKED', async () => {
    const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED });
    const deployment = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
      candidate,
    });
    deployment.manifestJson = manifestFor(deployment);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const killedPrisma = {
      msaidiziDevice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: deployment.deviceId, status: MsaidiziDeviceStatus.KILLED }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const killedService = new MsaidiziUpdatesService(
      killedPrisma as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(
      killedService.supervisorResult(failedResult(deployment), {} as never),
    ).resolves.toEqual(expect.objectContaining({ accepted: true, status: 'FAILED' }));

    const revokedTransaction = jest.fn();
    const revokedService = new MsaidiziUpdatesService(
      {
        msaidiziDevice: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: revokedTransaction,
      } as never,
      auditHarness() as never,
      signerHarness() as never,
    );
    await expect(
      revokedService.supervisorResult(failedResult(deployment), {} as never),
    ).rejects.toThrow('not bound to this device');
    expect(revokedTransaction).not.toHaveBeenCalled();
  });

  it('lets exact KILLED self-rollback evidence resolve its durable recovery gap', async () => {
    const candidate = updateCandidate({
      status: MsaidiziUpdateCandidateStatus.FAILED,
      recoveryPending: true,
      recoveryRequestedAt: new Date(Date.now() - 60_000),
      recoveryLastErrorCode: 'DEVICE_DISABLED_UPDATE_OUTCOME_UNKNOWN',
    });
    const deployment = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
      candidate,
    });
    deployment.manifestJson = manifestFor(deployment);
    const candidateUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      msaidiziUpdateCandidate: {
        findUnique: jest.fn().mockResolvedValue({ recoveryPending: true }),
        update: candidateUpdate,
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      {
        msaidiziDevice: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: deployment.deviceId, status: MsaidiziDeviceStatus.KILLED }),
        },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await service.supervisorResult(rolledBackResult(deployment), {} as never);

    expect(candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.ROLLED_BACK,
          recoveryPending: false,
          recoveryRequestedAt: null,
          recoveryLastErrorCode: null,
        }),
      }),
    );
  });

  it('queues rollback for eligible peers while retaining a killed peer as unproven recovery work', async () => {
    const eligibleDeviceId = peerDeviceId;
    const killedPeerId = '55555555-5555-4555-8555-555555555559';
    const deployment = updateDeployment({ deviceId: eligibleDeviceId });
    deployment.manifestJson = manifestFor(deployment);
    const upsert = jest.fn(async ({ create }) => ({
      ...create,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    }));
    const candidateUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ deviceId: eligibleDeviceId }, { deviceId: killedPeerId }])
          .mockResolvedValueOnce([]),
        upsert,
      },
      msaidiziDevice: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: eligibleDeviceId, status: MsaidiziDeviceStatus.ACTIVE }]),
      },
      msaidiziUpdateCandidate: { update: candidateUpdate },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, deployment.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await service.supervisorResult(failedResult(deployment), {} as never);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ deviceId: eligibleDeviceId }),
      }),
    );
    expect(candidateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recoveryPending: true,
          recoveryLastErrorCode: 'RECOVERY_TARGET_UNAVAILABLE',
          healthSummary: expect.objectContaining({
            unavailableRollbackDevices: 1,
            remainingRollbackDevices: 2,
          }),
        }),
      }),
    );
  });

  it.each([
    ['disabled principal', MsaidiziPrincipalStatus.DISABLED, false, 1],
    ['global kill switch', MsaidiziPrincipalStatus.ACTIVE, true, 0],
  ])(
    'rechecks %s before dispatching an automatic APPLY',
    async (_name, principalStatus, kill, expectedPrincipalReads) => {
      const deployment = updateDeployment({
        status: MsaidiziUpdateDeploymentStatus.QUEUED,
        automaticProgression: true,
      });
      const updateMany = jest.fn();
      const tx = {
        msaidiziUpdateDeployment: {
          findFirst: jest.fn().mockResolvedValue(deployment),
          updateMany,
          findUnique: jest.fn(),
        },
        msaidiziUpdateCandidate: {
          findUnique: jest.fn().mockResolvedValue({
            ...deployment.candidate,
            status: MsaidiziUpdateCandidateStatus.APPROVED,
            automaticProgressionEnabled: true,
            principalId: deployment.candidate.principalId,
            proposedByPlanVersionId: '22222222-2222-4222-8222-222222222220',
            proposedByStepId: '33333333-3333-4333-8333-333333333330',
            proposedByTask: {
              ...deployment.candidate.proposedByTask,
              mandateId: '44444444-4444-4444-8444-444444444440',
            },
          }),
        },
        msaidiziPrincipal: {
          findUnique: jest.fn().mockResolvedValue({ status: principalStatus }),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
      };
      const signer = signerHarness();
      signer.automaticRolloutEnabled = true;
      const service = new MsaidiziUpdatesService(
        resultPrisma(tx, deployment.deviceId) as never,
        auditHarness() as never,
        signer as never,
        {
          enabled: true,
          autopilotEnabled: true,
          globalKillSwitchActive: kill,
        } as never,
      );

      await expect(
        service.pollSupervisor({ deviceId: deployment.deviceId }, {} as never),
      ).resolves.toEqual({ deploymentId: null });
      expect(tx.msaidiziPrincipal.findUnique).toHaveBeenCalledTimes(expectedPrincipalReads);
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('rechecks device eligibility under lock at the dispatch boundary', async () => {
    const deployment = updateDeployment({ status: MsaidiziUpdateDeploymentStatus.QUEUED });
    const updateMany = jest.fn();
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(deployment),
        updateMany,
        findUnique: jest.fn(),
      },
      msaidiziDevice: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: deployment.candidateId }]),
    };
    const prisma = {
      msaidiziDevice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: deployment.deviceId, status: MsaidiziDeviceStatus.ACTIVE }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(
      service.pollSupervisor({ deviceId: deployment.deviceId }, {} as never),
    ).resolves.toEqual({ deploymentId: null });
    expect(tx.msaidiziDevice.findMany).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('accepts an identical result replay but rejects a different result', async () => {
    const accepted = successResult(updateDeployment());
    const deployment = updateDeployment({ resultDigest: digestFor(accepted) });
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: peerDeviceId }),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          msaidiziUpdateDeployment: { findFirst: jest.fn().mockResolvedValue(deployment) },
        }),
      ),
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      {} as never,
    );

    await expect(service.supervisorResult(accepted, {} as never)).resolves.toEqual(
      expect.objectContaining({ replay: true }),
    );
    await expect(
      service.supervisorResult({ ...accepted, reason: 'different' }, {} as never),
    ).rejects.toThrow('different result');
  });

  it('automatically queues one signed rollback wave for a canary failure and prior healthy rings', async () => {
    const failed = updateDeployment({
      id: '66666666-6666-4666-8666-666666666661',
      deviceId: '55555555-5555-4555-8555-555555555553',
      ring: 25,
      automaticProgression: true,
      candidate: updateCandidate({
        status: MsaidiziUpdateCandidateStatus.CANARY,
        rolloutRing: 5,
        automaticProgressionEnabled: true,
      }),
    });
    failed.manifestJson = manifestFor(failed);
    const upsert = jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' }));
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(failed),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { deviceId: '55555555-5555-4555-8555-555555555551' },
            { deviceId: '55555555-5555-4555-8555-555555555552' },
            { deviceId: failed.deviceId },
          ])
          .mockResolvedValueOnce([]),
        upsert,
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: failed.candidateId }]),
    };
    const prisma = resultPrisma(tx, failed.deviceId);
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      signer as never,
    );

    const result = await service.supervisorResult(
      {
        ...successResult(failed),
        outcome: 'FAILED',
        activatedArtifactSha256: undefined,
        reason: 'health check failed',
      },
      {} as never,
    );

    expect(result).toEqual(expect.objectContaining({ accepted: true, status: 'FAILED' }));
    expect(signer.assertReady).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(
      upsert.mock.calls.map(([call]) => ({
        deviceId: call.create.deviceId,
        operation: call.create.operation,
        ring: call.create.ring,
        targetId: call.create.targetId,
      })),
    ).toEqual([
      {
        deviceId: '55555555-5555-4555-8555-555555555551',
        operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
        ring: 25,
        targetId: failed.targetId,
      },
      {
        deviceId: '55555555-5555-4555-8555-555555555552',
        operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
        ring: 25,
        targetId: failed.targetId,
      },
      {
        deviceId: failed.deviceId,
        operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
        ring: 25,
        targetId: failed.targetId,
      },
    ]);
    for (const [call] of upsert.mock.calls) {
      expect(call.update).toEqual({});
      expect(call.create.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
      expect(call.create.manifestJson).toContain('"operation":"ROLLBACK"');
      expect(call.create.manifestJson).toContain(`"version":"${failed.candidate.version}"`);
      expect(call.create.manifestJson).toContain(`"rollbackArtifactSha256":"${'b'.repeat(64)}"`);
    }
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: expect.objectContaining({
            rollbackInProgress: true,
            queuedRollbackDeployments: 3,
          }),
        }),
      }),
    );
  });

  it('does not regress to FAILED when a late APPLY failure already has an exact rollback proof', async () => {
    const failed = updateDeployment();
    const proof = updateDeployment({
      id: '66666666-6666-4666-8666-666666666673',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK,
      candidate: failed.candidate,
    });
    proof.manifestJson = manifestFor(proof);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(failed),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ deviceId: failed.deviceId }])
          .mockResolvedValueOnce([proof]),
        upsert: jest.fn(),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: failed.candidateId }]),
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, failed.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await service.supervisorResult(failedResult(failed), {} as never);

    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.ROLLED_BACK,
          rolledBackAt: expect.any(Date),
          healthSummary: expect.objectContaining({
            rollbackInProgress: false,
            remainingRollbackDevices: 0,
          }),
        }),
      }),
    );
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(signer.issue).not.toHaveBeenCalled();
  });

  it('uses the candidate lock and idempotent upsert under concurrent partial failures', async () => {
    const first = updateDeployment({
      id: '66666666-6666-4666-8666-666666666661',
      deviceId: '55555555-5555-4555-8555-555555555551',
      ring: 5,
    });
    first.manifestJson = manifestFor(first);
    const second = updateDeployment({
      id: '66666666-6666-4666-8666-666666666662',
      deviceId: '55555555-5555-4555-8555-555555555552',
      ring: 5,
    });
    second.manifestJson = manifestFor(second);
    const deployments = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    const rollbackKeys = new Set<string>();
    const candidateLocks: string[] = [];
    let serialized = Promise.resolve();
    const prisma = {
      msaidiziDevice: {
        findFirst: jest.fn(async ({ where }) => ({ id: where.id })),
      },
      $transaction: jest.fn((callback) => {
        const run = serialized.then(async () =>
          callback({
            msaidiziUpdateDeployment: {
              findFirst: jest.fn(async ({ where }) => deployments.get(where.id)),
              updateMany: jest.fn(async ({ where, data }) => {
                const row = deployments.get(where.id);
                if (!row || row.resultDigest) return { count: 0 };
                Object.assign(row, data);
                return { count: 1 };
              }),
              findMany: jest.fn(async ({ where }) =>
                where.operation === MsaidiziUpdateDeploymentOperation.APPLY
                  ? [{ deviceId: first.deviceId }, { deviceId: second.deviceId }]
                  : [],
              ),
              upsert: jest.fn(async ({ where, create }) => {
                const key = JSON.stringify(where.candidateId_deviceId_ring_operation);
                rollbackKeys.add(key);
                return create;
              }),
            },
            msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
            msaidiziDevice: {
              findMany: jest.fn(({ where }) =>
                (where.id.in as string[]).map((id) => ({
                  id,
                  status: MsaidiziDeviceStatus.ACTIVE,
                })),
              ),
            },
            auditLog: { create: jest.fn().mockResolvedValue({}) },
            $queryRaw: jest.fn(async () => {
              candidateLocks.push('locked');
              return [{ id: first.candidateId }];
            }),
          }),
        );
        serialized = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }),
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    const [one, two] = await Promise.all([
      service.supervisorResult(failedResult(first), {} as never),
      service.supervisorResult(failedResult(second), {} as never),
    ]);

    expect(one).toEqual(expect.objectContaining({ accepted: true, replay: false }));
    expect(two).toEqual(expect.objectContaining({ accepted: true, replay: false }));
    // Each result holds one candidate lock and one ordered device-row lock.
    expect(candidateLocks).toHaveLength(4);
    expect(rollbackKeys.size).toBe(2);
  });

  it('does not classify a known pre-boundary DISPATCHED/FAILED row as activated', async () => {
    const failed = updateDeployment({
      ring: 5,
      status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
    });
    failed.manifestJson = manifestFor(failed);
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(failed),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany,
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: failed.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, failed.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await service.supervisorResult(failedResult(failed), {} as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              ring: { lt: failed.ring },
              status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
            },
            {
              ring: failed.ring,
              status: {
                in: [
                  MsaidiziUpdateDeploymentStatus.APPLYING,
                  MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
                  MsaidiziUpdateDeploymentStatus.SUCCEEDED,
                  MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
                ],
              },
            },
            {
              ring: failed.ring,
              status: MsaidiziUpdateDeploymentStatus.FAILED,
              startedAt: { not: null },
            },
          ],
        }),
      }),
    );
  });

  it('does not enqueue rollback again for an identical failed-result replay', async () => {
    const original = updateDeployment();
    const dto = failedResult(original);
    const failed = updateDeployment({
      resultDigest: digestFor(dto),
      status: MsaidiziUpdateDeploymentStatus.FAILED,
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(failed),
        upsert: jest.fn(),
      },
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, failed.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await expect(service.supervisorResult(dto, {} as never)).resolves.toEqual(
      expect.objectContaining({ replay: true, status: MsaidiziUpdateDeploymentStatus.FAILED }),
    );
    expect(signer.assertReady).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
  });

  it('keeps the candidate failed until every rollback proves the signed artifact and version', async () => {
    const rollback = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
      candidate: updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED }),
    });
    rollback.manifestJson = manifestFor(rollback);
    const peer = updateDeployment({
      id: '66666666-6666-4666-8666-666666666667',
      deviceId: '55555555-5555-4555-8555-555555555556',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
      candidate: rollback.candidate,
    });
    peer.manifestJson = manifestFor(peer);
    const updateCandidateState = jest.fn().mockResolvedValue({});
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        { ...rollback, status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK },
        peer,
      ])
      .mockResolvedValueOnce([
        { ...rollback, status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK },
        { ...peer, status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK },
      ]);
    const makeTx = () => ({
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(rollback),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany,
      },
      msaidiziUpdateCandidate: {
        update: updateCandidateState,
        findUnique: jest.fn().mockResolvedValue({ recoveryPending: false }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: rollback.candidateId }]),
    });
    const prisma = {
      msaidiziDevice: { findFirst: jest.fn().mockResolvedValue({ id: rollback.deviceId }) },
      $transaction: jest.fn(async (callback) => callback(makeTx())),
    };
    const service = new MsaidiziUpdatesService(
      prisma as never,
      auditHarness() as never,
      signerHarness() as never,
    );
    const dto = rolledBackResult(rollback);

    await service.supervisorResult(dto, {} as never);
    rollback.resultDigest = null;
    await service.supervisorResult({ ...dto, deploymentId: rollback.id }, {} as never);

    expect(updateCandidateState.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: expect.objectContaining({
            rollbackInProgress: true,
            remainingRollbackDeployments: 1,
          }),
        }),
      }),
    );
    expect(updateCandidateState.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.ROLLED_BACK,
          rolledBackAt: expect.any(Date),
        }),
      }),
    );
  });

  it('treats one exact rollback proof as authoritative over a historical failed duplicate', async () => {
    const rollback = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      candidate: updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED }),
    });
    rollback.manifestJson = manifestFor(rollback);
    const failedDuplicate = updateDeployment({
      id: '66666666-6666-4666-8666-666666666668',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      ring: 5,
      status: MsaidiziUpdateDeploymentStatus.FAILED,
      candidate: rollback.candidate,
    });
    failedDuplicate.manifestJson = manifestFor(failedDuplicate);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(rollback),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValue([
            failedDuplicate,
            { ...rollback, status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK },
          ]),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: rollback.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, rollback.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await service.supervisorResult(rolledBackResult(rollback), {} as never);

    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.ROLLED_BACK,
          rolledBackAt: expect.any(Date),
        }),
      }),
    );
  });

  it('rejects rollback completion that does not prove the exact signed version', async () => {
    const rollback = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      candidate: updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED }),
    });
    rollback.manifestJson = manifestFor(rollback);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(rollback),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
      },
      msaidiziUpdateCandidate: { update: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ id: rollback.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, rollback.deviceId) as never,
      auditHarness() as never,
      signerHarness() as never,
    );

    await expect(
      service.supervisorResult(
        { ...rolledBackResult(rollback), observedVersion: 'different-version' },
        {} as never,
      ),
    ).rejects.toThrow('signed rollback artifact and version');
    expect(tx.msaidiziUpdateDeployment.findMany).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateCandidate.update).not.toHaveBeenCalled();
  });

  it('keeps rollback NEEDS_ATTENTION terminally failed without recursive dispatch', async () => {
    const rollback = updateDeployment({
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      candidate: updateCandidate({ status: MsaidiziUpdateCandidateStatus.FAILED }),
    });
    rollback.manifestJson = manifestFor(rollback);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(rollback),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: rollback.candidateId }]),
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, rollback.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await expect(
      service.supervisorResult(
        {
          ...rolledBackResult(rollback),
          outcome: 'NEEDS_ATTENTION',
          activatedArtifactSha256: undefined,
          reason: 'rollback activation is uncertain',
        },
        {} as never,
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 'NEEDS_ATTENTION' }));
    expect(tx.msaidiziUpdateDeployment.findMany).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(signer.assertReady).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziUpdateCandidateStatus.FAILED }),
      }),
    );
  });

  it('preserves local APPLY self-rollback without recursively queuing rollback', async () => {
    const apply = updateDeployment();
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(apply),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: apply.candidateId }]),
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, apply.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await service.supervisorResult(rolledBackResult(apply), {} as never);

    expect(tx.msaidiziUpdateDeployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deviceId: { not: apply.deviceId } }),
      }),
    );
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(signer.assertReady).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziUpdateCandidateStatus.ROLLED_BACK }),
      }),
    );
  });

  it('rolls back a successful peer when another APPLY self-rolls back', async () => {
    const peerId = '55555555-5555-4555-8555-555555555551';
    const self = updateDeployment({
      deviceId: '55555555-5555-4555-8555-555555555552',
      ring: 5,
    });
    self.manifestJson = manifestFor(self);
    const queuedPeer = updateDeployment({
      id: '66666666-6666-4666-8666-666666666670',
      deviceId: peerId,
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      ring: 5,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
      candidate: self.candidate,
    });
    queuedPeer.manifestJson = manifestFor(queuedPeer);
    const upsert = jest.fn(async ({ create }) => ({ ...create, status: 'QUEUED' }));
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(self),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ deviceId: peerId }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([queuedPeer]),
        upsert,
        count: jest.fn().mockResolvedValue(1),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: self.candidateId }]),
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, self.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await service.supervisorResult(rolledBackResult(self), {} as never);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deviceId: peerId,
          ring: 5,
          operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
        }),
      }),
    );
    expect(upsert.mock.calls[0][0].create.deviceId).not.toBe(self.deviceId);
    expect(signer.assertReady).toHaveBeenCalledTimes(1);
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: expect.objectContaining({
            rollbackInProgress: true,
            requiredRollbackDevices: 1,
            queuedRollbackDeployments: 1,
          }),
        }),
      }),
    );
  });

  it('reuses an exact non-failed rollback across rings instead of issuing a second mutation', async () => {
    const peerId = '55555555-5555-4555-8555-555555555551';
    const self = updateDeployment({
      deviceId: '55555555-5555-4555-8555-555555555552',
      ring: 25,
    });
    self.manifestJson = manifestFor(self);
    const existing = updateDeployment({
      id: '66666666-6666-4666-8666-666666666669',
      deviceId: peerId,
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      ring: 5,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    });
    existing.manifestJson = manifestFor(existing);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(self),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ deviceId: peerId }])
          .mockResolvedValueOnce([existing])
          .mockResolvedValueOnce([existing]),
        upsert: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: self.candidateId }]),
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, self.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await service.supervisorResult(rolledBackResult(self), {} as never);

    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(signer.assertReady).not.toHaveBeenCalled();
    expect(signer.issue).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: expect.objectContaining({ queuedRollbackDeployments: 0 }),
        }),
      }),
    );
  });

  it('replays duplicate APPLY self-rollback evidence without another peer rollback wave', async () => {
    const original = updateDeployment();
    const dto = rolledBackResult(original);
    const settled = updateDeployment({
      status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK,
      resultDigest: digestFor(dto),
    });
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(settled),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, settled.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await expect(service.supervisorResult(dto, {} as never)).resolves.toEqual(
      expect.objectContaining({ replay: true, status: MsaidiziUpdateDeploymentStatus.ROLLED_BACK }),
    );
    expect(tx.msaidiziUpdateDeployment.findMany).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(signer.assertReady).not.toHaveBeenCalled();
  });

  it('does not let a local self-rollback strand an existing rollback wave', async () => {
    const apply = updateDeployment();
    const rollbackOne = updateDeployment({
      id: '66666666-6666-4666-8666-666666666671',
      deviceId: '55555555-5555-4555-8555-555555555551',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
      candidate: apply.candidate,
    });
    rollbackOne.manifestJson = manifestFor(rollbackOne);
    const rollbackTwo = updateDeployment({
      id: '66666666-6666-4666-8666-666666666672',
      deviceId: '55555555-5555-4555-8555-555555555552',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.FAILED,
      candidate: apply.candidate,
    });
    rollbackTwo.manifestJson = manifestFor(rollbackTwo);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst: jest.fn().mockResolvedValue(apply),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([rollbackOne, rollbackTwo]),
        upsert: jest.fn(),
      },
      msaidiziUpdateCandidate: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: apply.candidateId }]),
    };
    const signer = signerHarness();
    const service = new MsaidiziUpdatesService(
      resultPrisma(tx, apply.deviceId) as never,
      auditHarness() as never,
      signer as never,
    );

    await service.supervisorResult(rolledBackResult(apply), {} as never);

    expect(tx.msaidiziUpdateDeployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deviceId: { not: apply.deviceId } }),
      }),
    );
    expect(tx.msaidiziUpdateDeployment.upsert).not.toHaveBeenCalled();
    expect(signer.assertReady).not.toHaveBeenCalled();
    expect(tx.msaidiziUpdateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: expect.objectContaining({
            rollbackInProgress: true,
            remainingRollbackDeployments: 2,
          }),
        }),
      }),
    );
  });

  it('blocks a stale APPLY poll after failure but continues queued rollback dispatch', async () => {
    const apply = updateDeployment({ status: MsaidiziUpdateDeploymentStatus.QUEUED });
    const rollback = updateDeployment({
      id: '66666666-6666-4666-8666-666666666667',
      operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    });
    rollback.manifestJson = manifestFor(rollback);
    const candidateState = { status: MsaidiziUpdateCandidateStatus.FAILED };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValueOnce(apply).mockResolvedValueOnce(rollback);
    const tx = {
      msaidiziUpdateDeployment: {
        findFirst,
        updateMany,
        findUnique: jest.fn().mockResolvedValue(rollback),
      },
      msaidiziUpdateCandidate: { findUnique: jest.fn().mockResolvedValue(candidateState) },
      msaidiziDevice: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: apply.deviceId, status: MsaidiziDeviceStatus.ACTIVE }]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: apply.candidateId }]),
    };
    const service = new MsaidiziUpdatesService(
      {
        msaidiziDevice: { findFirst: jest.fn().mockResolvedValue({ id: apply.deviceId }) },
        $transaction: jest.fn(async (callback) => callback(tx)),
      } as never,
      auditHarness() as never,
      { ...signerHarness(), redeliverySeconds: 30 } as never,
    );

    await expect(
      service.pollSupervisor({ deviceId: apply.deviceId }, {} as never),
    ).resolves.toEqual({ deploymentId: null });
    await expect(
      service.pollSupervisor({ deviceId: apply.deviceId }, {} as never),
    ).resolves.toEqual(expect.objectContaining({ deploymentId: rollback.id }));
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

const user = { id: 'user-1' } as AuthUser;
const peerDeviceId = '55555555-5555-4555-8555-555555555555';

function auditHarness() {
  return {
    log: jest.fn(),
    logStrictInTransaction: jest.fn(
      (tx: { auditLog?: { create: (input: unknown) => unknown } }, input: unknown) =>
        tx.auditLog?.create({ data: input }),
    ),
  };
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
    scope: 'itemba.msaidizi.application',
    status: MsaidiziUpdateCandidateStatus.DRAFT,
    evaluationSummary: {},
    reviewerDecisions: [],
    rolloutRing: 0,
    automaticProgressionEnabled: false,
    automaticProgressionArmedAt: null,
    automaticProgressionArmedById: null,
    automaticProgressionMinimumSoakSeconds: null,
    automaticProgressionHealthTimeoutSeconds: null,
    automaticProgressionRing0DwellSeconds: null,
    automaticProgressionRing5DwellSeconds: null,
    automaticProgressionRing25DwellSeconds: null,
    automaticProgressionRing100DwellSeconds: null,
    automaticProgressionCohortDeviceIds: null,
    automaticProgressionCohortSha256: null,
    automaticProgressionCohortCapturedAt: null,
    automaticProgressionRingHealthyAt: null,
    automaticProgressionRingEvidenceSha256: null,
    recoveryPending: false,
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

function updateDeployment(overrides: Record<string, unknown> = {}) {
  const candidate = updateCandidate({ status: MsaidiziUpdateCandidateStatus.APPROVED });
  const healthCheckStartedAt = new Date(Date.now() - 61_000);
  const deployment = {
    id: '66666666-6666-4666-8666-666666666666',
    candidateId: candidate.id,
    deviceId: peerDeviceId,
    operation: MsaidiziUpdateDeploymentOperation.APPLY,
    ring: 0,
    targetId: candidate.scope,
    status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
    idempotencyKey: 'd'.repeat(64),
    manifestJson: '',
    manifestSha256: 'c'.repeat(64),
    manifestSignature: 'signature',
    signingKeyId: 'bootstrap-1',
    automaticProgression: false,
    dispatchCount: 1,
    manifestHistory: [],
    deliveryLeaseId: '77777777-7777-4777-8777-777777777777',
    deliveryLeaseExpiresAt: new Date(Date.now() + 600_000),
    deliveryAcknowledgedAt: new Date(),
    resultDigest: null,
    resultSummary: null,
    supervisorJournalHead: null,
    queuedAt: new Date(),
    dispatchedAt: new Date(),
    startedAt: healthCheckStartedAt,
    healthCheckStartedAt,
    healthySoakEvidenceSha256: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    candidate,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'manifestJson')) deployment.manifestJson = manifestFor(deployment);
  return deployment;
}

function successResult(deployment: ReturnType<typeof updateDeployment>) {
  const healthySince = deployment.healthCheckStartedAt ?? deployment.startedAt;
  const healthyThrough = new Date(healthySince.getTime() + 60_000);
  return {
    deviceId: deployment.deviceId,
    deploymentId: deployment.id,
    outcome: 'SUCCEEDED' as const,
    manifestSha256: deployment.manifestSha256,
    journalHeadSha256: 'e'.repeat(64),
    activatedArtifactSha256: 'a'.repeat(64),
    observedVersion: '1.0.0',
    health: {
      ready: true,
      attempts: 2,
      healthyProbeCount: 2,
      continuousHealthySeconds: 60,
      requiredSoakSeconds: 60,
      healthySince: healthySince.toISOString(),
      healthyThrough: healthyThrough.toISOString(),
    },
  };
}

function applyingProgress(deployment: ReturnType<typeof updateDeployment>) {
  return {
    deviceId: deployment.deviceId,
    deploymentId: deployment.id,
    deliveryLeaseId: deployment.deliveryLeaseId,
    status: 'APPLYING' as const,
    manifestSha256: deployment.manifestSha256,
    journalHeadSha256: 'e'.repeat(64),
  };
}

function failedResult(deployment: ReturnType<typeof updateDeployment>) {
  return {
    ...successResult(deployment),
    outcome: 'FAILED' as const,
    activatedArtifactSha256: undefined,
    reason: 'health check failed',
  };
}

function rolledBackResult(deployment: ReturnType<typeof updateDeployment>) {
  return {
    ...successResult(deployment),
    outcome: 'ROLLED_BACK' as const,
    activatedArtifactSha256: 'b'.repeat(64),
    observedVersion: deployment.candidate.rollbackVersion,
  };
}

function manifestFor(deployment: {
  id: string;
  candidateId: string;
  deviceId: string;
  operation: MsaidiziUpdateDeploymentOperation;
  ring: number;
  targetId: string;
  candidate: { version: string; rollbackVersion: string };
  deliveryLeaseId: string;
  dispatchCount: number;
}) {
  return JSON.stringify({
    schemaVersion: 2,
    deploymentId: deployment.id,
    candidateId: deployment.candidateId,
    deviceId: deployment.deviceId,
    operation: deployment.operation,
    ring: deployment.ring,
    targetId: deployment.targetId,
    version: deployment.candidate.version,
    rollbackVersion: deployment.candidate.rollbackVersion,
    sourceArtifactSha256: 'a'.repeat(64),
    rollbackArtifactSha256: 'b'.repeat(64),
    healthTimeoutSeconds: 120,
    minimumHealthySoakSeconds: 60,
    minimumRingDwellSeconds:
      deployment.ring === 25 ? 172_800 : deployment.ring === 100 ? 259_200 : 86_400,
    deliveryLeaseId: deployment.deliveryLeaseId,
    deliveryAttempt: deployment.dispatchCount || 1,
    idempotencyKey: 'd'.repeat(64),
  });
}

function signerHarness() {
  return {
    assertReady: jest.fn(),
    healthTimeoutSeconds: 120,
    minimumHealthySoakSeconds: 60,
    minimumRingDwellSeconds: jest.fn((ring: number) =>
      ring === 25 ? 172_800 : ring === 100 ? 259_200 : 86_400,
    ),
    automaticRolloutEnabled: false,
    automaticRolloutMaximumRing: 100,
    automaticRolloutSweepSeconds: 15,
    redeliverySeconds: 30,
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
  };
}

function resultPrisma(tx: object, deviceId: string) {
  const transaction = tx as {
    msaidiziDevice?: { findMany?: jest.Mock };
    msaidiziUpdateCandidate?: { findUnique?: jest.Mock };
  };
  transaction.msaidiziDevice ??= {};
  transaction.msaidiziDevice.findMany ??= jest.fn(({ where }) =>
    (where.id.in as string[]).map((id) => ({ id, status: MsaidiziDeviceStatus.ACTIVE })),
  );
  if (transaction.msaidiziUpdateCandidate) {
    transaction.msaidiziUpdateCandidate.findUnique ??= jest
      .fn()
      .mockResolvedValue({ recoveryPending: false });
  }
  return {
    msaidiziDevice: {
      findFirst: jest.fn().mockResolvedValue({ id: deviceId, status: MsaidiziDeviceStatus.ACTIVE }),
    },
    $transaction: jest.fn(async (callback: (input: object) => unknown) => callback(transaction)),
  };
}

function deviceSetDigest(deviceIds: readonly string[]): string {
  return createHash('sha256')
    .update([...deviceIds].sort().join('\0'), 'utf8')
    .digest('hex');
}

// Mirrors the service's canonical result encoding for the replay fixture.
function digestFor(dto: {
  deviceId: string;
  deploymentId: string;
  outcome: string;
  manifestSha256: string;
  journalHeadSha256: string;
  activatedArtifactSha256?: string;
  observedVersion?: string;
  health: Record<string, unknown>;
  reason?: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        deviceId: dto.deviceId,
        deploymentId: dto.deploymentId,
        outcome: dto.outcome,
        manifestSha256: dto.manifestSha256,
        journalHeadSha256: dto.journalHeadSha256,
        activatedArtifactSha256: dto.activatedArtifactSha256 ?? null,
        observedVersion: dto.observedVersion ?? null,
        health: sortJsonForDigest(dto.health),
        reason: dto.reason ?? null,
      }),
      'utf8',
    )
    .digest('hex');
}

function sortJsonForDigest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonForDigest);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonForDigest(child)]),
    );
  }
  return value;
}
