import { NotFoundException } from '@nestjs/common';
import { ScheduledReportsService } from './scheduled-reports.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';

/**
 * Regression coverage for the two audited HIGH defects:
 *  1) nextRunAt was never initialized on create/activate/run, so scheduled
 *     reports never became due (the dispatch selector requires nextRunAt != null).
 *  2) Group-level reports (companyId=null) always threw NotFoundException in
 *     run() because companyWhereFor clobbered the id filter to { id: { in: [] } }.
 *
 * These tests use the REAL CompanyScopeService (not a mock) so the company-scope
 * logic that masked defect #2 is actually exercised.
 */
function makeService(prismaOverrides: any = {}) {
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = {
    scheduledReport: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'sr-1' }),
    },
    reportRun: { create: jest.fn().mockResolvedValue({ id: 'run-1', filters: {} }) },
    dataExportLog: { create: jest.fn().mockResolvedValue({ id: 'exp-1' }) },
    userCompanyAccess: { findMany: jest.fn().mockResolvedValue([]) },
    ...prismaOverrides,
  } as any;
  const companyScope = new CompanyScopeService(prisma);
  const service = new ScheduledReportsService(prisma, audit, companyScope);
  return { service, prisma, audit, companyScope };
}

const REPORT_DEFINITION = {
  reportCode: 'RPT-1',
  name: 'Sales Summary',
  datasetKey: 'sales_summary',
  reportCategory: 'SALES',
};

// A group-scoped principal with NO explicit company grants — exactly the shape
// JobWorkerService.resolveReportPrincipal returns for a group-level report.
const groupPrincipal: any = {
  id: 'group-user',
  email: 'director@itemba.co.tz',
  roles: [],
  roleScopes: ['GROUP'],
  permissions: [],
  companyId: null,
  companyAccess: [],
};

const companyPrincipal: any = {
  id: 'user-1',
  email: 'ops@itemba.co.tz',
  roles: [],
  roleScopes: [],
  permissions: [],
  companyId: null,
  companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
};

describe('ScheduledReportsService — nextRunAt initialization', () => {
  it('create() arms nextRunAt from the frequency for an active schedule', async () => {
    const { service, prisma } = makeService({
      scheduledReport: {
        create: jest.fn().mockResolvedValue({ id: 'sr-1' }),
      },
    });

    const now = Date.now();
    await service.create(
      {
        scheduleCode: 'S-1',
        reportDefinitionId: 'def-1',
        companyId: 'company-1',
        name: 'Daily Sales',
        frequency: 'DAILY' as any,
        recipients: { emails: ['a@b.com'] },
        exportFormat: 'CSV' as any,
      } as any,
      companyPrincipal,
    );

    const data = prisma.scheduledReport.create.mock.calls[0][0].data;
    expect(data.nextRunAt).toBeInstanceOf(Date);
    // DAILY => ~24h out.
    const delta = (data.nextRunAt as Date).getTime() - now;
    expect(delta).toBeGreaterThan(23 * 3600_000);
    expect(delta).toBeLessThan(25 * 3600_000);
  });

  it('create() advances by 7 days for WEEKLY', async () => {
    const { service, prisma } = makeService({
      scheduledReport: { create: jest.fn().mockResolvedValue({ id: 'sr-1' }) },
    });
    const now = Date.now();
    await service.create(
      {
        scheduleCode: 'S-2',
        reportDefinitionId: 'def-1',
        companyId: 'company-1',
        name: 'Weekly',
        frequency: 'WEEKLY' as any,
        recipients: {},
        exportFormat: 'CSV' as any,
      } as any,
      companyPrincipal,
    );
    const data = prisma.scheduledReport.create.mock.calls[0][0].data;
    const delta = (data.nextRunAt as Date).getTime() - now;
    expect(delta).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(delta).toBeLessThan(7.1 * 24 * 3600_000);
  });

  it('create() leaves nextRunAt null for an inactive schedule', async () => {
    const { service, prisma } = makeService({
      scheduledReport: { create: jest.fn().mockResolvedValue({ id: 'sr-1' }) },
    });
    await service.create(
      {
        scheduleCode: 'S-3',
        reportDefinitionId: 'def-1',
        companyId: 'company-1',
        name: 'Inactive',
        frequency: 'DAILY' as any,
        recipients: {},
        exportFormat: 'CSV' as any,
        isActive: false,
      } as any,
      companyPrincipal,
    );
    const data = prisma.scheduledReport.create.mock.calls[0][0].data;
    expect(data.nextRunAt).toBeNull();
  });

  it('activate() re-arms nextRunAt when it is null', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'sr-1', isActive: true });
    const { service, prisma } = makeService({
      scheduledReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sr-1',
          companyId: 'company-1',
          frequency: 'MONTHLY',
          isActive: false,
          nextRunAt: null,
        }),
        update,
      },
    });

    await service.activate('sr-1', companyPrincipal);

    const data = update.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect(data.nextRunAt).toBeInstanceOf(Date);
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('activate() keeps an already-armed future nextRunAt intact', async () => {
    const future = new Date(Date.now() + 10 * 24 * 3600_000);
    const update = jest.fn().mockResolvedValue({ id: 'sr-1', isActive: true });
    const { service } = makeService({
      scheduledReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sr-1',
          companyId: 'company-1',
          frequency: 'MONTHLY',
          isActive: false,
          nextRunAt: future,
        }),
        update,
      },
    });

    await service.activate('sr-1', companyPrincipal);

    const data = update.mock.calls[0][0].data;
    expect(data.nextRunAt).toBeUndefined();
  });
});

describe('ScheduledReportsService — group-level run() (companyId=null)', () => {
  const groupSchedule = {
    id: 'sr-group',
    scheduleCode: 'SG-1',
    name: 'Group Report',
    companyId: null,
    frequency: 'DAILY',
    isActive: true,
    nextRunAt: new Date(Date.now() - 1000), // due (past)
    exportFormat: 'CSV',
    scheduleConfig: null,
    reportDefinitionId: 'def-1',
    savedReportViewId: null,
    reportDefinition: REPORT_DEFINITION,
    savedReportView: null,
  };

  it('run() succeeds for a group-level report with a group principal (no NotFound)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'sr-group' });
    const { service, prisma } = makeService({
      scheduledReport: {
        findFirst: jest.fn().mockResolvedValue(groupSchedule),
        update,
      },
    });

    const result = await service.run('sr-group', groupPrincipal);

    expect(result.reportRunId).toBe('run-1');
    // The lookup must NOT carry a company-scope filter that clobbers id.
    const where = prisma.scheduledReport.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('sr-group');
    expect(where).not.toHaveProperty('companyId');
    // nextRunAt advanced because the observed window was already due.
    const data = update.mock.calls[0][0].data;
    expect(data.lastRunAt).toBeInstanceOf(Date);
    expect(data.nextRunAt).toBeInstanceOf(Date);
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('run() still throws NotFound when the schedule does not exist', async () => {
    const { service } = makeService({
      scheduledReport: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.run('missing', groupPrincipal)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('run() does NOT double-advance nextRunAt when it is already in the future (worker path)', async () => {
    const future = new Date(Date.now() + 24 * 3600_000);
    const update = jest.fn().mockResolvedValue({ id: 'sr-group' });
    const { service } = makeService({
      scheduledReport: {
        findFirst: jest.fn().mockResolvedValue({ ...groupSchedule, nextRunAt: future }),
        update,
      },
    });

    await service.run('sr-group', groupPrincipal);

    const data = update.mock.calls[0][0].data;
    // Only lastRunAt stamped; nextRunAt left as the worker set it.
    expect(data.lastRunAt).toBeInstanceOf(Date);
    expect(data.nextRunAt).toBeUndefined();
  });

  it('run() enforces authorization: a non-group user cannot run a group-level report', async () => {
    const { service } = makeService({
      scheduledReport: {
        findFirst: jest.fn().mockResolvedValue(groupSchedule),
        update: jest.fn(),
      },
    });
    // companyPrincipal is NOT group-scoped => assertCanAccessCompany(null) throws.
    await expect(service.run('sr-group', companyPrincipal)).rejects.toThrow();
  });
});
