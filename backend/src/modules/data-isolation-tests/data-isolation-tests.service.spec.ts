import { DataIsolationTestsService } from './data-isolation-tests.service';

describe('DataIsolationTestsService mutation audit attribution', () => {
  const user = { id: 'group-user-1' } as any;

  function makeHarness() {
    const run = {
      id: 'run-1',
      runType: 'COMPANY_SCOPE',
      status: 'RUNNING',
      startedById: user.id,
    };
    const issue = { id: 'issue-1', testRunId: run.id, status: 'OPEN' };
    const prisma = {
      dataIsolationTestRun: {
        findUnique: jest.fn().mockResolvedValue(run),
        create: jest.fn().mockResolvedValue(run),
        update: jest.fn().mockResolvedValue({ ...run, status: 'PASSED' }),
      },
      dataIsolationTestIssue: {
        create: jest.fn().mockResolvedValue(issue),
      },
    } as any;
    const companyScope = { assertGroupScoped: jest.fn() } as any;
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    return {
      service: new DataIsolationTestsService(prisma, companyScope, auditLogs),
      prisma,
      auditLogs,
    };
  }

  it.each([
    ['create', 'DATA_ISOLATION_TEST_CREATED', 'DataIsolationTestRun', 'run-1'],
    ['complete', 'DATA_ISOLATION_TEST_COMPLETED', 'DataIsolationTestRun', 'run-1'],
    ['addIssue', 'DATA_ISOLATION_ISSUE_CREATED', 'DataIsolationTestIssue', 'issue-1'],
  ] as const)(
    'writes exactly one attributable row after %s succeeds',
    async (operation, action, entityType, entityId) => {
      const { service, auditLogs } = makeHarness();

      if (operation === 'create') {
        await service.create({ runType: 'COMPANY_SCOPE', totalChecks: 1 }, user);
      } else if (operation === 'complete') {
        await service.complete('run-1', { failedChecks: 0, passedChecks: 1 }, user);
      } else {
        await service.addIssue(
          'run-1',
          {
            issueType: 'MISSING_COMPANY_FILTER',
            severity: 'HIGH',
            description: 'Missing company predicate',
          },
          user,
        );
      }

      expect(auditLogs.log).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action, entityType, entityId, userId: 'group-user-1' }),
      );
    },
  );

  it('does not claim audit evidence when the isolation mutation fails', async () => {
    const { service, prisma, auditLogs } = makeHarness();
    prisma.dataIsolationTestRun.create.mockRejectedValueOnce(
      new Error('database rejected mutation'),
    );

    await expect(
      service.create({ runType: 'COMPANY_SCOPE', totalChecks: 1 }, user),
    ).rejects.toThrow('database rejected mutation');
    expect(auditLogs.log).not.toHaveBeenCalled();
  });
});
