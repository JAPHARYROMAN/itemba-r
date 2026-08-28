import { CRUD_MUTATION_AM_EVIDENCE_PACKS } from './crud-mutation-am-evidence';
import { CrudMutationAnyFixtureRegistration } from './crud-mutation-evidence';
import { CRUD_MUTATION_NS_EVIDENCE_PACKS } from './crud-mutation-ns-evidence';
import { CRUD_MUTATION_TZ_EVIDENCE_PACKS } from './crud-mutation-tz-evidence';

const COMPANY_A_CAPABILITIES = Object.freeze([
  'ApprovalRequestsController.addComment',
  'ApprovalStepsController.create',
  'ApprovalStepsController.update',
  'AuditEvidencePacksController.addItem',
  'BankAccountsController.create',
  'BankAccountsController.update',
  'BankAccountsController.remove',
  'BankReconciliationsController.addLine',
  'BranchesController.create',
  'BranchesController.update',
  'BranchesController.remove',
  'CustomerSegmentsController.addMember',
  'MobileMoneyAccountsController.create',
  'MobileMoneyAccountsController.update',
  'UserSecurityProfilesController.create',
  'UserSecurityProfilesController.update',
  'OfflineSyncController.resolveConflict',
  'PostingRulesController.addLine',
  'PriceListsController.addItem',
  'PriceListsController.updateItem',
] as const);

const BILATERAL_CAPABILITIES = Object.freeze([
  'IntercompanyTransactionsController.create',
  'IntercompanyTransactionsController.update',
  'IntercompanyTransactionsController.submit',
  'IntercompanyTransactionsController.approve',
  'IntercompanyTransactionsController.reject',
  'IntercompanyTransactionsController.remove',
] as const);

const GLOBAL_CAPABILITIES = Object.freeze([
  'BackupJobsController.create',
  'BackupJobsController.update',
  'BackupJobsController.remove',
  'DataIsolationTestsController.create',
  'DataIsolationTestsController.complete',
  'DataIsolationTestsController.addIssue',
  'DataIsolationIssuesController.acknowledge',
  'DataIsolationIssuesController.resolve',
  'DataIsolationIssuesController.dismiss',
  'IntegrationProvidersController.create',
  'IntegrationProvidersController.update',
  'IntegrationProvidersController.remove',
  'JobQueueConfigsController.create',
  'JobQueueConfigsController.update',
  'JobQueueConfigsController.activate',
  'JobQueueConfigsController.deactivate',
  'PermissionsController.create',
  'RolesController.create',
  'RolesController.update',
  'StatutoryDeductionRulesController.create',
  'TaxAuthoritiesController.create',
  'TaxAuthoritiesController.update',
  'TaxAuthoritiesController.remove',
  'TaxTypesController.create',
  'TaxTypesController.update',
  'TaxTypesController.remove',
  'UserDashboardPreferencesController.setDefault',
] as const);

function fixtureByCapability(): Map<string, CrudMutationAnyFixtureRegistration> {
  const fixtures = [
    ...CRUD_MUTATION_AM_EVIDENCE_PACKS,
    ...CRUD_MUTATION_NS_EVIDENCE_PACKS,
    ...CRUD_MUTATION_TZ_EVIDENCE_PACKS,
  ].flatMap((pack) => pack.fixtures);
  return new Map(fixtures.map((fixture) => [fixture.capabilityId, fixture]));
}

describe('CRUD mutation audit company classification', () => {
  const fixtures = fixtureByCapability();
  const reviewed = [...COMPANY_A_CAPABILITIES, ...BILATERAL_CAPABILITIES, ...GLOBAL_CAPABILITIES];

  it('keeps the reviewed classification exhaustive and non-overlapping', () => {
    expect(COMPANY_A_CAPABILITIES).toHaveLength(20);
    expect(BILATERAL_CAPABILITIES).toHaveLength(6);
    expect(GLOBAL_CAPABILITIES).toHaveLength(27);
    expect(new Set(reviewed).size).toBe(53);
    expect(reviewed.filter((capabilityId) => !fixtures.has(capabilityId))).toEqual([]);
  });

  it.each(COMPANY_A_CAPABILITIES)('%s binds the exact affected company', (capabilityId) => {
    expect(fixtures.get(capabilityId)?.audit.companyId).toEqual({
      kind: 'exact',
      value: { binding: 'companyA' },
    });
  });

  it.each(BILATERAL_CAPABILITIES)('%s binds the exact two-company audit scope', (capabilityId) => {
    expect(fixtures.get(capabilityId)?.audit).toEqual(
      expect.objectContaining({
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'MULTI_COMPANY',
        companyScopeBindings: ['companyA', 'companyB'],
        attributionStatus: 'EXPLICIT',
      }),
    );
  });

  it.each(GLOBAL_CAPABILITIES)('%s remains explicitly global', (capabilityId) => {
    expect(fixtures.get(capabilityId)?.audit.companyId).toEqual({
      kind: 'exact',
      value: { literal: null },
    });
  });

  it('leaves no reviewed indirect or global fixture on effect-company inference', () => {
    expect(
      reviewed.filter(
        (capabilityId) => fixtures.get(capabilityId)?.audit.companyId.kind === 'effect-company',
      ),
    ).toEqual([]);
  });
});
