import { MsaidiziDeviceStatus, MsaidiziHostActionStatus, MsaidiziTaskStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

describe('Msaidizi device incident notifications', () => {
  const actor = { id: 'operator-1' } as AuthUser;
  const principal = { id: 'principal-1', status: 'ACTIVE' };
  const activeDevice = {
    id: '22222222-2222-4222-8222-222222222222',
    principalId: principal.id,
    name: 'Finance workstation',
    status: MsaidiziDeviceStatus.ACTIVE,
    platform: 'windows',
    osVersion: '11',
    architecture: 'x64',
    certificateThumbprint: 'A'.repeat(64),
    capabilityManifest: {},
    pairedAt: new Date(),
    lastSeenAt: new Date(),
    revokedAt: null,
    killedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('couples a kill incident to the winning device CAS and emits nothing on replay', async () => {
    const killedDevice = {
      ...activeDevice,
      status: MsaidiziDeviceStatus.KILLED,
      killedAt: new Date(),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziDevice: {
        findUnique: jest.fn().mockResolvedValue(killedDevice),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        findFirst: jest.fn().mockResolvedValueOnce(activeDevice).mockResolvedValue(killedDevice),
      },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziHostAction: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const notifications = {
      notifyMsaidiziDeviceIncident: jest.fn().mockResolvedValue(true),
    };
    const service = new MsaidiziDevicesService(
      prisma as never,
      {} as never,
      {} as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      notifications as never,
    );

    await service.kill(activeDevice.id, actor);
    await service.kill(activeDevice.id, actor);

    expect(notifications.notifyMsaidiziDeviceIncident).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMsaidiziDeviceIncident).toHaveBeenCalledWith(tx, {
      kind: 'KILLED',
      deviceId: activeDevice.id,
      recipientUserId: actor.id,
    });
    expect(tx.msaidiziDevice.updateMany).toHaveBeenCalledTimes(1);
  });

  it('notifies both task attention and the exact device once for an unknown action CAS', async () => {
    const action = {
      id: 'host-action-row-1',
      actionId: 'action-1',
      taskId: '11111111-1111-4111-8111-111111111111',
      stepId: 'step-1',
      deviceId: activeDevice.id,
      leaseId: null,
      status: MsaidiziHostActionStatus.RUNNING,
      reservedExternalEgressBytes: 100n,
      task: {
        initiatedByUserId: 'initiator-1',
        companyId: 'company-1',
        principalId: principal.id,
        mandateId: 'mandate-1',
      },
      step: { mutation: true },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      msaidiziHostAction: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      msaidiziToolAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
      msaidiziTaskStep: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziDeviceLease: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      msaidiziTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziHostAction: { findUnique: jest.fn().mockResolvedValue(action) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const notifications = {
      notifyMsaidiziTaskTerminal: jest.fn().mockResolvedValue(true),
      notifyMsaidiziDeviceIncident: jest.fn().mockResolvedValue(true),
    };
    const service = new MsaidiziDevicesService(
      prisma as never,
      {} as never,
      {} as never,
      {
        logStrictInTransaction: jest.fn((client: typeof tx, input: unknown) =>
          client.auditLog.create({ data: input }),
        ),
      } as never,
      notifications as never,
    );
    const privateService = service as unknown as {
      settleInterruptedAction(
        actionId: string,
        reason: string,
        unknown: boolean,
        cancelled: boolean,
      ): Promise<void>;
    };

    await privateService.settleInterruptedAction(action.id, 'LEASE_OUTCOME_UNKNOWN', true, false);
    await privateService.settleInterruptedAction(action.id, 'LEASE_OUTCOME_UNKNOWN', true, false);

    expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMsaidiziTaskTerminal).toHaveBeenCalledWith(
      tx,
      action.taskId,
      MsaidiziTaskStatus.NEEDS_ATTENTION,
    );
    expect(notifications.notifyMsaidiziDeviceIncident).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMsaidiziDeviceIncident).toHaveBeenCalledWith(tx, {
      kind: 'UNKNOWN_ACTION',
      deviceId: action.deviceId,
      taskId: action.taskId,
      actionId: action.actionId,
    });
  });
});
