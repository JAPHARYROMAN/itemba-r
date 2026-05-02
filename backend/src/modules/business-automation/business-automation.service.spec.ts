import { BusinessAutomationService } from './business-automation.service';

function makePrisma() {
  return {
    automationRule: {
      count: jest
        .fn()
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ automationType: 'APPROVAL', _count: { _all: 4 } }])
        .mockResolvedValueOnce([{ status: 'ACTIVE', _count: { _all: 7 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'rule-1', name: 'Rule 1' }]),
    },
    automationRun: {
      count: jest
        .fn()
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(17)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1),
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({
          _sum: { recordsProcessed: 100, recordsCreated: 25, recordsFailed: 4 },
        })
        .mockResolvedValueOnce({ _sum: { recordsFailed: 4 } }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 17 } }]),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'run-1' }])
        .mockResolvedValueOnce([{ id: 'failed-run-1' }]),
    },
  } as any;
}

describe('BusinessAutomationService dashboard summary', () => {
  it('returns scoped automation rules, run health, and throughput metrics', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new BusinessAutomationService(
      prisma,
      { log: jest.fn() } as any,
      companyScope as any,
    );

    const result = await service.getSummary({ companyId: 'company-1' }, { id: 'user-1' } as any);

    expect(result).toEqual(
      expect.objectContaining({
        totalRules: 12,
        activeRules: 7,
        runsToday: 5,
        recentRuns: 20,
        successfulRuns: 17,
        failedRunsLast7Days: 2,
        successRate: 85,
      }),
    );
    expect(result.throughput).toEqual({
      recordsProcessed: 100,
      recordsCreated: 25,
      recordsFailed: 4,
      failedRunRecords: 4,
    });
    expect(result.ruleTypeBreakdown).toEqual({ APPROVAL: 4 });
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
  });
});
