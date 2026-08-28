import { AuditScopeKind, DataIsolationIssueStatus } from '@prisma/client';
import { BackupJobsService } from '../backup-jobs/backup-jobs.service';
import { StatutoryDeductionRulesService } from '../compliance/statutory-deduction-rules/statutory-deduction-rules.service';
import { DataIsolationIssuesService } from '../data-isolation-issues/data-isolation-issues.service';
import { DataIsolationTestsService } from '../data-isolation-tests/data-isolation-tests.service';
import { IntegrationProvidersService } from '../integration-providers/integration-providers.service';
import { TaxAuthoritiesService } from '../tax/tax-authorities/tax-authorities.service';
import { TaxTypesService } from '../tax/tax-types/tax-types.service';
import { UserDashboardPreferencesService } from '../user-dashboard-preferences/user-dashboard-preferences.service';

type ExpectedGlobalAudit = readonly [action: string, entityType: string, entityId: string];

function auditHarness() {
  const log = jest.fn().mockResolvedValue(undefined);
  return {
    log,
    logStrictInTransaction: jest
      .fn()
      .mockImplementation(async (_tx: unknown, input: unknown) => log(input)),
  };
}

function expectExplicitGlobalAudits(
  audit: ReturnType<typeof auditHarness>,
  expected: readonly ExpectedGlobalAudit[],
): void {
  expect(
    audit.log.mock.calls.map(([input]) => ({
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      scopeKind: input.scopeKind,
      companyScopeIds: input.companyScopeIds,
    })),
  ).toEqual(
    expected.map(([action, entityType, entityId]) => ({
      action,
      entityType,
      entityId,
      scopeKind: AuditScopeKind.GLOBAL,
      companyScopeIds: [],
    })),
  );
}

describe('mutation audit scope callers', () => {
  it('snapshots backup job mutations as explicitly global', async () => {
    const existing = {
      id: 'backup-1',
      schedule: 'MANUAL',
      scheduleConfig: {},
      deletedAt: null,
    };
    const prisma = {
      backupJob: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'backup-1', ...data })),
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...existing, ...data })),
      },
    } as never;
    const audit = auditHarness();
    const service = new BackupJobsService(prisma, audit as never);

    await service.create(
      {
        name: 'Global backup',
        backupType: 'DATABASE',
        storageTarget: 'LOCAL',
      } as never,
      'user-1',
    );
    await service.update('backup-1', { name: 'Renamed backup' }, 'user-1');
    await service.remove('backup-1', 'user-1');

    expectExplicitGlobalAudits(audit, [
      ['BACKUP_JOB_CREATED', 'BackupJob', 'backup-1'],
      ['BACKUP_JOB_UPDATED', 'BackupJob', 'backup-1'],
      ['BACKUP_JOB_DELETED', 'BackupJob', 'backup-1'],
    ]);
  });

  it('keeps group authorization and snapshots data-isolation mutations as global', async () => {
    const user = { id: 'group-user' };
    const run = {
      id: 'run-1',
      runType: 'COMPANY_SCOPE',
      status: 'RUNNING',
      startedById: user.id,
    };
    const prisma = {
      dataIsolationTestRun: {
        findUnique: jest.fn().mockResolvedValue(run),
        create: jest.fn().mockResolvedValue(run),
        update: jest.fn().mockResolvedValue({ ...run, status: 'PASSED' }),
      },
      dataIsolationTestIssue: {
        create: jest.fn().mockResolvedValue({ id: 'issue-1', testRunId: run.id, status: 'OPEN' }),
      },
    } as never;
    const companyScope = { assertGroupScoped: jest.fn() };
    const audit = auditHarness();
    const service = new DataIsolationTestsService(prisma, companyScope as never, audit as never);

    await service.create({ runType: 'COMPANY_SCOPE', totalChecks: 1 } as never, user as never);
    await service.complete('run-1', { failedChecks: 0, passedChecks: 1 }, user as never);
    await service.addIssue(
      'run-1',
      {
        issueType: 'MISSING_COMPANY_FILTER',
        severity: 'HIGH',
        description: 'Missing company predicate',
      } as never,
      user as never,
    );

    expect(companyScope.assertGroupScoped).toHaveBeenCalledTimes(3);
    expectExplicitGlobalAudits(audit, [
      ['DATA_ISOLATION_TEST_CREATED', 'DataIsolationTestRun', 'run-1'],
      ['DATA_ISOLATION_TEST_COMPLETED', 'DataIsolationTestRun', 'run-1'],
      ['DATA_ISOLATION_ISSUE_CREATED', 'DataIsolationTestIssue', 'issue-1'],
    ]);
  });

  it('keeps group authorization and snapshots every isolation issue transition as global', async () => {
    const user = { id: 'group-user' };
    const prisma = {
      dataIsolationTestIssue: {
        findUnique: jest.fn().mockResolvedValue({ id: 'issue-1', status: 'OPEN' }),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'issue-1', ...data })),
      },
    } as never;
    const companyScope = { assertGroupScoped: jest.fn() };
    const audit = auditHarness();
    const service = new DataIsolationIssuesService(prisma, audit as never, companyScope as never);

    await service.setStatus('issue-1', DataIsolationIssueStatus.ACKNOWLEDGED, user as never);
    await service.setStatus('issue-1', DataIsolationIssueStatus.RESOLVED, user as never);
    await service.setStatus('issue-1', DataIsolationIssueStatus.DISMISSED, user as never);

    // setStatus and its findOne lookup both retain the existing group-role check.
    expect(companyScope.assertGroupScoped).toHaveBeenCalledTimes(6);
    expectExplicitGlobalAudits(audit, [
      ['DATA_ISOLATION_ISSUE_ACKNOWLEDGED', 'DataIsolationTestIssue', 'issue-1'],
      ['DATA_ISOLATION_ISSUE_RESOLVED', 'DataIsolationTestIssue', 'issue-1'],
      ['DATA_ISOLATION_ISSUE_DISMISSED', 'DataIsolationTestIssue', 'issue-1'],
    ]);
  });

  it('snapshots integration provider mutations as explicitly global', async () => {
    const existing = { id: 'provider-1', providerCode: 'GLOBAL', deletedAt: null };
    const prisma = {
      integrationProvider: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...existing, ...data })),
      },
    } as never;
    const audit = auditHarness();
    const service = new IntegrationProvidersService(prisma, audit as never);

    await service.create(
      { providerCode: 'GLOBAL', name: 'Global provider', providerType: 'OTHER' } as never,
      'user-1',
    );
    await service.update('provider-1', { name: 'Renamed provider' }, 'user-1');
    await service.remove('provider-1', 'user-1');

    expectExplicitGlobalAudits(audit, [
      ['INTEGRATION_PROVIDER_CREATED', 'IntegrationProvider', 'provider-1'],
      ['INTEGRATION_PROVIDER_UPDATED', 'IntegrationProvider', 'provider-1'],
      ['INTEGRATION_PROVIDER_DELETED', 'IntegrationProvider', 'provider-1'],
    ]);
  });

  it('snapshots tax authority mutations as explicitly global', async () => {
    const existing = { id: 'authority-1', authorityCode: 'TRA', deletedAt: null };
    const prisma = {
      taxAuthority: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...existing, ...data })),
      },
    } as never;
    const audit = auditHarness();
    const service = new TaxAuthoritiesService(prisma, audit as never);

    await service.create({ authorityCode: 'TRA', name: 'TRA', country: 'TZ' } as never, {
      id: 'user-1',
    });
    await service.update('authority-1', { name: 'TRA updated' }, { id: 'user-1' });
    await service.remove('authority-1', { id: 'user-1' });

    expectExplicitGlobalAudits(audit, [
      ['CREATE', 'TaxAuthority', 'authority-1'],
      ['UPDATE', 'TaxAuthority', 'authority-1'],
      ['DELETE', 'TaxAuthority', 'authority-1'],
    ]);
  });

  it('snapshots tax type mutations as explicitly global', async () => {
    const existing = { id: 'tax-type-1', taxTypeCode: 'VAT', deletedAt: null };
    const prisma = {
      taxType: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...existing, ...data })),
      },
    } as never;
    const audit = auditHarness();
    const service = new TaxTypesService(prisma, audit as never);

    await service.create({ taxTypeCode: 'VAT', name: 'VAT' } as never, { id: 'user-1' });
    await service.update('tax-type-1', { name: 'VAT updated' }, { id: 'user-1' });
    await service.remove('tax-type-1', { id: 'user-1' });

    expectExplicitGlobalAudits(audit, [
      ['CREATE', 'TaxType', 'tax-type-1'],
      ['UPDATE', 'TaxType', 'tax-type-1'],
      ['DELETE', 'TaxType', 'tax-type-1'],
    ]);
  });

  it('snapshots the user dashboard default mutation as explicitly global', async () => {
    const preference = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 'preference-1', isDefault: true }),
    };
    const prisma = {
      userDashboardPreference: preference,
      $transaction: jest.fn(async (work: (tx: unknown) => unknown) =>
        work({ userDashboardPreference: preference, $queryRaw: jest.fn().mockResolvedValue([]) }),
      ),
    } as never;
    const audit = auditHarness();
    const service = new UserDashboardPreferencesService(prisma, audit as never);

    await service.setDefault('dashboard-1', { id: 'user-1' });

    expectExplicitGlobalAudits(audit, [['UPDATE', 'UserDashboardPreference', 'preference-1']]);
  });

  it('snapshots the user dashboard preference upsert as explicitly global', async () => {
    const preference = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 'preference-1', isDefault: false }),
    };
    const prisma = {
      userDashboardPreference: preference,
      $transaction: jest.fn(async (work: (tx: unknown) => unknown) =>
        work({ userDashboardPreference: preference, $queryRaw: jest.fn().mockResolvedValue([]) }),
      ),
    } as never;
    const audit = auditHarness();
    const service = new UserDashboardPreferencesService(prisma, audit as never);

    await service.upsert('dashboard-1', { isDefault: false }, { id: 'user-1' });

    expectExplicitGlobalAudits(audit, [['UPSERT', 'UserDashboardPreference', 'preference-1']]);
  });

  it('snapshots the affected company when creating a company statutory rule', async () => {
    const prisma = {
      statutoryDeductionRule: {
        create: jest.fn().mockResolvedValue({ id: 'rule-1', companyId: 'company-1' }),
      },
    } as never;
    const audit = auditHarness();
    const service = new StatutoryDeductionRulesService(prisma, audit as never);

    await service.create(
      {
        ruleCode: 'PAYE',
        companyId: 'company-1',
        name: 'PAYE',
        effectiveFrom: '2031-01-01T00:00:00.000Z',
      } as never,
      { id: 'user-1' },
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'StatutoryDeductionRule',
        entityId: 'rule-1',
        scopeKind: AuditScopeKind.COMPANY,
        companyScopeIds: ['company-1'],
      }),
    );
  });

  it('keeps a genuinely global statutory rule explicitly global', async () => {
    const prisma = {
      statutoryDeductionRule: {
        create: jest.fn().mockResolvedValue({ id: 'rule-global', companyId: null }),
      },
    } as never;
    const audit = auditHarness();
    const service = new StatutoryDeductionRulesService(prisma, audit as never);

    await service.create(
      {
        ruleCode: 'GLOBAL-PAYE',
        name: 'Global PAYE',
        effectiveFrom: '2031-01-01T00:00:00.000Z',
      } as never,
      { id: 'group-user' },
    );

    expectExplicitGlobalAudits(audit, [['CREATE', 'StatutoryDeductionRule', 'rule-global']]);
  });
});
