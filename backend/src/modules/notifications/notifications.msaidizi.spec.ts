import { MsaidiziTaskStatus, NotificationPriority, NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function service() {
  return new NotificationsService({} as never, {} as never, {} as never);
}

function terminalTx(overrides: Record<string, unknown> = {}) {
  const notification = { create: jest.fn().mockResolvedValue({}) };
  const tx = {
    msaidiziTask: {
      findUnique: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Close daily books',
        companyId: 'company-1',
        stateVersion: 7,
        initiatedByUserId: 'initiator-1',
        schedule: { createdByUserId: 'schedule-owner-1' },
        mandate: { createdByUserId: 'mandate-owner-1' },
        ...overrides,
      }),
    },
    notification,
  };
  return { tx, notification };
}

describe('Msaidizi governed notifications', () => {
  it.each([
    [MsaidiziTaskStatus.COMPLETED, NotificationPriority.NORMAL, NotificationType.TASK_REMINDER],
    [MsaidiziTaskStatus.PARTIAL, NotificationPriority.HIGH, NotificationType.SYSTEM_ALERT],
    [MsaidiziTaskStatus.FAILED, NotificationPriority.HIGH, NotificationType.SYSTEM_ALERT],
    [
      MsaidiziTaskStatus.NEEDS_ATTENTION,
      NotificationPriority.CRITICAL,
      NotificationType.SYSTEM_ALERT,
    ],
  ] as const)(
    'writes %s through the supplied transaction with an exact task deep link',
    async (status, priority, notificationType) => {
      const { tx, notification } = terminalTx();

      await service().notifyMsaidiziTaskTerminal(
        tx as never,
        '11111111-1111-4111-8111-111111111111',
        status,
      );

      // The helper receives the requested id, then links the canonical id read
      // inside the same transaction after the caller's CAS increment.
      expect(tx.msaidiziTask.findUnique).toHaveBeenCalledWith({
        where: { id: '11111111-1111-4111-8111-111111111111' },
        select: expect.any(Object),
      });
      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notificationNumber: 'MSAIDIZI-TASK-11111111-1111-4111-8111-111111111111-7',
          recipientUserId: 'initiator-1',
          companyId: 'company-1',
          notificationType,
          priority,
          linkedEntityType: 'MsaidiziTask',
          linkedEntityId: '11111111-1111-4111-8111-111111111111',
          actionUrl: '/msaidizi?workspace=tasks&taskId=11111111-1111-4111-8111-111111111111',
        }),
      });
    },
  );

  it.each([
    ['initiator-1', 'schedule-owner-1', 'mandate-owner-1', 'initiator-1'],
    [null, 'schedule-owner-1', 'mandate-owner-1', 'schedule-owner-1'],
    [null, null, 'mandate-owner-1', 'mandate-owner-1'],
  ])(
    'resolves initiator/schedule/mandate ownership without broadening recipients',
    async (initiatedByUserId, scheduleCreator, mandateCreator, expected) => {
      const { tx, notification } = terminalTx({
        initiatedByUserId,
        schedule: { createdByUserId: scheduleCreator },
        mandate: { createdByUserId: mandateCreator },
      });

      await service().notifyMsaidiziTaskTerminal(
        tx as never,
        '11111111-1111-4111-8111-111111111111',
        MsaidiziTaskStatus.COMPLETED,
      );

      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ recipientUserId: expected }),
      });
    },
  );

  it('writes unknown host-action incidents as critical device deep links', async () => {
    const notification = { create: jest.fn().mockResolvedValue({}) };
    const tx = {
      msaidiziDevice: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Finance workstation',
        }),
      },
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          initiatedByUserId: null,
          schedule: { createdByUserId: null },
          mandate: { createdByUserId: 'mandate-owner-1' },
        }),
      },
      notification,
    };

    await service().notifyMsaidiziDeviceIncident(tx as never, {
      kind: 'UNKNOWN_ACTION',
      deviceId: '22222222-2222-4222-8222-222222222222',
      taskId: '11111111-1111-4111-8111-111111111111',
      actionId: 'action-1',
    });

    expect(notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientUserId: 'mandate-owner-1',
        notificationType: NotificationType.SECURITY_ALERT,
        priority: NotificationPriority.CRITICAL,
        linkedEntityType: 'MsaidiziDevice',
        linkedEntityId: '22222222-2222-4222-8222-222222222222',
        actionUrl: '/msaidizi?workspace=devices&deviceId=22222222-2222-4222-8222-222222222222',
      }),
    });
  });

  it.each([
    ['KILLED', NotificationPriority.CRITICAL],
    ['REVOKED', NotificationPriority.HIGH],
  ] as const)(
    'assigns governed %s device priority to the explicit operator',
    async (kind, priority) => {
      const notification = { create: jest.fn().mockResolvedValue({}) };
      const tx = {
        msaidiziDevice: {
          findUnique: jest.fn().mockResolvedValue({
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Finance workstation',
          }),
        },
        notification,
      };

      await service().notifyMsaidiziDeviceIncident(tx as never, {
        kind,
        deviceId: '22222222-2222-4222-8222-222222222222',
        recipientUserId: 'operator-1',
      });

      expect(notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recipientUserId: 'operator-1',
          priority,
          notificationType: NotificationType.SECURITY_ALERT,
          actionUrl: '/msaidizi?workspace=devices&deviceId=22222222-2222-4222-8222-222222222222',
        }),
      });
    },
  );
});
