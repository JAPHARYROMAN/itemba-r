import { SystemHealthService } from './system-health.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    systemHealthCheck: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    backgroundJob: { count: jest.fn().mockResolvedValue(0) },
    backupJob: { count: jest.fn().mockResolvedValue(1) },
    backupRun: { count: jest.fn().mockResolvedValue(0) },
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('SystemHealthService automated checks', () => {
  it('marks queue health critical when dead-letter jobs exist', async () => {
    const prisma = makePrisma({
      systemHealthCheck: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'health-A',
          checkType: 'QUEUE',
          endpointOrTarget: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'health-A', status: 'CRITICAL' }),
      },
      backgroundJob: {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
      },
    });
    const service = new SystemHealthService(prisma, auditLogs());

    await service.runCheck('health-A', 'user-A');

    expect(prisma.systemHealthCheck.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'health-A' },
        data: expect.objectContaining({
          status: 'CRITICAL',
          lastMessage: expect.stringContaining('dead-letter'),
        }),
      }),
    );
  });

  it('marks backup health critical when no active backup jobs exist', async () => {
    const prisma = makePrisma({
      systemHealthCheck: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'health-B',
          checkType: 'BACKUP',
          endpointOrTarget: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'health-B', status: 'CRITICAL' }),
      },
      backupJob: {
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      },
      backupRun: { count: jest.fn().mockResolvedValue(0) },
    });
    const service = new SystemHealthService(prisma, auditLogs());

    await service.runCheck('health-B', 'user-A');

    expect(prisma.systemHealthCheck.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'health-B' },
        data: expect.objectContaining({
          status: 'CRITICAL',
          lastMessage: 'No active backup jobs are configured',
        }),
      }),
    );
  });

  it('keeps database checks automated and healthy', async () => {
    const prisma = makePrisma({
      systemHealthCheck: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'health-C',
          checkType: 'DATABASE',
          endpointOrTarget: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'health-C', status: 'HEALTHY' }),
      },
    });
    const service = new SystemHealthService(prisma, auditLogs());

    await service.runCheck('health-C', 'user-A');

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.systemHealthCheck.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'HEALTHY',
          lastMessage: 'Database connection OK',
        }),
      }),
    );
  });
});
