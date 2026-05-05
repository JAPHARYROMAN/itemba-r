import { DashboardService } from './dashboard.service';

function makePrisma() {
  return {
    company: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'company-a',
          name: 'Company A',
          code: 'A',
          status: 'ACTIVE',
          industryType: null,
          divisions: [],
        },
      ]),
    },
    division: { count: jest.fn().mockResolvedValue(2) },
    branch: { count: jest.fn().mockResolvedValue(3) },
    user: { count: jest.fn().mockResolvedValue(4) },
    bankAccount: { count: jest.fn().mockResolvedValue(5) },
    loan: {
      count: jest.fn().mockResolvedValue(6),
      aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingBalance: 900 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    debt: {
      count: jest.fn().mockResolvedValue(7),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1000 } }),
    },
    contract: {
      count: jest.fn().mockResolvedValue(8),
      findMany: jest.fn().mockResolvedValue([]),
    },
    fixedAsset: {
      count: jest.fn().mockResolvedValue(9),
      aggregate: jest.fn().mockResolvedValue({ _sum: { currentBookValue: 2000 } }),
    },
    document: {
      count: jest.fn().mockResolvedValue(10),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      count: jest.fn().mockResolvedValue(11),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

describe('DashboardService executive summary', () => {
  it('applies authenticated company scope to every dashboard aggregate', async () => {
    const prisma = makePrisma();
    const scope = { companyId: { in: ['company-a'] } };
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue(scope),
    };
    const service = new DashboardService(prisma, companyScope as any);
    const user = { id: 'user-1' } as any;

    const result = await service.getExecutiveSummary(user, 'requested-company');

    expect(result.overview).toEqual({
      companies: 1,
      divisions: 2,
      branches: 3,
      activeUsers: 4,
    });
    expect(result.groupControl.loans.outstanding).toBe(900);
    expect(result.groupControl.debts.totalAmount).toBe(1000);
    expect(result.groupControl.fixedAssets.totalValue).toBe(2000);
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith(user, 'requested-company');

    expect(prisma.company.count).toHaveBeenCalledWith({
      where: { deletedAt: null, id: scope.companyId },
    });
    expect(prisma.company.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      id: scope.companyId,
    });
    expect(prisma.branch.count).toHaveBeenCalledWith({
      where: { deletedAt: null, division: { companyId: scope.companyId } },
    });

    for (const fn of [
      prisma.division.count,
      prisma.user.count,
      prisma.bankAccount.count,
      prisma.loan.count,
      prisma.loan.aggregate,
      prisma.loan.findMany,
      prisma.debt.count,
      prisma.debt.aggregate,
      prisma.contract.count,
      prisma.contract.findMany,
      prisma.fixedAsset.count,
      prisma.fixedAsset.aggregate,
      prisma.document.count,
      prisma.document.findMany,
      prisma.auditLog.count,
      prisma.auditLog.findMany,
    ]) {
      for (const [arg] of fn.mock.calls) {
        expect(arg.where.companyId).toEqual(scope.companyId);
      }
    }
  });
});
