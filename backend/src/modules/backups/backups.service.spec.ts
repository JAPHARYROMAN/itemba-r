import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BackupsService } from './backups.service';

const GROUP_USER: AuthUser = {
  id: 'group-user',
  email: 'group-user@itemba.invalid',
  roles: ['group-reader'],
  roleScopes: ['GROUP'],
  permissions: ['backups.dashboard.view'],
};

const COMPANY_USER: AuthUser = {
  ...GROUP_USER,
  id: 'company-user',
  email: 'company-user@itemba.invalid',
  roles: ['company-reader'],
  roleScopes: ['COMPANY'],
  companyId: 'company-1',
};

function makeService() {
  const backupJobFindMany = jest.fn().mockResolvedValue([{ id: 'job-1' }]);
  const backupRunFindMany = jest
    .fn()
    .mockResolvedValueOnce([{ id: 'run-1' }])
    .mockResolvedValueOnce([{ backupType: 'FULL', completedAt: new Date(), fileSizeBytes: 10 }]);
  const backupRunCount = jest.fn().mockResolvedValue(0);
  const prisma = {
    backupJob: { findMany: backupJobFindMany },
    backupRun: { findMany: backupRunFindMany, count: backupRunCount },
  };
  const service = new BackupsService(
    prisma as unknown as PrismaService,
    { log: jest.fn() } as unknown as AuditLogsService,
  );
  return {
    service,
    queryMocks: [backupJobFindMany, backupRunFindMany, backupRunCount],
  };
}

describe('BackupsService dashboard group scope', () => {
  it('allows a group principal to read the global dashboard', async () => {
    const { service, queryMocks } = makeService();

    await expect(service.getDashboard(GROUP_USER)).resolves.toMatchObject({
      activeJobs: [{ id: 'job-1' }],
      recentRuns: [{ id: 'run-1' }],
      failedRunsLast7Days: 0,
    });
    for (const query of queryMocks) expect(query).toHaveBeenCalled();
  });

  it('denies a company principal before any backup query', async () => {
    const { service, queryMocks } = makeService();

    await expect(service.getDashboard(COMPANY_USER)).rejects.toBeInstanceOf(ForbiddenException);
    for (const query of queryMocks) expect(query).not.toHaveBeenCalled();
  });
});
