import { DataQualityService } from './data-quality.service';

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dataQualityIssue: {
      count: jest
        .fn()
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(1),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ entityType: 'Customer', _count: { _all: 2 } }])
        .mockResolvedValueOnce([{ severity: 'LOW', _count: { _all: 6 } }])
        .mockResolvedValueOnce([{ status: 'RESOLVED', _count: { _all: 4 } }])
        .mockResolvedValueOnce([{ issueType: 'MISSING_REQUIRED_FIELD', _count: { _all: 2 } }]),
    },
    ...overrides,
  } as any;
}

describe('DataQualityService readiness', () => {
  it('returns data-quality readiness above the 90% threshold', async () => {
    const service = new DataQualityService(
      makePrisma(),
      { log: jest.fn() } as any,
      { runAll: jest.fn() } as any,
    );

    const readiness = await service.getReadiness({ id: 'user-1', companyId: 'company-1' });

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.checks).toHaveLength(3);
    expect(readiness.indicators.openIssues).toBe(2);
    expect(readiness.byType).toEqual({ MISSING_REQUIRED_FIELD: 2 });
  });

  it('marks readiness critical when critical quality issues are open', async () => {
    const prisma = makePrisma({
      dataQualityIssue: {
        count: jest
          .fn()
          .mockResolvedValueOnce(12)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(4)
          .mockResolvedValueOnce(1),
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([{ entityType: 'Customer', _count: { _all: 2 } }])
          .mockResolvedValueOnce([{ severity: 'CRITICAL', _count: { _all: 1 } }])
          .mockResolvedValueOnce([{ status: 'OPEN', _count: { _all: 1 } }])
          .mockResolvedValueOnce([{ issueType: 'OTHER', _count: { _all: 1 } }]),
      },
    });
    const service = new DataQualityService(
      prisma,
      { log: jest.fn() } as any,
      { runAll: jest.fn() } as any,
    );

    const readiness = await service.getReadiness({ id: 'user-1', companyId: 'company-1' });

    expect(readiness.status).toBe('CRITICAL');
    expect(readiness.checks.find((check) => check.key === 'critical-quality-risk')?.status).toBe(
      'CRITICAL',
    );
  });
});
