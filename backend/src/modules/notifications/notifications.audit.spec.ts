import { NotificationsService } from './notifications.service';

const USER = { id: 'user-a' } as any;
const EXISTING = {
  id: 'notification-1',
  companyId: 'company-a',
  recipientUserId: USER.id,
  status: 'UNREAD',
};

function harness() {
  const prisma = {
    notification: {
      findFirst: jest.fn().mockResolvedValue(EXISTING),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...EXISTING, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      delete: jest.fn().mockResolvedValue(EXISTING),
    },
  } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationsService(prisma, audit as any, {} as any);
  return { audit, service };
}

describe('NotificationsService mutation audit attribution', () => {
  it.each([
    ['markRead', 'NOTIFICATION_MARK_READ'],
    ['dismiss', 'NOTIFICATION_DISMISS'],
  ] as const)('%s appends exactly one entity audit row', async (method, action) => {
    const { audit, service } = harness();

    await service[method](EXISTING.id, USER);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action,
        entityType: 'Notification',
        entityId: EXISTING.id,
        userId: USER.id,
      }),
    );
  });

  it('markAllRead appends one batch audit row with the exact update count', async () => {
    const { audit, service } = harness();

    await service.markAllRead(USER);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NOTIFICATIONS_MARK_ALL_READ',
        entityType: 'Notification',
        entityId: USER.id,
        userId: USER.id,
        companyId: null,
        newValue: { updatedCount: 3 },
      }),
    );
  });

  it('remove appends exactly one audit row after the hard delete', async () => {
    const { audit, service } = harness();

    await service.remove(EXISTING.id, USER);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NOTIFICATION_DELETE',
        entityType: 'Notification',
        entityId: EXISTING.id,
        userId: USER.id,
      }),
    );
  });
});
