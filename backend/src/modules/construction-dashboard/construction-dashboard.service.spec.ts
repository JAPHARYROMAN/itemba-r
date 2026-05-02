import { ConstructionDashboardService } from './construction-dashboard.service';

function makePrisma() {
  return {
    constructionProject: {
      count: jest
        .fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1),
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          contractValue: 1000000,
          budgetAmount: 750000,
          actualCost: 500000,
          billedAmount: 600000,
          receivedAmount: 450000,
        },
      }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 5 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'project-1' }]),
    },
    constructionSite: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 4 } }]),
    },
    subcontractorRecord: {
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { contractValue: 300000, paidAmount: 100000, outstandingAmount: 200000 },
      }),
    },
    projectProgressRecord: {
      count: jest.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(9),
      aggregate: jest.fn().mockResolvedValue({ _avg: { percentComplete: 55.5 } }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'SUBMITTED', _count: { _all: 6 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'progress-1' }]),
    },
    projectMaterialIssue: { count: jest.fn().mockResolvedValue(4) },
    projectBilling: {
      count: jest.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(5),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 650000 } }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'SENT', _count: { _all: 5 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'billing-1' }]),
    },
  } as any;
}

describe('ConstructionDashboardService summary', () => {
  it('returns scoped project delivery, financial, progress, and billing metrics', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new ConstructionDashboardService(prisma, companyScope as any);

    const result = await service.getSummary('company-1', { id: 'user-1' } as any);

    expect(result.projects).toEqual({
      total: 10,
      active: 5,
      planned: 2,
      onHold: 1,
      completed: 2,
      overdue: 1,
      completionRate: 20,
    });
    expect(result.financials).toEqual({
      contractValue: 1000000,
      budgetAmount: 750000,
      actualCost: 500000,
      billedAmount: 600000,
      receivedAmount: 450000,
      billingCoverageRate: 60,
      collectionRate: 75,
    });
    expect(result.progress.averagePercentComplete).toBe(55.5);
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
  });
});
