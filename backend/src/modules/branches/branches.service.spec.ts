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
    const service = new BranchesService(prisma, companyScope);

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
    const service = new BranchesService(prisma, companyScope);

    await expect(service.findAll(user, { divisionId: 'missing' })).resolves.toEqual([]);
    expect(prisma.branch.findMany).not.toHaveBeenCalled();
  });
});
