import { ProductionReadinessService } from './production-readiness.service';

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    productionReadinessCheck: {
      count: jest
        .fn()
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ status: 'PASSED', _count: { _all: 6 } }])
        .mockResolvedValueOnce([{ category: 'SECURITY', _count: { _all: 3 } }]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    environmentConfigCheck: {
      count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(0).mockResolvedValueOnce(0),
    },
    securityPolicy: { count: jest.fn().mockResolvedValue(3) },
    user: { count: jest.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(0) },
    role: { count: jest.fn().mockResolvedValue(10) },
    permission: { count: jest.fn().mockResolvedValue(250) },
    securityEvent: { count: jest.fn().mockResolvedValue(0) },
    backupJob: { count: jest.fn().mockResolvedValue(2) },
    backupRun: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(3) },
    restoreTest: { count: jest.fn().mockResolvedValue(1) },
    disasterRecoveryPlan: { count: jest.fn().mockResolvedValue(1) },
    systemHealthCheck: { count: jest.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(0) },
    errorLog: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0) },
    retentionPolicy: { count: jest.fn().mockResolvedValue(2) },
    ...overrides,
  } as any;
  return prisma;
}

describe('ProductionReadinessService readiness', () => {
  it('returns production/admin/governance readiness above the 90% threshold', async () => {
    const prisma = makePrisma();
    const service = new ProductionReadinessService(prisma, { log: jest.fn() } as any);

    const readiness = await service.getReadiness();

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.checks).toHaveLength(6);
    expect(readiness.indicators.permissions).toBe(250);
    expect(readiness.readinessByStatus).toEqual({ PASSED: 6 });
  });

  it('marks readiness critical when a required environment check fails', async () => {
    const prisma = makePrisma({
      environmentConfigCheck: {
        count: jest
          .fn()
          .mockResolvedValueOnce(12)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
      },
    });
    const service = new ProductionReadinessService(prisma, { log: jest.fn() } as any);

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('CRITICAL');
    expect(readiness.checks.find((check) => check.key === 'environment-config')?.status).toBe(
      'CRITICAL',
    );
  });
});
