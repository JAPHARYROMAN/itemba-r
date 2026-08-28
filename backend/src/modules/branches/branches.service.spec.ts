import { BranchesService } from './branches.service';

describe('BranchesService.findAll', () => {
  const user = { id: 'user-1' } as any;

  it('authorizes an exact division through its company and returns its branches', async () => {
    const rows = [{ id: 'branch-1', divisionId: 'division-1' }];
    const prisma = {
      division: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
      },
      branch: { findMany: jest.fn().mockResolvedValue(rows) },
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      accessibleCompanyIds: jest.fn(),
    } as any;
    const service = new BranchesService(prisma, companyScope, { log: jest.fn() } as any);

    await expect(service.findAll(user, { divisionId: 'division-1' })).resolves.toEqual(rows);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(user, 'company-1');
    expect(companyScope.accessibleCompanyIds).not.toHaveBeenCalled();
    expect(prisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          divisionId: 'division-1',
          division: expect.objectContaining({ companyId: 'company-1' }),
        }),
      }),
    );
  });

  it('returns no branches when the requested division does not exist', async () => {
    const prisma = {
      division: { findFirst: jest.fn().mockResolvedValue(null) },
      branch: { findMany: jest.fn() },
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn(),
      accessibleCompanyIds: jest.fn(),
    } as any;
    const service = new BranchesService(prisma, companyScope, { log: jest.fn() } as any);

    await expect(service.findAll(user, { divisionId: 'missing' })).resolves.toEqual([]);
    expect(prisma.branch.findMany).not.toHaveBeenCalled();
  });
});

describe('BranchesService mutation audit attribution', () => {
  const user = { id: 'user-1' } as any;

  function makeHarness() {
    const division = { companyId: 'company-1' };
    const existing = {
      id: 'branch-1',
      divisionId: 'division-1',
      isActive: true,
      division: { ...division, isActive: true },
    };
    const prisma = {
      division: { findFirst: jest.fn().mockResolvedValue(division) },
      branch: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ ...existing, name: 'Branch One' }),
        update: jest.fn().mockResolvedValue({ ...existing, name: 'Updated Branch' }),
      },
    } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
    } as any;
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    return {
      service: new BranchesService(prisma, companyScope, auditLogs),
      prisma,
      auditLogs,
    };
  }

  it.each([
    ['create', 'BRANCH_CREATE'],
    ['update', 'BRANCH_UPDATE'],
    ['remove', 'BRANCH_DELETE'],
  ] as const)(
    'writes exactly one attributable row after %s succeeds',
    async (operation, action) => {
      const { service, auditLogs } = makeHarness();

      if (operation === 'create') {
        await service.create(
          { divisionId: 'division-1', name: 'Branch One', code: 'B1', type: 'OTHER' },
          user,
        );
      } else if (operation === 'update') {
        await service.update('branch-1', { name: 'Updated Branch' }, user);
      } else {
        await service.remove('branch-1', user);
      }

      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action,
          entityType: 'Branch',
          entityId: 'branch-1',
          userId: 'user-1',
          companyId: 'company-1',
        }),
      );
    },
  );

  it('does not claim audit evidence when the branch mutation fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.branch.create.mockRejectedValueOnce(new Error('database rejected mutation'));

    await expect(
      service.create(
        { divisionId: 'division-1', name: 'Branch One', code: 'B1', type: 'OTHER' },
        user,
      ),
    ).rejects.toThrow('database rejected mutation');
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
