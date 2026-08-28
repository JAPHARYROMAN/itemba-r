import { DivisionsService } from './divisions.service';

describe('DivisionsService mutation audit attribution', () => {
  const user = { id: 'user-1' } as any;

  function makeHarness() {
    const existing = {
      id: 'division-1',
      companyId: 'company-1',
      name: 'Division One',
      isActive: true,
    };
    const prisma = {
      division: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(existing),
      },
      branch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    return {
      service: new DivisionsService(prisma, companyScope, auditLogs),
      prisma,
      auditLogs,
    };
  }

  it.each([
    ['create', 'DIVISION_CREATE'],
    ['update', 'DIVISION_UPDATE'],
    ['remove', 'DIVISION_DELETE'],
  ] as const)(
    'writes exactly one attributable row after %s succeeds',
    async (operation, action) => {
      const { service, auditLogs } = makeHarness();

      if (operation === 'create') {
        await service.create(
          { companyId: 'company-1', name: 'Division One', code: 'D1', type: 'OTHER' },
          user,
        );
      } else if (operation === 'update') {
        await service.update('division-1', { name: 'Updated Division' }, user);
      } else {
        await service.remove('division-1', user);
      }

      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action,
          entityType: 'Division',
          entityId: 'division-1',
          userId: 'user-1',
          companyId: 'company-1',
        }),
      );
    },
  );

  it('does not claim audit evidence when the division mutation fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.division.create.mockRejectedValueOnce(new Error('database rejected mutation'));

    await expect(
      service.create(
        { companyId: 'company-1', name: 'Division One', code: 'D1', type: 'OTHER' },
        user,
      ),
    ).rejects.toThrow('database rejected mutation');
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
