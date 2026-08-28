import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { JobQueueConfigsService } from './job-queue-configs.service';

const groupUser: AuthUser = {
  id: 'user-1',
  email: 'queue-admin@itemba.local',
  roles: ['GROUP_PLATFORM_ADMIN'],
  roleScopes: ['GROUP'],
  permissions: ['job_queue_configs.manage'],
  companyId: null,
  companyAccess: [],
};

const companyUser: AuthUser = {
  ...groupUser,
  id: 'user-company',
  email: 'company-admin@itemba.local',
  roles: ['COMPANY_ADMIN'],
  roleScopes: ['COMPANY'],
  companyId: 'company-1',
};

describe('JobQueueConfigsService mutation audit attribution', () => {
  function makeHarness() {
    const existing = {
      id: 'queue-1',
      queueName: 'evidence-queue',
      description: null,
      isActive: true,
    };
    const prisma = {
      jobQueueConfig: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...existing, ...data })),
        delete: jest.fn().mockResolvedValue(existing),
      },
    } as any;
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    return {
      service: new JobQueueConfigsService(prisma, auditLogs),
      prisma,
      auditLogs,
    };
  }

  it.each([
    ['create', 'JOB_QUEUE_CONFIG_CREATED'],
    ['update', 'JOB_QUEUE_CONFIG_UPDATED'],
    ['activate', 'JOB_QUEUE_CONFIG_ACTIVATED'],
    ['deactivate', 'JOB_QUEUE_CONFIG_DEACTIVATED'],
    ['remove', 'JOB_QUEUE_CONFIG_DELETED'],
  ] as const)(
    'writes exactly one attributable row after %s succeeds',
    async (operation, action) => {
      const { service, auditLogs } = makeHarness();

      if (operation === 'create') {
        await service.create({ queueName: 'evidence-queue' }, 'user-1');
      } else if (operation === 'update') {
        await service.update('queue-1', { description: 'updated' }, 'user-1');
      } else if (operation === 'activate') {
        await service.setActive('queue-1', true, 'user-1');
      } else if (operation === 'deactivate') {
        await service.setActive('queue-1', false, 'user-1');
      } else {
        await service.remove('queue-1', groupUser);
      }

      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action,
          entityType: 'JobQueueConfig',
          entityId: 'queue-1',
          userId: 'user-1',
          companyId: null,
        }),
      );
    },
  );

  it('rejects global queue deletion for a company-scoped user before loading or mutating it', async () => {
    const { service, prisma, auditLogs } = makeHarness();

    await expect(service.remove('queue-1', companyUser)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.jobQueueConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.jobQueueConfig.delete).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('does not claim audit evidence when the queue mutation fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.jobQueueConfig.update.mockRejectedValueOnce(new Error('database rejected mutation'));

    await expect(service.update('queue-1', { description: 'updated' }, 'user-1')).rejects.toThrow(
      'database rejected mutation',
    );
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
