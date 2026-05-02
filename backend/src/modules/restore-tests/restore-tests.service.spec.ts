import { RestoreTestsService } from './restore-tests.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    backupRun: { findFirst: jest.fn() },
    backgroundJob: { create: jest.fn(), findUnique: jest.fn() },
    restoreTest: { create: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('RestoreTestsService backup verification idempotency', () => {
  it('returns the existing restore test for a repeated backup verification request', async () => {
    const prisma = makePrisma();
    prisma.backupRun.findFirst.mockResolvedValue({
      id: 'backup-A',
      backupRunNumber: 'BR-A',
      status: 'COMPLETED',
    });
    prisma.backgroundJob.findUnique.mockResolvedValue({
      correlationId: 'restore-test-A',
    });
    prisma.restoreTest.findFirst.mockResolvedValue({
      id: 'restore-test-A',
      backupRunId: 'backup-A',
    });
    const service = new RestoreTestsService(prisma, auditLogs());

    await expect(service.verifyBackup('backup-A', 'user-A')).resolves.toMatchObject({
      id: 'restore-test-A',
      backupRunId: 'backup-A',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
