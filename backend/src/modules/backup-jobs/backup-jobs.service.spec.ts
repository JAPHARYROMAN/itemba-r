import { BackupJobsService } from './backup-jobs.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    backupJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('BackupJobsService scheduling', () => {
  it('computes nextRunAt for scheduled jobs on create', async () => {
    const prisma = makePrisma();
    prisma.backupJob.create.mockImplementation(async ({ data }: any) => ({ id: 'job-A', ...data }));
    const service = new BackupJobsService(prisma, auditLogs());

    const result = await service.create(
      {
        name: 'Daily database backup',
        backupType: 'DATABASE',
        schedule: 'DAILY',
        storageTarget: 'LOCAL',
      },
      'user-A',
    );

    expect(result.nextRunAt).toBeInstanceOf(Date);
    expect(prisma.backupJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schedule: 'DAILY',
          nextRunAt: expect.any(Date),
        }),
      }),
    );
  });

  it('clears nextRunAt for manual jobs on create', async () => {
    const prisma = makePrisma();
    prisma.backupJob.create.mockImplementation(async ({ data }: any) => ({ id: 'job-A', ...data }));
    const service = new BackupJobsService(prisma, auditLogs());

    await service.create(
      {
        name: 'Manual database backup',
        backupType: 'DATABASE',
        schedule: 'MANUAL',
        storageTarget: 'LOCAL',
      },
      'user-A',
    );

    expect(prisma.backupJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextRunAt: null }),
      }),
    );
  });

  it('recomputes nextRunAt when schedule changes', async () => {
    const prisma = makePrisma();
    prisma.backupJob.findFirst.mockResolvedValue({
      id: 'job-A',
      schedule: 'MANUAL',
      scheduleConfig: {},
    });
    prisma.backupJob.update.mockImplementation(async ({ data }: any) => ({ id: 'job-A', ...data }));
    const service = new BackupJobsService(prisma, auditLogs());

    await service.update('job-A', { schedule: 'HOURLY' }, 'user-A');

    expect(prisma.backupJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-A' },
        data: expect.objectContaining({
          schedule: 'HOURLY',
          nextRunAt: expect.any(Date),
        }),
      }),
    );
  });
});
