import { MonitoringService } from './monitoring.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    systemHealthCheck: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    errorLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    systemMetric: { findMany: jest.fn().mockResolvedValue([]) },
    backupJob: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    backupRun: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    backgroundJob: { count: jest.fn().mockResolvedValue(0) },
    securityEvent: { count: jest.fn().mockResolvedValue(0) },
    auditLog: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    retentionPolicy: { count: jest.fn().mockResolvedValue(0) },
    dataArchiveJob: { count: jest.fn().mockResolvedValue(0) },
    ...overrides,
  } as any;
}

describe('MonitoringService operational readiness', () => {
  it('returns an OK readiness gate when operational blockers are clear', async () => {
    const prisma = makePrisma({
      systemHealthCheck: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([{ status: 'HEALTHY', _count: { id: 4 } }]),
        count: jest.fn().mockResolvedValue(0),
      },
      backupJob: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
      },
      retentionPolicy: {
        count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0).mockResolvedValueOnce(1),
      },
      auditLog: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue({
          id: 'audit-A',
          action: 'LOGIN',
          severity: 'HIGH',
          createdAt: new Date(),
        }),
      },
    });
    const service = new MonitoringService(prisma);

    const readiness = await service.getOperationalReadiness();

    expect(readiness.status).toBe('ok');
    expect(readiness.readinessScore).toBe(100);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.summary.health.active).toBe(4);
    expect(readiness.summary.backups.activeJobs).toBe(2);
  });

  it('surfaces production blockers across health, jobs, backups, security, and retention', async () => {
    const prisma = makePrisma({
      systemHealthCheck: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([{ status: 'CRITICAL', _count: { id: 1 } }]),
        count: jest.fn().mockResolvedValue(1),
      },
      errorLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(2),
      },
      securityEvent: {
        count: jest
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1),
      },
      backupJob: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      },
      backgroundJob: {
        count: jest
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0),
      },
      retentionPolicy: {
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      },
    });
    const service = new MonitoringService(prisma);

    const readiness = await service.getOperationalReadiness();

    expect(readiness.status).toBe('critical');
    expect(readiness.readinessScore).toBeLessThan(80);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'health', severity: 'critical' }),
        expect.objectContaining({ category: 'errors', severity: 'critical' }),
        expect.objectContaining({ category: 'security', severity: 'critical' }),
        expect.objectContaining({ category: 'backups', severity: 'critical' }),
        expect.objectContaining({ category: 'jobs', severity: 'critical' }),
        expect.objectContaining({ category: 'retention', severity: 'warning' }),
      ]),
    );
  });

  it('keeps the public health response small but includes operational gate status', async () => {
    const prisma = makePrisma({
      systemHealthCheck: { count: jest.fn().mockResolvedValue(0) },
      errorLog: { count: jest.fn().mockResolvedValue(0) },
      backgroundJob: { count: jest.fn().mockResolvedValue(0) },
    });
    const service = new MonitoringService(prisma);

    const health = await service.getPublicHealth();

    expect(health.status).toBe('ok');
    expect(health.database).toBe('up');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operational-gates', status: 'ok' }),
      ]),
    );
  });
});
