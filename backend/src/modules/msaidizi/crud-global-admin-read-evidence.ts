import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import { CrudFixtureGovernanceContract } from './crud-evidence-governance';

export type CrudGlobalAdminReadBinding =
  | 'auditEntityTypeA'
  | 'auditEntityTypeB'
  | 'backupJob'
  | 'backupRun'
  | 'dataIsolationIssue'
  | 'dataIsolationTestRun'
  | 'integrationProvider'
  | 'jobQueueConfig'
  | 'permission'
  | 'role'
  | 'taxAuthority'
  | 'taxType'
  | 'userSecurityProfileA'
  | 'userSecurityProfileB';

export interface CrudGlobalAdminReadArgumentBinding {
  name: string;
  binding?: 'companyA';
  literal?: string | number | boolean;
}

export type CrudGlobalAdminReadScopeProbe =
  | {
      kind: 'company_principal_denied_group_read';
      expectedStatus: 403;
    }
  | {
      kind: 'foreign_company_denied';
      deniedCompanyBinding: 'companyB';
      expectedStatus: 403;
    };

export interface CrudGlobalAdminReadFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: 'positive';
  description: string;
  governance: CrudFixtureGovernanceContract;
  packId: 'global-admin-deterministic-reads';
  expectedPath: string;
  expectedQueryParameters: readonly string[];
  queryBindings: readonly CrudGlobalAdminReadArgumentBinding[];
  executionPrincipal: 'company' | 'group';
  seedScenario: 'global-admin-records-v1' | 'company-bound-admin-records-v1';
  oracle: {
    presentBinding: CrudGlobalAdminReadBinding;
    absentBinding?: CrudGlobalAdminReadBinding;
    permissionProbe: {
      principal: 'restricted';
      expectedStatus: 403;
    };
    scopeProbe?: CrudGlobalAdminReadScopeProbe;
  };
}

export interface CrudGlobalAdminReadFixturePack {
  packId: CrudGlobalAdminReadFixtureRegistration['packId'];
  packVersion: number;
  fixtures: readonly CrudGlobalAdminReadFixtureRegistration[];
}

interface CrudGlobalAdminReadDefinition extends Omit<
  CrudGlobalAdminReadFixtureRegistration,
  'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> {
  scope: 'company' | 'global';
}

const BACKUP_JOB_QUERY = Object.freeze([
  'backupType',
  'limit',
  'page',
  'schedule',
  'status',
] as const);
const BACKUP_RUN_QUERY = Object.freeze([
  'backupJobId',
  'backupType',
  'limit',
  'page',
  'status',
] as const);
const DATA_ISOLATION_ISSUE_QUERY = Object.freeze([
  'issueType',
  'page',
  'pageSize',
  'severity',
  'status',
] as const);
const DATA_ISOLATION_TEST_QUERY = Object.freeze(['page', 'pageSize', 'runType', 'status'] as const);
const INTEGRATION_PROVIDER_QUERY = Object.freeze([
  'limit',
  'page',
  'providerType',
  'search',
  'status',
] as const);
const TAX_AUTHORITY_QUERY = Object.freeze([
  'authorityType',
  'country',
  'limit',
  'page',
  'search',
  'status',
] as const);
const TAX_TYPE_QUERY = Object.freeze(['limit', 'page', 'search', 'status', 'taxCategory'] as const);
const USER_SECURITY_PROFILE_QUERY = Object.freeze([
  'companyId',
  'limit',
  'page',
  'securityRiskLevel',
  'twoFactorEnabled',
  'userId',
] as const);

const permissionProbe = Object.freeze({
  principal: 'restricted' as const,
  expectedStatus: 403 as const,
});

const literal = (
  name: string,
  value: string | number | boolean,
): CrudGlobalAdminReadArgumentBinding => ({ name, literal: value });

const globalRecord = (
  capabilityId: string,
  expectedPath: string,
  presentBinding: CrudGlobalAdminReadBinding,
  input: {
    expectedQueryParameters?: readonly string[];
    queryBindings?: readonly CrudGlobalAdminReadArgumentBinding[];
    executionPrincipal?: 'company' | 'group';
    scopeProbe?: CrudGlobalAdminReadScopeProbe;
  } = {},
): CrudGlobalAdminReadDefinition => ({
  capabilityId,
  expectedPath,
  expectedQueryParameters: input.expectedQueryParameters ?? [],
  queryBindings: input.queryBindings ?? [],
  executionPrincipal: input.executionPrincipal ?? 'company',
  seedScenario: 'global-admin-records-v1',
  scope: 'global',
  oracle: {
    presentBinding,
    permissionProbe,
    ...(input.scopeProbe ? { scopeProbe: input.scopeProbe } : {}),
  },
});

const definitions: readonly CrudGlobalAdminReadDefinition[] = Object.freeze([
  globalRecord('BackupJobsController.findAll', 'backup-jobs', 'backupJob', {
    expectedQueryParameters: BACKUP_JOB_QUERY,
    queryBindings: [literal('page', 1), literal('limit', 20)],
  }),
  globalRecord('BackupRunsController.findAll', 'backup-runs', 'backupRun', {
    expectedQueryParameters: BACKUP_RUN_QUERY,
    queryBindings: [literal('page', 1), literal('limit', 20)],
  }),
  globalRecord(
    'DataIsolationIssuesController.findAll',
    'data-isolation-issues',
    'dataIsolationIssue',
    {
      expectedQueryParameters: DATA_ISOLATION_ISSUE_QUERY,
      queryBindings: [literal('page', 1), literal('pageSize', 20)],
      executionPrincipal: 'group',
      scopeProbe: {
        kind: 'company_principal_denied_group_read',
        expectedStatus: 403,
      },
    },
  ),
  globalRecord(
    'DataIsolationTestsController.findAll',
    'data-isolation-tests',
    'dataIsolationTestRun',
    {
      expectedQueryParameters: DATA_ISOLATION_TEST_QUERY,
      queryBindings: [literal('page', 1), literal('pageSize', 20)],
      executionPrincipal: 'group',
      scopeProbe: {
        kind: 'company_principal_denied_group_read',
        expectedStatus: 403,
      },
    },
  ),
  globalRecord(
    'IntegrationProvidersController.findAll',
    'integration-providers',
    'integrationProvider',
    {
      expectedQueryParameters: INTEGRATION_PROVIDER_QUERY,
      queryBindings: [literal('page', 1), literal('limit', 20)],
    },
  ),
  globalRecord('JobQueueConfigsController.findAll', 'job-queue-configs', 'jobQueueConfig'),
  globalRecord('PermissionsController.findAll', 'permissions', 'permission'),
  globalRecord('RolesController.findAll', 'roles', 'role'),
  globalRecord('TaxAuthoritiesController.findAll', 'tax/authorities', 'taxAuthority', {
    expectedQueryParameters: TAX_AUTHORITY_QUERY,
    queryBindings: [literal('page', 1), literal('limit', 20)],
  }),
  globalRecord('TaxTypesController.findAll', 'tax/types', 'taxType', {
    expectedQueryParameters: TAX_TYPE_QUERY,
    queryBindings: [literal('page', 1), literal('limit', 20)],
  }),
  {
    capabilityId: 'AuditLogsController.getEntityTypes',
    expectedPath: 'audit-logs/entity-types',
    expectedQueryParameters: [],
    queryBindings: [],
    executionPrincipal: 'company',
    seedScenario: 'company-bound-admin-records-v1',
    scope: 'company',
    oracle: {
      presentBinding: 'auditEntityTypeA',
      absentBinding: 'auditEntityTypeB',
      permissionProbe,
    },
  },
  {
    capabilityId: 'UserSecurityProfilesController.findAll',
    expectedPath: 'user-security-profiles',
    expectedQueryParameters: USER_SECURITY_PROFILE_QUERY,
    queryBindings: [
      { name: 'companyId', binding: 'companyA' },
      literal('page', 1),
      literal('limit', 20),
    ],
    executionPrincipal: 'company',
    seedScenario: 'company-bound-admin-records-v1',
    scope: 'company',
    oracle: {
      presentBinding: 'userSecurityProfileA',
      absentBinding: 'userSecurityProfileB',
      permissionProbe,
      scopeProbe: {
        kind: 'foreign_company_denied',
        deniedCompanyBinding: 'companyB',
        expectedStatus: 403,
      },
    },
  },
]);

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((value, index) => value === sortedExpected[index])
  );
}

function capabilityMatchesDefinition(
  capability: Capability | undefined,
  definition: CrudGlobalAdminReadDefinition,
): capability is Capability {
  if (!capability || capability.agentExcluded || capability.verb !== 'GET') return false;
  if (capability.path !== definition.expectedPath || capability.params.path.length > 0) {
    return false;
  }
  if (capability.permissions.length === 0 && capability.anyPermissions.length === 0) return false;

  const querySchema = capability.params.querySchema;
  const actualQueryParameters = querySchema
    ? Object.keys(querySchema.schema.properties)
    : capability.params.query;
  if (definition.expectedQueryParameters.length === 0) {
    if (capability.params.query.length > 0 || capability.params.freeFormQuery || querySchema) {
      return false;
    }
  } else {
    const closedDtoQuery =
      querySchema?.quality === 'strict' && querySchema.schema.additionalProperties === false;
    const closedNamedQuery =
      !querySchema &&
      capability.params.freeFormQuery === false &&
      capability.params.query.length > 0;
    if (
      (!closedDtoQuery && !closedNamedQuery) ||
      !sameNames(actualQueryParameters, definition.expectedQueryParameters)
    ) {
      return false;
    }
  }

  const bindingNames = definition.queryBindings.map((binding) => binding.name);
  return (
    new Set(bindingNames).size === bindingNames.length &&
    bindingNames.every((name) => definition.expectedQueryParameters.includes(name)) &&
    definition.queryBindings.every(
      (binding) =>
        (binding.binding === 'companyA') !== (binding.literal !== undefined) &&
        (binding.binding === undefined || binding.name === 'companyId'),
    )
  );
}

export function globalAdminReadEvidencePack(
  manifest: readonly Capability[],
): CrudGlobalAdminReadFixturePack {
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = definitions.flatMap((definition): CrudGlobalAdminReadFixtureRegistration[] => {
    const capability = byId.get(definition.capabilityId);
    if (!capabilityMatchesDefinition(capability, definition)) return [];
    const fixtureHash = createHash('sha256')
      .update(definition.capabilityId)
      .digest('hex')
      .slice(0, 12);
    const fixtureSlug = definition.capabilityId
      .replace(/Controller\./g, '-')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return [
      Object.freeze({
        fixtureId: `global-admin-read-${fixtureSlug}-${fixtureHash}`,
        fixtureVersion: 1,
        capabilityId: definition.capabilityId,
        controlKind: 'positive' as const,
        description: `Reconcile ${definition.capabilityId} to its exact isolated administrative source record.`,
        governance: {
          scope: definition.scope,
          audit: 'not_applicable' as const,
        },
        packId: 'global-admin-deterministic-reads' as const,
        expectedPath: definition.expectedPath,
        expectedQueryParameters: definition.expectedQueryParameters,
        queryBindings: definition.queryBindings,
        executionPrincipal: definition.executionPrincipal,
        seedScenario: definition.seedScenario,
        oracle: definition.oracle,
      }),
    ];
  });

  return Object.freeze({
    packId: 'global-admin-deterministic-reads',
    packVersion: 1,
    fixtures: Object.freeze(
      fixtures.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
    ),
  });
}

export const CRUD_GLOBAL_ADMIN_READ_REVIEWED_DEFINITION_COUNT = definitions.length;
