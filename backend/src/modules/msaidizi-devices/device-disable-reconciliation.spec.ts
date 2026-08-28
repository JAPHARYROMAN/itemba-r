import {
  MsaidiziDeviceStatus,
  MsaidiziHostActionStatus,
  MsaidiziUpdateDeploymentOperation,
  MsaidiziUpdateDeploymentStatus,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

describe('Msaidizi device disable reconciliation', () => {
  const actor = { id: 'operator-1' } as AuthUser;
  const principal = { id: 'principal-1', status: 'ACTIVE' };
  const killedDevice = {
    id: 'device-1',
    principalId: principal.id,
    name: 'Finance workstation',
    status: MsaidiziDeviceStatus.KILLED,
    platform: 'windows',
    osVersion: '11',
    architecture: 'x64',
    certificateThumbprint: 'A'.repeat(64),
    capabilityManifest: {},
    pairedAt: new Date(),
    lastSeenAt: new Date(),
    revokedAt: null,
    killedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  type DeviceFixture = Omit<typeof killedDevice, 'status' | 'killedAt' | 'revokedAt'> & {
    status: MsaidiziDeviceStatus;
    killedAt: Date | null;
    revokedAt: Date | null;
  };
  const activeAction = {
    id: 'host-action-1',
    deviceId: killedDevice.id,
    status: MsaidiziHostActionStatus.RUNNING,
    step: { mutation: true },
  };

  function harness(
    config: Record<string, unknown> = {},
    existingDevice: DeviceFixture = killedDevice,
  ) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziDevice: {
        findUnique: jest.fn().mockResolvedValue(existingDevice),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziUpdateDeployment: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      msaidiziUpdateCandidate: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      msaidiziPrincipal: { findUnique: jest.fn().mockResolvedValue(principal) },
      msaidiziDevice: {
        findFirst: jest.fn().mockResolvedValue(existingDevice),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziHostAction: { findMany: jest.fn().mockResolvedValue([activeAction]) },
      msaidiziUpdateDeployment: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new MsaidiziDevicesService(
      prisma as never,
      config as never,
      {} as never,
      audit as never,
    );
    const settle = jest
      .spyOn(service as never, 'settleInterruptedAction' as never)
      .mockResolvedValue(undefined as never);
    return { service, prisma, tx, audit, settle };
  }

  it('repairs active actions when a per-device kill retry finds the device already killed', async () => {
    const { service, prisma, settle } = harness();

    await service.kill(killedDevice.id, actor);

    expect(prisma.msaidiziDevice.update).not.toHaveBeenCalled();
    expect(prisma.msaidiziDeviceLease.updateMany).toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      activeAction.id,
      'DEVICE_DISABLED_WRITE_OUTCOME_UNKNOWN',
      true,
      false,
    );
  });

  it('repairs actions on already-disabled devices when kill-all is retried', async () => {
    const { service, prisma, settle } = harness();

    await service.killAll(actor);

    expect(prisma.msaidiziHostAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          device: { principalId: principal.id },
          status: { in: expect.any(Array) },
        },
      }),
    );
    expect(settle).toHaveBeenCalledWith(
      activeAction.id,
      'GLOBAL_DEVICE_KILL_WRITE_OUTCOME_UNKNOWN',
      true,
      false,
    );
  });

  it('reconciles a deployment global kill with conservative boundary semantics', async () => {
    const { service, prisma, settle } = harness({ globalKillSwitchActive: true });
    const actions = [
      { id: 'queued', status: MsaidiziHostActionStatus.QUEUED },
      { id: 'dispatched', status: MsaidiziHostActionStatus.DISPATCHED },
      { id: 'running', status: MsaidiziHostActionStatus.RUNNING },
    ];
    prisma.msaidiziDeviceLease.updateMany.mockResolvedValueOnce({ count: 2 });
    prisma.msaidiziHostAction.findMany.mockResolvedValueOnce(actions).mockResolvedValueOnce([]);

    await expect(service.reconcileGlobalKill()).resolves.toEqual({
      revokedLeases: 2,
      settledActions: 3,
      settledUpdatesBeforeBoundary: 0,
      settledUpdatesAfterBoundary: 0,
    });

    expect(prisma.msaidiziDeviceLease.updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      data: { status: 'REVOKED', releasedAt: expect.any(Date) },
    });
    expect(settle).toHaveBeenCalledWith(
      'queued',
      'GLOBAL_KILL_SWITCH_CANCELLED_BEFORE_DISPATCH',
      false,
      true,
    );
    expect(settle).toHaveBeenCalledWith(
      'dispatched',
      'GLOBAL_KILL_SWITCH_OUTCOME_UNKNOWN',
      true,
      false,
    );
    expect(settle).toHaveBeenCalledWith(
      'running',
      'GLOBAL_KILL_SWITCH_OUTCOME_UNKNOWN',
      true,
      false,
    );
    await expect(service.reconcileGlobalKill()).resolves.toEqual({
      revokedLeases: 0,
      settledActions: 0,
      settledUpdatesBeforeBoundary: 0,
      settledUpdatesAfterBoundary: 0,
    });
    expect(settle).toHaveBeenCalledTimes(3);
  });

  it('is a no-op while the deployment global kill is inactive', async () => {
    const { service, prisma, settle } = harness({ globalKillSwitchActive: false });

    await expect(service.reconcileGlobalKill()).resolves.toEqual({
      revokedLeases: 0,
      settledActions: 0,
      settledUpdatesBeforeBoundary: 0,
      settledUpdatesAfterBoundary: 0,
    });

    expect(prisma.msaidiziDeviceLease.updateMany).not.toHaveBeenCalled();
    expect(prisma.msaidiziHostAction.findMany).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('settles pre-boundary commands safely and post-boundary commands as unknown on kill retry', async () => {
    const { service, tx, audit } = harness();
    tx.msaidiziUpdateDeployment.findMany.mockResolvedValue([
      {
        id: 'queued-update',
        candidateId: 'candidate-1',
        status: MsaidiziUpdateDeploymentStatus.QUEUED,
      },
      {
        id: 'dispatched-update',
        candidateId: 'candidate-1',
        status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
      },
      {
        id: 'applying-update',
        candidateId: 'candidate-1',
        status: MsaidiziUpdateDeploymentStatus.APPLYING,
      },
      {
        id: 'health-update',
        candidateId: 'candidate-1',
        status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
      },
    ]);

    await service.kill(killedDevice.id, actor);

    expect(tx.msaidiziUpdateDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['queued-update', 'dispatched-update'] } }),
        data: expect.objectContaining({
          status: MsaidiziUpdateDeploymentStatus.FAILED,
          resultSummary: expect.objectContaining({
            mutationStarted: false,
            updateBoundaryCrossed: false,
            boundaryState: 'BEFORE_UPDATE_MUTATION',
          }),
        }),
      }),
    );
    expect(tx.msaidiziUpdateDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['applying-update', 'health-update'] } }),
        data: expect.objectContaining({
          status: MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
          resultSummary: expect.objectContaining({
            mutationStarted: true,
            terminalEvidenceMayReconcile: true,
          }),
        }),
      }),
    );
    expect(tx.msaidiziUpdateCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recoveryPending: true,
          recoveryLastErrorCode: 'DEVICE_DISABLED_UPDATE_OUTCOME_UNKNOWN',
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          interruptedUpdatesBeforeBoundary: 2,
          interruptedUpdatesAfterBoundary: 2,
        }),
      }),
    );
  });

  it('repairs update settlement on kill-all retry after device status already committed', async () => {
    const { service, prisma, tx } = harness();
    prisma.msaidiziUpdateDeployment.findMany.mockResolvedValue([{ deviceId: killedDevice.id }]);
    tx.msaidiziUpdateDeployment.findMany.mockResolvedValue([
      {
        id: 'applying-update',
        candidateId: 'candidate-1',
        status: MsaidiziUpdateDeploymentStatus.APPLYING,
      },
    ]);

    await service.killAll(actor);

    expect(tx.msaidiziUpdateDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION }),
      }),
    );
  });

  it('keeps a safely interrupted rollback command in the durable recovery outbox', async () => {
    const { service, tx } = harness();
    tx.msaidiziUpdateDeployment.findMany.mockResolvedValue([
      {
        id: 'queued-rollback',
        candidateId: 'candidate-1',
        operation: 'ROLLBACK',
        status: MsaidiziUpdateDeploymentStatus.QUEUED,
      },
    ]);

    await service.kill(killedDevice.id, actor);

    expect(tx.msaidiziUpdateCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['candidate-1'] } },
        data: expect.objectContaining({
          recoveryPending: true,
          recoveryLastErrorCode: 'DEVICE_DISABLED_ROLLBACK_INCOMPLETE',
        }),
      }),
    );
  });

  it('locks every observed update candidate before the device eligibility CAS', async () => {
    const activeDevice = {
      ...killedDevice,
      status: MsaidiziDeviceStatus.ACTIVE,
      killedAt: null,
    };
    const { service, tx } = harness({}, activeDevice);
    const queuedApply = {
      id: 'queued-apply',
      candidateId: 'candidate-1',
      operation: MsaidiziUpdateDeploymentOperation.APPLY,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    };
    tx.msaidiziDevice.updateMany.mockResolvedValue({ count: 1 });
    tx.msaidiziUpdateDeployment.findMany
      .mockResolvedValueOnce([queuedApply])
      .mockResolvedValueOnce([queuedApply])
      .mockResolvedValueOnce([]);

    await service.kill(activeDevice.id, actor);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.msaidiziDevice.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.msaidiziDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: activeDevice.id,
          status: {
            in: [
              MsaidiziDeviceStatus.PENDING,
              MsaidiziDeviceStatus.ACTIVE,
              MsaidiziDeviceStatus.OFFLINE,
            ],
          },
        }),
      }),
    );
  });

  it('restarts the transaction when a new update candidate appears before the device lock', async () => {
    const activeDevice = {
      ...killedDevice,
      status: MsaidiziDeviceStatus.ACTIVE,
      killedAt: null,
    };
    const { service, prisma, tx } = harness({}, activeDevice);
    const candidateOne = {
      id: 'queued-apply-1',
      candidateId: 'candidate-1',
      operation: MsaidiziUpdateDeploymentOperation.APPLY,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    };
    const candidateTwo = {
      id: 'queued-apply-2',
      candidateId: 'candidate-2',
      operation: MsaidiziUpdateDeploymentOperation.APPLY,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    };
    tx.msaidiziDevice.updateMany.mockResolvedValue({ count: 1 });
    tx.msaidiziUpdateDeployment.findMany
      .mockResolvedValueOnce([candidateOne])
      .mockResolvedValueOnce([candidateOne, candidateTwo])
      .mockResolvedValueOnce([candidateOne, candidateTwo])
      .mockResolvedValueOnce([candidateOne, candidateTwo])
      .mockResolvedValueOnce([]);

    await service.kill(activeDevice.id, actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.msaidiziDevice.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.msaidiziUpdateDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['queued-apply-1', 'queued-apply-2'] } }),
      }),
    );
  });

  it('requests durable peer rollback without classifying the interrupted APPLY as activated', async () => {
    const { service, tx } = harness();
    const queuedApply = {
      id: 'queued-apply',
      candidateId: 'candidate-1',
      operation: MsaidiziUpdateDeploymentOperation.APPLY,
      status: MsaidiziUpdateDeploymentStatus.QUEUED,
    };
    tx.msaidiziUpdateDeployment.findMany
      .mockResolvedValueOnce([queuedApply])
      .mockResolvedValueOnce([queuedApply])
      .mockResolvedValueOnce([{ candidateId: 'candidate-1' }]);

    await service.revoke(killedDevice.id, actor);

    expect(tx.msaidiziUpdateDeployment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['queued-apply'] } }),
        data: expect.objectContaining({
          status: MsaidiziUpdateDeploymentStatus.FAILED,
          resultSummary: expect.objectContaining({
            source: 'device-disable-reconciliation',
            mutationStarted: false,
            updateBoundaryCrossed: false,
            boundaryState: 'BEFORE_UPDATE_MUTATION',
          }),
        }),
      }),
    );
    expect(tx.msaidiziUpdateCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['candidate-1'] }, recoveryPending: false },
      data: {
        recoveryPending: true,
        recoveryRequestedAt: expect.any(Date),
        recoveryLastAttemptAt: expect.any(Date),
        recoveryLastErrorCode: 'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED',
      },
    });
  });
});
