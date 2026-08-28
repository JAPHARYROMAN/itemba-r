import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import {
  CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE,
  CrudFixtureAuditScopeContract,
  CrudFixtureGovernanceContract,
} from './crud-evidence-governance';

export type CrudRemainingReadBinding =
  | 'backupJobId'
  | 'backupRunId'
  | 'cachePermissionCount'
  | 'cachePermissionType'
  | 'dataIsolationHighCount'
  | 'dataIsolationHighSeverity'
  | 'dataIsolationRunId'
  | 'debtForeignOutstandingAmount'
  | 'debtGroupOutstandingAmount'
  | 'debtHighRiskCount'
  | 'debtOutstandingAmount'
  | 'debtOutstandingCount'
  | 'debtOverdueCount'
  | 'debtTotalAmount'
  | 'debtTotalCount'
  | 'departmentNextCode'
  | 'employeeNextCode'
  | 'intercompanyForeignId'
  | 'intercompanyId'
  | 'mobileDayReportA'
  | 'mobileDayReportB'
  | 'notificationUnreadA'
  | 'notificationUnreadB'
  | 'positionNextCode'
  | 'recordBookCashTotal'
  | 'recordBookExpenseCount'
  | 'recordBookExpensesTotal'
  | 'recordBookForeignSalesTotal'
  | 'recordBookNetMovement'
  | 'recordBookSalesCount'
  | 'recordBookSalesTotal'
  | 'returnableBalanceA'
  | 'returnableBalanceB'
  | 'returnableDepositA'
  | 'returnableQuantityA'
  | 'securityActiveSessions'
  | 'securityActiveUsers'
  | 'securityCriticalCount'
  | 'securityCriticalSeverity'
  | 'securityEventId'
  | 'securityHighCritical24h'
  | 'securityLockedAccounts'
  | 'securityOpenEvents'
  | 'securityOpenHighCritical'
  | 'securityPermissions'
  | 'securityRefreshReuse24h'
  | 'securityRoles'
  | 'securityTwoFactorProfiles'
  | 'securityUsersWithProfiles';

export interface CrudRemainingReadArgumentBinding {
  name: string;
  binding?: 'companyA';
  literal?: string | number | boolean;
}

export interface CrudRemainingReadValueClaim {
  responsePath: readonly string[];
  binding: CrudRemainingReadBinding;
}

export interface CrudRemainingReadMarkerClaim extends CrudRemainingReadValueClaim {
  match: 'contains' | 'excludes';
}

export interface CrudRemainingReadRowClaim {
  collectionPath: readonly string[];
  matchResponsePath: readonly string[];
  matchBinding: CrudRemainingReadBinding;
  values: readonly CrudRemainingReadValueClaim[];
}

export type CrudRemainingReadScopeProbe =
  | {
      kind: 'foreign_company_denied';
      argumentName: 'companyId' | 'fromCompanyId';
      expectedStatus: 403;
    }
  | {
      kind: 'company_principal_denied_group_read';
      expectedStatus: 403;
    }
  | {
      kind: 'group_principal_includes_foreign';
      presentBinding: 'mobileDayReportB';
      expectedStatus: 200;
    }
  | {
      kind: 'group_principal_value';
      claim: CrudRemainingReadValueClaim;
      expectedStatus: 200;
      auditScope: CrudFixtureAuditScopeContract;
    }
  | {
      kind: 'poster_actor_value';
      claim: CrudRemainingReadValueClaim;
      expectedStatus: 200;
    };

export interface CrudRemainingReadFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: 'positive';
  description: string;
  governance: CrudFixtureGovernanceContract;
  packId: 'remaining-deterministic-reads';
  expectedPath: string;
  expectedQueryParameters: readonly string[];
  queryBindings: readonly CrudRemainingReadArgumentBinding[];
  executionPrincipal: 'company' | 'group' | 'group_company_a';
  oracle: {
    values: readonly CrudRemainingReadValueClaim[];
    markers: readonly CrudRemainingReadMarkerClaim[];
    rows: readonly CrudRemainingReadRowClaim[];
    permissionProbe: { principal: 'restricted'; expectedStatus: 403 };
    scopeProbe?: CrudRemainingReadScopeProbe;
  };
}

export interface CrudRemainingReadFixturePack {
  packId: CrudRemainingReadFixtureRegistration['packId'];
  packVersion: number;
  fixtures: readonly CrudRemainingReadFixtureRegistration[];
}

interface Definition extends Omit<
  CrudRemainingReadFixtureRegistration,
  'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> {
  scope: 'actor' | 'company' | 'global';
}

const permissionProbe = Object.freeze({
  principal: 'restricted' as const,
  expectedStatus: 403 as const,
});
const literal = (
  name: string,
  value: string | number | boolean,
): CrudRemainingReadArgumentBinding => ({
  name,
  literal: value,
});
const company = (name = 'companyId'): CrudRemainingReadArgumentBinding => ({
  name,
  binding: 'companyA',
});
const value = (
  responsePath: readonly string[],
  binding: CrudRemainingReadBinding,
): CrudRemainingReadValueClaim => ({ responsePath, binding });
const marker = (
  responsePath: readonly string[],
  binding: CrudRemainingReadBinding,
  match: CrudRemainingReadMarkerClaim['match'] = 'contains',
): CrudRemainingReadMarkerClaim => ({ responsePath, binding, match });
const row = (
  collectionPath: readonly string[],
  matchResponsePath: readonly string[],
  matchBinding: CrudRemainingReadBinding,
  values: readonly CrudRemainingReadValueClaim[],
): CrudRemainingReadRowClaim => ({
  collectionPath,
  matchResponsePath,
  matchBinding,
  values,
});
const oracle = (input: {
  values?: readonly CrudRemainingReadValueClaim[];
  markers?: readonly CrudRemainingReadMarkerClaim[];
  rows?: readonly CrudRemainingReadRowClaim[];
  scopeProbe?: CrudRemainingReadScopeProbe;
}): Definition['oracle'] => ({
  values: input.values ?? [],
  markers: input.markers ?? [],
  rows: input.rows ?? [],
  permissionProbe,
  ...(input.scopeProbe ? { scopeProbe: input.scopeProbe } : {}),
});

const definitions: readonly Definition[] = Object.freeze([
  {
    capabilityId: 'BackupsController.dashboard',
    expectedPath: 'backups/dashboard',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group',
    scope: 'global',
    oracle: oracle({
      markers: [marker(['activeJobs'], 'backupJobId'), marker(['recentRuns'], 'backupRunId')],
      scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
    }),
  },
  {
    capabilityId: 'CacheManagementController.getStats',
    expectedPath: 'cache/stats',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group',
    scope: 'global',
    oracle: oracle({
      rows: [
        row(['byType'], ['cacheType'], 'cachePermissionType', [
          value(['count'], 'cachePermissionCount'),
        ]),
      ],
      scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
    }),
  },
  {
    capabilityId: 'DataIsolationController.getDashboard',
    expectedPath: 'data-isolation/dashboard',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group',
    scope: 'global',
    oracle: oracle({
      markers: [marker(['recentTestRuns'], 'dataIsolationRunId')],
      rows: [
        row(['openIssuesBySeverity'], ['severity'], 'dataIsolationHighSeverity', [
          value(['count'], 'dataIsolationHighCount'),
        ]),
      ],
      scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
    }),
  },
  {
    capabilityId: 'DebtsController.getSummary',
    expectedPath: 'debts/summary',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group_company_a',
    scope: 'company',
    oracle: oracle({
      values: [
        value(['totalCount'], 'debtTotalCount'),
        value(['outstandingCount'], 'debtOutstandingCount'),
        value(['overdueCount'], 'debtOverdueCount'),
        value(['highRiskCount'], 'debtHighRiskCount'),
        value(['totalAmount'], 'debtTotalAmount'),
        value(['totalOutstandingAmount'], 'debtOutstandingAmount'),
      ],
      markers: [marker([], 'debtForeignOutstandingAmount', 'excludes')],
      scopeProbe: {
        kind: 'group_principal_value',
        claim: value(['totalOutstandingAmount'], 'debtGroupOutstandingAmount'),
        expectedStatus: 200,
        auditScope: {
          scopeKind: 'MULTI_COMPANY',
          attributionStatus: 'EXPLICIT',
          companyScopeBindings: ['companyA', 'companyB', 'adminOperationsCompany'],
        },
      },
    }),
  },
  ...[
    [
      'DepartmentsController.nextCode',
      'hr/departments/next-code',
      'departmentNextCode',
      ['departmentCode'],
    ],
    [
      'EmployeesController.nextCode',
      'hr/employees/next-code',
      'employeeNextCode',
      ['employeeCode'],
    ],
    ['PositionsController.nextCode', 'hr/positions/next-code', 'positionNextCode', []],
  ].map(
    ([capabilityId, expectedPath, binding, responsePath]): Definition => ({
      capabilityId: capabilityId as string,
      expectedPath: expectedPath as string,
      expectedQueryParameters: ['companyId'],
      queryBindings: [company()],
      executionPrincipal: 'company',
      scope: 'company',
      oracle: oracle({
        values: [value(responsePath as readonly string[], binding as CrudRemainingReadBinding)],
        scopeProbe: {
          kind: 'foreign_company_denied',
          argumentName: 'companyId',
          expectedStatus: 403,
        },
      }),
    }),
  ),
  {
    capabilityId: 'IntercompanyTransactionsController.findAll',
    expectedPath: 'intercompany-transactions',
    expectedQueryParameters: ['fromCompanyId', 'limit', 'page', 'status', 'toCompanyId', 'type'],
    queryBindings: [company('fromCompanyId'), literal('page', 1), literal('limit', 5000)],
    executionPrincipal: 'company',
    scope: 'company',
    oracle: oracle({
      markers: [
        marker(['data'], 'intercompanyId'),
        marker(['data'], 'intercompanyForeignId', 'excludes'),
      ],
      scopeProbe: {
        kind: 'foreign_company_denied',
        argumentName: 'fromCompanyId',
        expectedStatus: 403,
      },
    }),
  },
  {
    capabilityId: 'MobilePosLiteController.dayReports',
    expectedPath: 'mobile-pos-lite/day-reports',
    expectedQueryParameters: ['from', 'terminalId', 'to'],
    queryBindings: [],
    executionPrincipal: 'group_company_a',
    scope: 'company',
    oracle: oracle({
      markers: [marker([], 'mobileDayReportA'), marker([], 'mobileDayReportB', 'excludes')],
      scopeProbe: {
        kind: 'group_principal_includes_foreign',
        presentBinding: 'mobileDayReportB',
        expectedStatus: 200,
      },
    }),
  },
  {
    capabilityId: 'NotificationsController.getUnreadCount',
    expectedPath: 'notifications/unread-count',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'company',
    scope: 'actor',
    oracle: oracle({
      values: [value(['count'], 'notificationUnreadA')],
      scopeProbe: {
        kind: 'poster_actor_value',
        claim: value(['count'], 'notificationUnreadB'),
        expectedStatus: 200,
      },
    }),
  },
  {
    capabilityId: 'RecordBookController.summary',
    expectedPath: 'record-book/summary',
    expectedQueryParameters: [
      'branchId',
      'companyId',
      'currency',
      'dateFrom',
      'dateTo',
      'divisionId',
      'expenseCategoryId',
      'limit',
      'page',
      'paymentMethod',
      'receiptType',
      'recordState',
      'search',
      'status',
    ],
    queryBindings: [company(), literal('currency', 'GBP'), literal('status', 'FINALIZED')],
    executionPrincipal: 'company',
    scope: 'company',
    oracle: oracle({
      values: [
        value(['totalRecordedSales'], 'recordBookSalesTotal'),
        value(['cashTotal'], 'recordBookCashTotal'),
        value(['expensesTotal'], 'recordBookExpensesTotal'),
        value(['netMovement'], 'recordBookNetMovement'),
        value(['salesCount'], 'recordBookSalesCount'),
        value(['expenseCount'], 'recordBookExpenseCount'),
      ],
      markers: [marker([], 'recordBookForeignSalesTotal', 'excludes')],
      scopeProbe: {
        kind: 'foreign_company_denied',
        argumentName: 'companyId',
        expectedStatus: 403,
      },
    }),
  },
  {
    capabilityId: 'ReturnablePackagesController.getBalances',
    expectedPath: 'westsides/returnable-packages/balances',
    expectedQueryParameters: ['companyId', 'limit', 'packageType', 'page', 'status'],
    queryBindings: [company(), literal('page', 1), literal('limit', 5000)],
    executionPrincipal: 'company',
    scope: 'company',
    oracle: oracle({
      markers: [marker(['data'], 'returnableBalanceB', 'excludes')],
      rows: [
        row(['data'], ['id'], 'returnableBalanceA', [
          value(['quantityOwedByCustomer'], 'returnableQuantityA'),
          value(['depositBalance'], 'returnableDepositA'),
        ]),
      ],
      scopeProbe: {
        kind: 'foreign_company_denied',
        argumentName: 'companyId',
        expectedStatus: 403,
      },
    }),
  },
  {
    capabilityId: 'SecurityController.dashboard',
    expectedPath: 'security/dashboard',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group',
    scope: 'global',
    oracle: oracle({
      values: [
        value(['activeSessionsCount'], 'securityActiveSessions'),
        value(['lockedAccountsCount'], 'securityLockedAccounts'),
        value(['readiness', 'indicators', 'openHighCriticalEvents'], 'securityOpenHighCritical'),
      ],
      markers: [marker(['recentCriticalEvents'], 'securityEventId')],
      rows: [
        row(['eventsBySeverity'], ['severity'], 'securityCriticalSeverity', [
          value(['_count', 'id'], 'securityCriticalCount'),
        ]),
      ],
      scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
    }),
  },
  {
    capabilityId: 'SecurityController.readiness',
    expectedPath: 'security/readiness',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group',
    scope: 'global',
    oracle: oracle({
      values: [
        value(['indicators', 'activeUsers'], 'securityActiveUsers'),
        value(['indicators', 'usersWithSecurityProfiles'], 'securityUsersWithProfiles'),
        value(['indicators', 'twoFactorEnabledUsers'], 'securityTwoFactorProfiles'),
        value(['indicators', 'activeSessions'], 'securityActiveSessions'),
        value(['indicators', 'roles'], 'securityRoles'),
        value(['indicators', 'permissions'], 'securityPermissions'),
        value(['indicators', 'openHighCriticalEvents'], 'securityOpenHighCritical'),
        value(['indicators', 'highCriticalEvents24h'], 'securityHighCritical24h'),
        value(['indicators', 'refreshReuseEvents24h'], 'securityRefreshReuse24h'),
      ],
      scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
    }),
  },
  {
    capabilityId: 'SecurityController.summary',
    expectedPath: 'security/summary',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'group',
    scope: 'global',
    oracle: oracle({
      values: [
        value(['activeSessionsCount'], 'securityActiveSessions'),
        value(['lockedAccountsCount'], 'securityLockedAccounts'),
        value(['openEventsCount'], 'securityOpenEvents'),
      ],
      scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
    }),
  },
]);

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function capabilityMatches(
  capability: Capability | undefined,
  definition: Definition,
): capability is Capability {
  if (!capability || capability.agentExcluded || capability.verb !== 'GET') return false;
  if (capability.path !== definition.expectedPath || capability.params.path.length > 0)
    return false;
  if (capability.permissions.length === 0 && capability.anyPermissions.length === 0) return false;

  const querySchema = capability.params.querySchema;
  const actualQuery = querySchema
    ? Object.keys(querySchema.schema.properties)
    : capability.params.query;
  if (definition.expectedQueryParameters.length === 0) {
    if (capability.params.freeFormQuery || querySchema || capability.params.query.length > 0)
      return false;
  } else if (
    !sameNames(actualQuery, definition.expectedQueryParameters) ||
    (querySchema
      ? querySchema.quality !== 'strict' || querySchema.schema.additionalProperties !== false
      : capability.params.freeFormQuery || capability.params.query.length === 0)
  ) {
    return false;
  }

  const bound = definition.queryBindings.map((item) => item.name);
  return (
    new Set(bound).size === bound.length &&
    bound.every((name) => definition.expectedQueryParameters.includes(name)) &&
    definition.queryBindings.every(
      (item) => (item.binding === 'companyA') !== (item.literal !== undefined),
    )
  );
}

export function remainingReadEvidencePack(
  manifest: readonly Capability[],
): CrudRemainingReadFixturePack {
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = definitions.flatMap((definition): CrudRemainingReadFixtureRegistration[] => {
    const capability = byId.get(definition.capabilityId);
    if (!capabilityMatches(capability, definition)) return [];
    const audited = capabilityRequiresSensitiveAccessAudit(capability);
    const slug = definition.capabilityId
      .replace(/Controller\./g, '-')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const hash = createHash('sha256').update(definition.capabilityId).digest('hex').slice(0, 12);
    return [
      Object.freeze({
        fixtureId: `remaining-read-${slug}-${hash}`,
        fixtureVersion: 1,
        capabilityId: definition.capabilityId,
        controlKind: 'positive' as const,
        description: `Reconcile ${definition.capabilityId} to its exact governed source state.`,
        governance: {
          scope: definition.scope,
          audit: audited ? ('required' as const) : ('not_applicable' as const),
          ...(audited ? { auditScope: CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE } : {}),
        },
        packId: 'remaining-deterministic-reads' as const,
        expectedPath: definition.expectedPath,
        expectedQueryParameters: definition.expectedQueryParameters,
        queryBindings: definition.queryBindings,
        executionPrincipal: definition.executionPrincipal,
        oracle: definition.oracle,
      }),
    ];
  });
  return Object.freeze({
    packId: 'remaining-deterministic-reads',
    packVersion: 1,
    fixtures: Object.freeze(fixtures.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))),
  });
}

export const CRUD_REMAINING_READ_REVIEWED_DEFINITION_COUNT = definitions.length;
