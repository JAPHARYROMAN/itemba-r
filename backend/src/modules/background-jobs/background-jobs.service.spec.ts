import { ForbiddenException } from '@nestjs/common';
import { BackgroundJobStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, ObservabilityBudgetService } from '../../common/services';
import { BackgroundJobsService } from './background-jobs.service';

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-A',
    email: 'user-a@itemba.local',
    roles: ['Company User'],
    roleScopes: ['COMPANY'],
    permissions: [],
    companyId: 'company-A',
    companyAccess: [],
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    userCompanyAccess: { findMany: jest.fn().mockResolvedValue([]) },
    backgroundJob: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ...overrides,
  } as any;
}

function auditLogs() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

function serviceFor(prisma: any) {
  return new BackgroundJobsService(
    prisma,
    auditLogs(),
    new ObservabilityBudgetService(),
    new CompanyScopeService(prisma),
  );
}

describe('BackgroundJobsService company scope and replay', () => {
  it('rejects another company filter before querying jobs', async () => {
    const prisma = makePrisma();
    const service = serviceFor(prisma);

    await expect(service.findAll({ companyId: 'company-B' }, authUser())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.backgroundJob.findMany).not.toHaveBeenCalled();
  });

  it('defaults company-scoped enqueues to the caller company', async () => {
    const prisma = makePrisma();
    prisma.backgroundJob.create.mockResolvedValue({ id: 'job-A', companyId: 'company-A' });
    const service = serviceFor(prisma);

    await service.enqueue(
      { jobType: 'DATA_EXPORT', queueName: 'data-exports', payload: { ok: true } },
      authUser(),
    );

    expect(prisma.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'company-A', requestedById: 'user-A' }),
      }),
    );
  });

  it('does not leak an idempotent job from another company', async () => {
    const prisma = makePrisma();
    prisma.backgroundJob.findUnique.mockResolvedValue({
      id: 'job-B',
      companyId: 'company-B',
      status: BackgroundJobStatus.QUEUED,
    });
    const service = serviceFor(prisma);

    await expect(
      service.enqueue(
        {
          jobType: 'DATA_EXPORT',
          queueName: 'data-exports',
          idempotencyKey: 'shared-key',
        },
        authUser(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it('requeues a terminal idempotent job instead of creating a duplicate', async () => {
    const prisma = makePrisma();
    prisma.backgroundJob.findUnique.mockResolvedValue({
      id: 'job-A',
      jobType: 'DATA_EXPORT',
      queueName: 'data-exports',
      companyId: 'company-A',
      status: BackgroundJobStatus.FAILED,
      priority: 'NORMAL',
      payload: { old: true },
      maxAttempts: 3,
      correlationId: 'old-correlation',
    });
    prisma.backgroundJob.update.mockResolvedValue({ id: 'job-A', companyId: 'company-A' });
    const service = serviceFor(prisma);

    await service.enqueue(
      {
        jobType: 'DATA_EXPORT',
        queueName: 'data-exports',
        idempotencyKey: 'export-A',
        payload: { fresh: true },
      },
      authUser(),
    );

    expect(prisma.backgroundJob.create).not.toHaveBeenCalled();
    expect(prisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-A' },
        data: expect.objectContaining({
          status: 'QUEUED',
          attempts: 0,
          payload: { fresh: true },
          errorMessage: null,
        }),
      }),
    );
  });

  it('replays dead-letter jobs by resetting attempts', async () => {
    const prisma = makePrisma();
    prisma.backgroundJob.findUnique.mockResolvedValue({
      id: 'job-A',
      companyId: 'company-A',
      status: BackgroundJobStatus.DEAD_LETTER,
      attempts: 3,
      maxAttempts: 3,
    });
    prisma.backgroundJob.update.mockResolvedValue({ id: 'job-A', companyId: 'company-A' });
    const service = serviceFor(prisma);

    await service.retry('job-A', authUser());

    expect(prisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-A' },
        data: expect.objectContaining({
          status: 'QUEUED',
          attempts: 0,
          scheduledAt: null,
          failedAt: null,
          errorMessage: null,
        }),
      }),
    );
  });
});
