import { UserDashboardPreferencesService } from './user-dashboard-preferences.service';

describe('UserDashboardPreferencesService actor-scoped reads', () => {
  it('lists only preferences owned by the authenticated user', async () => {
    const rows = [
      {
        id: 'preference-1',
        userId: 'user-a',
        dashboardDefinitionId: 'dashboard-1',
      },
    ];
    const prisma = {
      userDashboardPreference: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as any;
    const audit = { log: jest.fn() } as any;
    const service = new UserDashboardPreferencesService(prisma, audit);

    const result = await service.list({
      id: 'user-a',
      companyId: 'company-a',
      userId: 'attacker-selected-user',
    });

    expect(prisma.userDashboardPreference.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toBe(rows);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('UserDashboardPreferencesService default invariant', () => {
  function harness() {
    const preference = {
      id: 'preference-target',
      userId: 'user-a',
      dashboardDefinitionId: 'dashboard-target',
      isDefault: true,
    };
    const delegate = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue(preference),
    };
    const lockOwner = jest.fn().mockResolvedValue([{ id: 'user-a' }]);
    const prisma = {
      userDashboardPreference: delegate,
      $transaction: jest.fn(async (work: (tx: any) => unknown) =>
        work({
          $queryRaw: lockOwner,
          userDashboardPreference: delegate,
        }),
      ),
    } as any;
    const audit = {
      log: jest.fn().mockResolvedValue(undefined),
      logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new UserDashboardPreferencesService(prisma, audit);
    return { audit, delegate, lockOwner, prisma, service };
  }

  it('clears only peer defaults and upserts the target in one transaction', async () => {
    const { audit, delegate, lockOwner, prisma, service } = harness();

    await service.upsert(
      'dashboard-target',
      { isDefault: true, filters: { region: 'north' } },
      { id: 'user-a' },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(lockOwner).toHaveBeenCalledTimes(1);
    expect(lockOwner.mock.invocationCallOrder[0]).toBeLessThan(
      delegate.updateMany.mock.invocationCallOrder[0],
    );
    expect(delegate.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        dashboardDefinitionId: { not: 'dashboard-target' },
        isDefault: true,
      },
      data: { isDefault: false },
    });
    expect(delegate.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      delegate.upsert.mock.invocationCallOrder[0],
    );
    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'UPSERT', entityId: 'preference-target' }),
    );
    expect(delegate.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      audit.logStrictInTransaction.mock.invocationCallOrder[0],
    );
  });

  it('sets a default atomically so clearing peers cannot commit without the target upsert', async () => {
    const { delegate, lockOwner, prisma, service } = harness();

    await service.setDefault('dashboard-target', { id: 'user-a' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(lockOwner).toHaveBeenCalledTimes(1);
    expect(lockOwner.mock.invocationCallOrder[0]).toBeLessThan(
      delegate.updateMany.mock.invocationCallOrder[0],
    );
    expect(delegate.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        dashboardDefinitionId: { not: 'dashboard-target' },
        isDefault: true,
      },
      data: { isDefault: false },
    });
    expect(delegate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isDefault: true }),
        update: { isDefault: true },
      }),
    );
  });

  it('does not take the serialization lock for a non-default preference upsert', async () => {
    const { lockOwner, service } = harness();

    await service.upsert('dashboard-target', { isDefault: false }, { id: 'user-a' });

    expect(lockOwner).not.toHaveBeenCalled();
  });

  it.each([
    [
      'preference upsert',
      (service: UserDashboardPreferencesService) =>
        service.upsert('dashboard-target', { isDefault: true }, { id: 'user-a' }),
    ],
    [
      'default selection',
      (service: UserDashboardPreferencesService) =>
        service.setDefault('dashboard-target', { id: 'user-a' }),
    ],
  ])('fails the %s transaction when its mandatory audit append fails', async (_name, invoke) => {
    const { audit, service } = harness();
    const failure = new Error('audit append unavailable');
    audit.logStrictInTransaction.mockRejectedValueOnce(failure);

    await expect(invoke(service)).rejects.toBe(failure);
  });
});
