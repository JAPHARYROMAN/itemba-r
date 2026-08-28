import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import {
  CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE,
  CrudFixtureGovernanceContract,
  CrudFixtureGovernanceScope,
} from './crud-evidence-governance';
import { CrudPathReadBinding } from './crud-path-read-evidence';

/**
 * Final collection-read tranche whose request values cannot be inferred from
 * generic pagination/company metadata alone. Every value is either a reviewed
 * literal or an isolated harness binding; no route receives a random UUID.
 */
export type CrudDomainHeaderBinding = CrudPathReadBinding | 'agentSessionA';

export interface CrudDomainHeaderValue {
  binding?: CrudDomainHeaderBinding;
  literal?: string | number | boolean;
}

export interface CrudDomainHeaderArgumentBinding extends CrudDomainHeaderValue {
  name: string;
}

export type CrudDomainHeaderMutationContract =
  | { kind: 'none' }
  | {
      /** An audited read may append exactly this one attributable row. */
      kind: 'single_audit_row';
      action: string;
    };

export interface CrudDomainHeaderScopeSeedControl {
  /** Harness seed label whose id is stored under `binding`. */
  seedModel: string;
  binding: CrudDomainHeaderBinding;
  companyBinding: 'companyA' | 'companyB';
  actorBinding?: 'userA' | 'userB';
}

export type CrudDomainHeaderScopeOracle =
  | {
      /** A company-A caller must be unable to repeat the read against company B. */
      kind: 'denied_request';
      deniedCompanyBinding: 'companyB';
      queryBindings: readonly CrudDomainHeaderArgumentBinding[];
      expectedStatus: 403 | 404;
      controls: readonly CrudDomainHeaderScopeSeedControl[];
    }
  | {
      /** Exact causal seed ids must be present/absent in the successful payload. */
      kind: 'response_markers';
      scope: 'global' | 'company' | 'actor';
      presentBindings: readonly CrudDomainHeaderBinding[];
      absentBindings: readonly CrudDomainHeaderBinding[];
      controls: readonly CrudDomainHeaderScopeSeedControl[];
    };

export interface CrudDomainHeaderFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: 'positive';
  description: string;
  governance: CrudFixtureGovernanceContract;
  packId: 'domain-parameter-reads' | 'terminal-context-reads';
  expectedPath: string;
  expectedQueryParameters: readonly string[];
  queryBindings: readonly CrudDomainHeaderArgumentBinding[];
  contextHeaderBindings: readonly CrudDomainHeaderArgumentBinding[];
  /** A seeded scalar that must occur somewhere in the successful payload. */
  expectedResponseBinding?: CrudDomainHeaderBinding;
  /** Signed causal authorization/identity proof used by the release gate. */
  scopeOracle?: CrudDomainHeaderScopeOracle;
  /** Prisma models that must exist in the disposable schema before invocation. */
  seedModels: readonly string[];
  mutation: CrudDomainHeaderMutationContract;
  executionPrincipal: 'actor' | 'company' | 'group';
}

export interface CrudDomainHeaderFixturePack {
  packId: CrudDomainHeaderFixtureRegistration['packId'];
  packVersion: number;
  fixtures: readonly CrudDomainHeaderFixtureRegistration[];
}

interface CrudDomainHeaderDefinition extends Omit<
  CrudDomainHeaderFixtureRegistration,
  'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> {
  capabilityId: string;
  scope: Exclude<CrudFixtureGovernanceScope, 'not_applicable'>;
}

export type CrudDomainHeaderBlockerReason =
  | 'read_writes_audit_ledger'
  | 'device_headers_not_represented';

export interface CrudDomainHeaderBlocker {
  capabilityId: string;
  reason: CrudDomainHeaderBlockerReason;
  detail: string;
}

const binding = (
  name: string,
  value: CrudDomainHeaderBinding,
): CrudDomainHeaderArgumentBinding => ({ name, binding: value });
const literal = (
  name: string,
  value: string | number | boolean,
): CrudDomainHeaderArgumentBinding => ({ name, literal: value });
const model = (name: string): CrudDomainHeaderBinding => `model:${name}`;

const domainDefinitions: readonly CrudDomainHeaderDefinition[] = Object.freeze([
  {
    capabilityId: 'AuditLogsController.findAll',
    scope: 'company',
    expectedPath: 'audit-logs',
    expectedQueryParameters: [
      'action',
      'agentSessionId',
      'channel',
      'companyId',
      'dateFrom',
      'dateTo',
      'deviceId',
      'entityType',
      'limit',
      'mandateId',
      'page',
      'principalId',
      'principalType',
      'search',
      'severity',
      'stepId',
      'taskId',
      'userId',
    ],
    queryBindings: [
      binding('companyId', 'companyA'),
      binding('agentSessionId', 'agentSessionA'),
      literal('page', 1),
      literal('limit', 50),
    ],
    contextHeaderBindings: [],
    expectedResponseBinding: model('AuditLog'),
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'AuditLogsController.getSummary',
    scope: 'global',
    expectedPath: 'audit-logs/summary',
    expectedQueryParameters: ['dateFrom', 'dateTo'],
    queryBindings: [literal('dateFrom', '2026-01-01'), literal('dateTo', '2026-12-31')],
    contextHeaderBindings: [],
    expectedResponseBinding: model('AuditSummaryCompanyA'),
    scopeOracle: {
      kind: 'response_markers',
      scope: 'global',
      presentBindings: [model('AuditSummaryCompanyA'), model('AuditSummaryCompanyB')],
      absentBindings: [],
      controls: [
        {
          seedModel: 'AuditSummaryCompanyA',
          binding: model('AuditSummaryCompanyA'),
          companyBinding: 'companyA',
        },
        {
          seedModel: 'AuditSummaryCompanyB',
          binding: model('AuditSummaryCompanyB'),
          companyBinding: 'companyB',
        },
      ],
    },
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'BranchesController.findAll',
    scope: 'company',
    expectedPath: 'branches',
    expectedQueryParameters: ['activeOnly', 'companyId', 'divisionId'],
    queryBindings: [
      binding('companyId', 'companyA'),
      binding('divisionId', model('Division')),
      literal('activeOnly', true),
    ],
    contextHeaderBindings: [],
    expectedResponseBinding: model('Branch'),
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'BusinessLicensesController.findAll',
    scope: 'company',
    expectedPath: 'business-licenses',
    expectedQueryParameters: [
      'branchId',
      'companyId',
      'divisionId',
      'licenseType',
      'licensedBusinessUnitId',
      'limit',
      'page',
      'search',
      'status',
    ],
    queryBindings: [binding('companyId', 'companyA'), literal('page', 1), literal('limit', 50)],
    contextHeaderBindings: [],
    expectedResponseBinding: model('BusinessLicense'),
    seedModels: ['BusinessLicense'],
    mutation: { kind: 'none' },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'BusinessLicensesController.findExpiring',
    scope: 'company',
    expectedPath: 'business-licenses/expiring',
    expectedQueryParameters: ['companyId', 'daysAhead'],
    queryBindings: [binding('companyId', 'companyA'), literal('daysAhead', 36500)],
    contextHeaderBindings: [],
    expectedResponseBinding: model('BusinessLicense'),
    seedModels: ['BusinessLicense'],
    mutation: { kind: 'none' },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'ContractsController.getExpiring',
    scope: 'company',
    expectedPath: 'contracts/expiring',
    expectedQueryParameters: ['days'],
    queryBindings: [literal('days', 36500)],
    contextHeaderBindings: [],
    expectedResponseBinding: model('Contract'),
    seedModels: ['Contract'],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'CustomerStatementsController.getDetail',
    scope: 'company',
    expectedPath: 'customer-statements/detail',
    expectedQueryParameters: [],
    queryBindings: [
      binding('companyId', 'companyA'),
      binding('customerId', 'customerA'),
      literal('dateFrom', '2026-01-01'),
      literal('dateTo', '2026-12-31'),
    ],
    contextHeaderBindings: [],
    expectedResponseBinding: 'customerA',
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'DocumentsController.getExpiring',
    scope: 'company',
    expectedPath: 'documents/expiring',
    expectedQueryParameters: ['companyId', 'days'],
    queryBindings: [binding('companyId', 'companyA'), literal('days', 36500)],
    contextHeaderBindings: [],
    expectedResponseBinding: model('Document'),
    seedModels: ['Document'],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'EmployeesController.findLinkableUsers',
    scope: 'company',
    expectedPath: 'hr/employees/linkable-users',
    expectedQueryParameters: ['companyId', 'employeeId'],
    queryBindings: [binding('companyId', 'companyA')],
    contextHeaderBindings: [],
    expectedResponseBinding: model('UserB'),
    scopeOracle: {
      kind: 'denied_request',
      deniedCompanyBinding: 'companyB',
      queryBindings: [binding('companyId', 'companyB')],
      expectedStatus: 403,
      controls: [],
    },
    seedModels: ['Employee'],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'InventoryBalancesController.live',
    scope: 'company',
    expectedPath: 'inventory-balances/live',
    expectedQueryParameters: ['branchId', 'companyId', 'divisionId', 'lowThreshold', 'search'],
    queryBindings: [
      binding('companyId', 'companyA'),
      binding('divisionId', model('Division')),
      binding('branchId', model('Branch')),
    ],
    contextHeaderBindings: [],
    expectedResponseBinding: 'productA',
    scopeOracle: {
      kind: 'denied_request',
      deniedCompanyBinding: 'companyB',
      queryBindings: [binding('companyId', 'companyB')],
      expectedStatus: 403,
      controls: [],
    },
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'LoansController.getUpcomingRepayments',
    scope: 'company',
    expectedPath: 'loans/upcoming-repayments',
    expectedQueryParameters: ['days'],
    queryBindings: [literal('days', 36500)],
    contextHeaderBindings: [],
    expectedResponseBinding: model('UpcomingLoanA'),
    scopeOracle: {
      kind: 'response_markers',
      scope: 'company',
      presentBindings: [model('UpcomingLoanA')],
      absentBindings: [model('UpcomingLoanB')],
      controls: [
        {
          seedModel: 'UpcomingLoanA',
          binding: model('UpcomingLoanA'),
          companyBinding: 'companyA',
        },
        {
          seedModel: 'UpcomingLoanB',
          binding: model('UpcomingLoanB'),
          companyBinding: 'companyB',
        },
      ],
    },
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'MobileMoneyAccountsController.findByEmployee',
    scope: 'company',
    expectedPath: 'hr/mobile-money-accounts',
    expectedQueryParameters: ['employeeId'],
    queryBindings: [binding('employeeId', model('Employee'))],
    contextHeaderBindings: [],
    expectedResponseBinding: model('MobileMoneyAccount'),
    scopeOracle: {
      kind: 'denied_request',
      deniedCompanyBinding: 'companyB',
      queryBindings: [binding('employeeId', model('EmployeeB'))],
      expectedStatus: 404,
      controls: [
        {
          seedModel: 'EmployeeB',
          binding: model('EmployeeB'),
          companyBinding: 'companyB',
        },
      ],
    },
    seedModels: ['Employee', 'MobileMoneyAccount'],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'OfflineSyncController.findCheckpoints',
    scope: 'actor',
    expectedPath: 'offline-sync/checkpoints',
    expectedQueryParameters: ['deviceId'],
    queryBindings: [binding('deviceId', model('DeviceRegistration'))],
    contextHeaderBindings: [],
    expectedResponseBinding: model('SyncCheckpoint'),
    scopeOracle: {
      kind: 'response_markers',
      scope: 'actor',
      presentBindings: [model('SyncCheckpoint')],
      absentBindings: [model('ActorBCheckpoint')],
      controls: [
        {
          seedModel: 'SyncCheckpoint',
          binding: model('SyncCheckpoint'),
          companyBinding: 'companyA',
          actorBinding: 'userA',
        },
        {
          seedModel: 'ActorBCheckpoint',
          binding: model('ActorBCheckpoint'),
          companyBinding: 'companyA',
          actorBinding: 'userB',
        },
      ],
    },
    seedModels: ['DeviceRegistration', 'SyncCheckpoint'],
    mutation: { kind: 'none' },
    executionPrincipal: 'actor',
  },
  {
    capabilityId: 'ProductsController.findAll',
    scope: 'company',
    expectedPath: 'products',
    expectedQueryParameters: [],
    queryBindings: [binding('companyId', 'companyA'), literal('page', 1), literal('limit', 50)],
    contextHeaderBindings: [],
    expectedResponseBinding: 'productA',
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'TaxAnomalyDetectionController.scan',
    scope: 'company',
    expectedPath: 'tax-anomalies/scan',
    expectedQueryParameters: ['category', 'companyId', 'severity'],
    queryBindings: [binding('companyId', 'companyA'), literal('category', 'PARTY_HYGIENE')],
    contextHeaderBindings: [],
    expectedResponseBinding: 'customerA',
    scopeOracle: {
      kind: 'denied_request',
      deniedCompanyBinding: 'companyB',
      queryBindings: [binding('companyId', 'companyB')],
      expectedStatus: 403,
      controls: [],
    },
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
  {
    capabilityId: 'WcfAuditController.exposure',
    scope: 'company',
    expectedPath: 'hr/wcf-audit/exposure',
    expectedQueryParameters: ['companyId', 'fromMonth', 'toMonth', 'year'],
    queryBindings: [
      binding('companyId', 'companyA'),
      literal('year', 2026),
      literal('fromMonth', 1),
      literal('toMonth', 12),
    ],
    contextHeaderBindings: [],
    expectedResponseBinding: 'companyA',
    scopeOracle: {
      kind: 'denied_request',
      deniedCompanyBinding: 'companyB',
      queryBindings: [binding('companyId', 'companyB')],
      expectedStatus: 403,
      controls: [],
    },
    seedModels: [],
    mutation: { kind: 'none' },
    executionPrincipal: 'company',
  },
]);

const terminalDefinitions: readonly CrudDomainHeaderDefinition[] = Object.freeze([]);

/**
 * These routes require a physical terminal code plus a reusable device secret.
 * Msaidizi has no task/device-scoped trusted vault binding for those values, so
 * the HTTP headers cannot truthfully be supplied by its production invoker.
 */
export const CRUD_TERMINAL_CONTEXT_BLOCKER_CAPABILITY_IDS = Object.freeze([
  'MobilePosLiteController.catalog',
  'MobilePosLiteController.customers',
  'MobilePosLiteController.mySalesToday',
  'MobilePosLiteController.products',
  'MobilePosLiteController.purchaseHistory',
  'MobilePosLiteController.salesHistory',
  'MobilePosLiteController.session',
  'MobilePosLiteController.stock',
  'MobilePosLiteController.suppliers',
] as const);

/**
 * The Profit export was already a machine-readable query blocker before this
 * final tranche. Both Supplier-360 routes are retained here with the exact
 * method-level exclusion reason rather than being disguised as missing data:
 * the view appends one audit row, while the export appends multiple rows and
 * may also persist a generated PDF artifact.
 */
export const CRUD_DOMAIN_HEADER_REMAINING_BLOCKERS: readonly CrudDomainHeaderBlocker[] =
  Object.freeze([
    {
      capabilityId: 'DocumentsController.findByEntity',
      reason: 'read_writes_audit_ledger',
      detail:
        'The GET appends DOCUMENT_ENTITY_LIST to AuditLog and cannot satisfy a no-mutation read control.',
    },
    {
      capabilityId: 'OperationsReportsController.getSupplier360',
      reason: 'read_writes_audit_ledger',
      detail:
        'The GET unconditionally appends SUPPLIER_360_REPORT_VIEW to AuditLog and cannot satisfy a no-mutation read control.',
    },
    {
      capabilityId: 'OperationsReportsController.exportSupplier360',
      reason: 'read_writes_audit_ledger',
      detail:
        'The GET streams a file and appends Supplier-360 view/export audit rows; it cannot satisfy the isolated no-business-mutation collection-read control.',
    },
    ...CRUD_TERMINAL_CONTEXT_BLOCKER_CAPABILITY_IDS.map((capabilityId) => ({
      capabilityId,
      reason: 'device_headers_not_represented' as const,
      detail:
        'The route requires terminal/device credentials that have no task-scoped trusted production binding in Msaidizi.',
    })),
  ]);

export const CRUD_DOMAIN_HEADER_PRIOR_BLOCKER_CAPABILITY_IDS = Object.freeze([
  'ProfitController.exportReport',
] as const);

export const CRUD_DOMAIN_HEADER_TARGETS = Object.freeze(
  [
    ...domainDefinitions.map((definition) => definition.capabilityId),
    ...CRUD_DOMAIN_HEADER_REMAINING_BLOCKERS.map((blocker) => blocker.capabilityId),
    ...CRUD_DOMAIN_HEADER_PRIOR_BLOCKER_CAPABILITY_IDS,
  ].sort(),
);

/** Returns only registrations whose exact live route/header/schema contract still matches. */
export function domainHeaderEvidencePacks(
  manifest: readonly Capability[],
): readonly CrudDomainHeaderFixturePack[] {
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  return Object.freeze([
    pack('domain-parameter-reads', domainDefinitions, byId),
    pack('terminal-context-reads', terminalDefinitions, byId),
  ]);
}

function pack(
  packId: CrudDomainHeaderFixtureRegistration['packId'],
  definitions: readonly CrudDomainHeaderDefinition[],
  byId: ReadonlyMap<string, Capability>,
): CrudDomainHeaderFixturePack {
  const fixtures = definitions
    .flatMap((definition): CrudDomainHeaderFixtureRegistration[] => {
      const capability = byId.get(definition.capabilityId);
      if (!capability || !matchesDefinition(capability, definition)) return [];
      const digest = createHash('sha256').update(capability.id).digest('hex').slice(0, 12);
      const slug = capability.id
        .replace(/Controller\./g, '-')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
      return [
        Object.freeze({
          fixtureId: `${packId === 'terminal-context-reads' ? 'terminal' : 'domain'}-read-${slug}-${digest}`,
          fixtureVersion: 3,
          capabilityId: definition.capabilityId,
          controlKind: 'positive' as const,
          description:
            packId === 'terminal-context-reads'
              ? `Read ${definition.expectedPath} with the isolated terminal context supplied outside model arguments.`
              : `Read ${definition.expectedPath} with reviewed isolated domain parameters.`,
          governance: {
            scope: definition.scope,
            audit: capabilityRequiresSensitiveAccessAudit(capability)
              ? ('required' as const)
              : ('not_applicable' as const),
            ...(capabilityRequiresSensitiveAccessAudit(capability)
              ? { auditScope: CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE }
              : {}),
          },
          packId,
          expectedPath: definition.expectedPath,
          expectedQueryParameters: definition.expectedQueryParameters,
          queryBindings: definition.queryBindings,
          contextHeaderBindings: definition.contextHeaderBindings,
          ...(definition.expectedResponseBinding
            ? { expectedResponseBinding: definition.expectedResponseBinding }
            : {}),
          ...(definition.scopeOracle ? { scopeOracle: definition.scopeOracle } : {}),
          seedModels: definition.seedModels,
          mutation: capabilityRequiresSensitiveAccessAudit(capability)
            ? ({ kind: 'single_audit_row', action: 'VIEW_SENSITIVE' } as const)
            : definition.mutation,
          executionPrincipal: definition.executionPrincipal,
        }),
      ];
    })
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  return Object.freeze({ packId, packVersion: 3, fixtures: Object.freeze(fixtures) });
}

function matchesDefinition(
  capability: Capability,
  definition: CrudDomainHeaderDefinition,
): boolean {
  if (
    capability.agentExcluded ||
    capability.verb !== 'GET' ||
    (capability.permissions.length === 0 && capability.anyPermissions.length === 0) ||
    capability.path !== definition.expectedPath ||
    capability.params.path.length > 0 ||
    !sameNames(capability.params.query, definition.expectedQueryParameters) ||
    !sameNames(
      capability.params.headers ?? [],
      definition.contextHeaderBindings.map((item) => item.name),
    )
  ) {
    return false;
  }

  const suppliedQuery = definition.queryBindings.map((item) => item.name);
  if (!capability.params.freeFormQuery) {
    return suppliedQuery.every((name) => capability.params.query.includes(name));
  }

  const schema = capability.params.querySchema;
  if (!schema || schema.quality !== 'strict') return false;
  const properties = Object.keys(schema.schema.properties);
  return (
    (schema.schema.required ?? []).every((name) => suppliedQuery.includes(name)) &&
    suppliedQuery.every((name) => properties.includes(name))
  );
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

export const CRUD_DOMAIN_PARAMETER_DEFINITION_COUNT = domainDefinitions.length;
export const CRUD_TERMINAL_CONTEXT_DEFINITION_COUNT = terminalDefinitions.length;
