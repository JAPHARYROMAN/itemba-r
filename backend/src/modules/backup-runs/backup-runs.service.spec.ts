import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BackupRunsService } from './backup-runs.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    backupJob: { findFirst: jest.fn() },
    backupRun: { create: jest.fn() },
    backgroundJob: { create: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('BackupRunsService run creation', () => {
  it('inherits backupType from an active backup job and enqueues worker execution', async () => {
    const tx = {
      backupRun: {
        create: jest.fn().mockResolvedValue({
          id: 'run-A',
          backupRunNumber: 'BR-A',
          backupType: 'DATABASE',
        }),
      },
      backgroundJob: { create: jest.fn().mockResolvedValue({ id: 'job-A' }) },
    };
    const prisma = makePrisma();
    prisma.backupJob.findFirst.mockResolvedValue({
      id: 'backup-job-A',
      backupType: 'DATABASE',
      status: 'ACTIVE',
    });
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    const service = new BackupRunsService(prisma, auditLogs());

    await service.create({ backupJobId: 'backup-job-A' }, 'user-A');

    expect(tx.backupRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backupJobId: 'backup-job-A',
          backupType: 'DATABASE',
          status: 'REQUESTED',
        }),
      }),
    );
    expect(tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: 'BACKUP_RUN',
          queueName: 'backups',
          payload: { backupRunId: 'run-A' },
          correlationId: 'run-A',
          idempotencyKey: expect.stringMatching(/^BACKUP_RUN:/),
        }),
      }),
    );
  });

  it('rejects missing backup jobs', async () => {
    const prisma = makePrisma();
    prisma.backupJob.findFirst.mockResolvedValue(null);
    const service = new BackupRunsService(prisma, auditLogs());

    await expect(service.create({ backupJobId: 'missing' }, 'user-A')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects backupType mismatches against the selected backup job', async () => {
    const prisma = makePrisma();
    prisma.backupJob.findFirst.mockResolvedValue({
      id: 'backup-job-A',
      backupType: 'DATABASE',
      status: 'ACTIVE',
    });
    const service = new BackupRunsService(prisma, auditLogs());

    await expect(
      service.create({ backupJobId: 'backup-job-A', backupType: 'FILE_STORAGE' }, 'user-A'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
