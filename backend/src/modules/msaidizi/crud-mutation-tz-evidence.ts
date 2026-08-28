import { createHash } from 'node:crypto';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationBlocker,
  CrudMutationAuditContract,
  CrudMutationValue,
  crudMutationAuditScopeKind,
} from './crud-mutation-evidence';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';
import { crudMutationAuditAttributionStatus } from './crud-mutation-audit-provenance';
import {
  createFrameworkFieldsForModel,
  generatedFieldsForCapability,
} from './crud-mutation-generated-fields';

type ValueMap = Readonly<Record<string, CrudMutationValue>>;
type Definition = Omit<
  CrudMutationAnyFixtureRegistration,
  'audit' | 'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> & {
  audit: Omit<CrudMutationAuditContract, 'companyId'> &
    Partial<Pick<CrudMutationAuditContract, 'companyId'>>;
};

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string): CrudMutationValue => ({ binding: name });
const unique = (prefix: string): CrudMutationValue => ({ unique: { prefix } });
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);
const companyA = binding('companyA');
const userA = binding('userA');
const posterUserA = binding('posterUserA');

const REVIEWED_AUDIT_COMPANY: Readonly<Record<string, CrudMutationAuditContract['companyId']>> =
  Object.freeze({
    'TaxAuthoritiesController.create': { kind: 'exact', value: literal(null) },
    'TaxAuthoritiesController.update': { kind: 'exact', value: literal(null) },
    'TaxAuthoritiesController.remove': { kind: 'exact', value: literal(null) },
    'TaxTypesController.create': { kind: 'exact', value: literal(null) },
    'TaxTypesController.update': { kind: 'exact', value: literal(null) },
    'TaxTypesController.remove': { kind: 'exact', value: literal(null) },
    'UserDashboardPreferencesController.setDefault': {
      kind: 'exact',
      value: literal(null),
    },
    'UserSecurityProfilesController.create': { kind: 'exact', value: companyA },
    'UserSecurityProfilesController.update': { kind: 'exact', value: companyA },
  });

function create(
  capabilityId: string,
  model: string,
  body: ValueMap,
  action: string,
  companyPath?: readonly string[],
): Definition {
  return {
    capabilityId,
    operation: 'create',
    request: { body },
    effect: {
      kind: 'create',
      model,
      responseIdPath: ['id'],
      expectedFields: body,
      generatedFields: generatedFieldsForCapability(capabilityId),
      allowedFields: createFrameworkFieldsForModel(model),
      ...(companyPath ? { companyPath } : {}),
    },
    audit: { required: true, action, entityType: model },
  };
}

function update(
  capabilityId: string,
  model: string,
  expectedFields: ValueMap,
  action: string,
  id: CrudMutationValue = idOf(model),
): Definition {
  return {
    capabilityId,
    operation: 'update',
    request: { path: { id }, body: expectedFields },
    target: { model, id },
    effect: { kind: 'update', model, id, expectedFields, allowedFields: ['updatedAt'] },
    audit: { required: true, action, entityType: model },
  };
}

function transition(
  capabilityId: string,
  model: string,
  expectedFields: ValueMap,
  action: string,
  preState: ValueMap,
  options: { id?: CrudMutationValue; pathName?: string; entityType?: string } = {},
): Definition {
  const id = options.id ?? idOf(model);
  return {
    capabilityId,
    operation: 'action',
    request: { path: { [options.pathName ?? 'id']: id } },
    target: { model, id },
    preState: { model, id, fields: preState },
    effect: {
      kind: 'transition',
      model,
      id,
      expectedFields,
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action,
      entityType: options.entityType ?? model,
    },
  };
}

function softDelete(
  capabilityId: string,
  model: string,
  action: string,
  id: CrudMutationValue = idOf(model),
): Definition {
  return {
    capabilityId,
    operation: 'delete',
    request: { path: { id } },
    target: { model, id },
    preState: { model, id, fields: { deletedAt: literal(null) } },
    effect: {
      kind: 'delete',
      model,
      id,
      mode: 'soft',
      deletedAtPath: ['deletedAt'],
      expectedFields: { deletedAt: { now: 'iso' } },
      allowedFields: ['updatedAt'],
    },
    audit: { required: true, action, entityType: model },
  };
}

function taxReturnTransition(
  capabilityId: string,
  status: string,
  expectedFields: ValueMap = {},
  preStateFields: ValueMap = {},
): Definition {
  return transition(
    capabilityId,
    'TaxReturn',
    { status: literal(status), ...expectedFields },
    'UPDATE',
    { status: literal('DRAFT'), ...preStateFields },
  );
}

const taskDefinitions: readonly Definition[] = [
  create(
    'TasksController.create',
    'Task',
    { title: unique('CRUD evidence task'), companyId: companyA, assignedToId: posterUserA },
    'CREATE',
    ['companyId'],
  ),
  update('TasksController.update', 'Task', { title: unique('Updated task') }, 'UPDATE'),
  transition(
    'TasksController.complete',
    'Task',
    { status: literal('COMPLETED'), completedAt: { now: 'iso' }, completedById: userA },
    'UPDATE',
    {
      status: literal('TODO'),
      completedAt: literal(null),
      completedById: literal(null),
    },
  ),
  transition('TasksController.cancel', 'Task', { status: literal('CANCELLED') }, 'UPDATE', {
    status: literal('TODO'),
  }),
  softDelete('TasksController.remove', 'Task', 'DELETE'),
];

const taxDefinitions: readonly Definition[] = [
  create(
    'TaxAuthoritiesController.create',
    'TaxAuthority',
    {
      authorityCode: unique('CETA'),
      name: unique('CRUD tax authority'),
      country: literal('TZ'),
    },
    'CREATE',
  ),
  update(
    'TaxAuthoritiesController.update',
    'TaxAuthority',
    { name: unique('Updated tax authority') },
    'UPDATE',
  ),
  softDelete('TaxAuthoritiesController.remove', 'TaxAuthority', 'DELETE'),

  create(
    'TaxTypesController.create',
    'TaxType',
    { taxTypeCode: unique('CETT'), name: unique('CRUD tax type'), taxCategory: literal('OTHER') },
    'CREATE',
  ),
  update('TaxTypesController.update', 'TaxType', { name: unique('Updated tax type') }, 'UPDATE'),
  softDelete('TaxTypesController.remove', 'TaxType', 'DELETE'),

  create(
    'TaxCodesController.create',
    'TaxCode',
    {
      taxCode: unique('CETC'),
      companyId: companyA,
      taxTypeId: idOf('TaxType'),
      name: unique('CRUD tax code'),
    },
    'CREATE',
    ['companyId'],
  ),
  update('TaxCodesController.update', 'TaxCode', { name: unique('Updated tax code') }, 'UPDATE'),
  softDelete('TaxCodesController.remove', 'TaxCode', 'DELETE'),

  create(
    'TaxFilingPeriodsController.create',
    'TaxFilingPeriod',
    {
      filingPeriodCode: unique('CEFP'),
      companyId: companyA,
      taxTypeId: idOf('TaxType'),
      name: unique('CRUD filing period'),
      periodStart: literal('2028-01-01T00:00:00.000Z'),
      periodEnd: literal('2028-01-31T23:59:59.999Z'),
    },
    'CREATE',
    ['companyId'],
  ),
  update(
    'TaxFilingPeriodsController.update',
    'TaxFilingPeriod',
    { name: unique('Updated filing period') },
    'UPDATE',
  ),
  softDelete('TaxFilingPeriodsController.remove', 'TaxFilingPeriod', 'DELETE'),

  create(
    'TaxRatesController.create',
    'TaxRate',
    {
      taxTypeId: idOf('TaxType'),
      companyId: companyA,
      rateName: unique('CRUD tax rate'),
      rate: literal(18),
      effectiveFrom: literal('2028-01-01T00:00:00.000Z'),
      createdById: userA,
      status: literal('INACTIVE'),
    },
    'CREATE',
    ['companyId'],
  ),
  update(
    'TaxRatesController.update',
    'TaxRate',
    { rateName: unique('Updated tax rate') },
    'UPDATE',
  ),
  transition(
    'TaxRatesController.approve',
    'TaxRate',
    { status: literal('ACTIVE'), approvedAt: { now: 'iso' }, approvedById: userA },
    'UPDATE',
    { status: literal('INACTIVE'), approvedAt: literal(null), approvedById: literal(null) },
  ),
  transition(
    'TaxRatesController.deactivate',
    'TaxRate',
    { status: literal('INACTIVE') },
    'UPDATE',
    { status: literal('ACTIVE') },
  ),
  softDelete('TaxRatesController.remove', 'TaxRate', 'DELETE'),

  create(
    'TaxReturnsController.create',
    'TaxReturn',
    {
      taxReturnNumber: unique('CERET'),
      companyId: companyA,
      taxFilingPeriodId: idOf('TaxFilingPeriod'),
      taxTypeId: idOf('TaxType'),
      notes: unique('CRUD tax return'),
    },
    'CREATE',
    ['companyId'],
  ),
  update(
    'TaxReturnsController.update',
    'TaxReturn',
    { notes: unique('Updated tax return') },
    'UPDATE',
  ),
  taxReturnTransition(
    'TaxReturnsController.prepare',
    'PREPARED',
    { preparedById: userA },
    { preparedById: literal(null) },
  ),
  taxReturnTransition(
    'TaxReturnsController.review',
    'REVIEWED',
    { reviewedById: userA },
    { reviewedById: literal(null) },
  ),
  taxReturnTransition(
    'TaxReturnsController.approve',
    'APPROVED',
    { approvedById: userA },
    { approvedById: literal(null) },
  ),
  taxReturnTransition(
    'TaxReturnsController.submit',
    'SUBMITTED',
    { submissionDate: { now: 'iso' }, submittedById: userA },
    { submissionDate: literal(null), submittedById: literal(null) },
  ),
  taxReturnTransition(
    'TaxReturnsController.markPaid',
    'PAID',
    { paidById: userA, paymentDate: { now: 'iso' } },
    { paidById: literal(null), paymentDate: literal(null) },
  ),
  taxReturnTransition('TaxReturnsController.cancel', 'CANCELLED'),
  softDelete('TaxReturnsController.remove', 'TaxReturn', 'DELETE'),

  create(
    'TaxTransactionsController.create',
    'TaxTransaction',
    {
      taxTransactionNumber: unique('CETX'),
      companyId: companyA,
      taxTypeId: idOf('TaxType'),
      transactionDate: literal('2028-01-15T00:00:00.000Z'),
      taxableAmount: literal(1000),
      taxAmount: literal(180),
      createdById: userA,
    },
    'CREATE',
    ['companyId'],
  ),
  update(
    'TaxTransactionsController.update',
    'TaxTransaction',
    { notes: unique('Updated tax transaction') },
    'UPDATE',
  ),
  transition(
    'TaxTransactionsController.post',
    'TaxTransaction',
    { status: literal('POSTED'), postedAt: { now: 'iso' }, postedById: userA },
    'UPDATE',
    { status: literal('DRAFT'), postedAt: literal(null), postedById: literal(null) },
  ),
  transition(
    'TaxTransactionsController.reverse',
    'TaxTransaction',
    { status: literal('REVERSED') },
    'UPDATE',
    { status: literal('DRAFT') },
  ),
  softDelete('TaxTransactionsController.remove', 'TaxTransaction', 'DELETE'),
];

const unitAndShiftDefinitions: readonly Definition[] = [
  create(
    'UnitsController.createUnit',
    'UnitOfMeasure',
    {
      companyId: companyA,
      name: unique('CRUD evidence unit'),
      symbol: unique('CEU'),
      unitType: literal('PIECE'),
      isBaseUnit: literal(false),
    },
    'UNIT_CREATE',
    ['companyId'],
  ),
  update(
    'UnitsController.updateUnit',
    'UnitOfMeasure',
    { name: unique('Updated evidence unit') },
    'UNIT_UPDATE',
  ),
  softDelete('UnitsController.removeUnit', 'UnitOfMeasure', 'UNIT_DELETE'),
  create(
    'UnitsController.createConversion',
    'UnitConversion',
    {
      companyId: companyA,
      fromUnitId: binding('unitA'),
      toUnitId: binding('unitB'),
      conversionFactor: literal(2),
      description: unique('CRUD unit conversion'),
    },
    'UNIT_CONVERSION_CREATE',
    ['companyId'],
  ),
  update(
    'UnitsController.updateConversion',
    'UnitConversion',
    { conversionFactor: literal(3), description: unique('Updated conversion') },
    'UNIT_CONVERSION_UPDATE',
  ),
  softDelete('UnitsController.removeConversion', 'UnitConversion', 'UNIT_CONVERSION_DELETE'),

  create(
    'WorkShiftsController.create',
    'WorkShift',
    {
      shiftCode: unique('CEWS'),
      companyId: companyA,
      name: unique('CRUD work shift'),
      startTime: literal('08:00'),
      endTime: literal('17:00'),
    },
    'CREATE',
    ['companyId'],
  ),
  update('WorkShiftsController.update', 'WorkShift', { name: unique('Updated shift') }, 'UPDATE'),
  softDelete('WorkShiftsController.remove', 'WorkShift', 'DELETE'),
];

const userAndIntegrationDefinitions: readonly Definition[] = [
  {
    capabilityId: 'UserDashboardPreferencesController.setDefault',
    operation: 'action',
    setupModels: ['DashboardDefinition', 'UserDashboardPreference'],
    request: { path: { dashboardId: idOf('DashboardDefinition') } },
    target: {
      model: 'UserDashboardPreference',
      id: idOf('UserDashboardPreference'),
    },
    preState: {
      model: 'UserDashboardPreference',
      id: idOf('UserDashboardPreference'),
      fields: {
        userId: userA,
        dashboardDefinitionId: idOf('DashboardDefinition'),
        isDefault: literal(false),
      },
    },
    effect: {
      kind: 'transition',
      model: 'UserDashboardPreference',
      id: idOf('UserDashboardPreference'),
      expectedFields: { isDefault: literal(true) },
      allowedFields: ['updatedAt'],
    },
    audit: { required: true, action: 'UPDATE', entityType: 'UserDashboardPreference' },
  },
  create(
    'UserSecurityProfilesController.create',
    'UserSecurityProfile',
    {
      userId: posterUserA,
      forcePasswordChange: literal(true),
      forceTwoFactorSetup: literal(true),
      securityRiskLevel: literal('MEDIUM'),
    },
    'USER_SECURITY_PROFILE_CREATED',
  ),
  update(
    'UserSecurityProfilesController.update',
    'UserSecurityProfile',
    { forcePasswordChange: literal(true) },
    'USER_SECURITY_PROFILE_UPDATED',
  ),
  update(
    'UsersController.update',
    'User',
    { fullName: unique('CRUD evidence updated user') },
    'USER_UPDATED',
    posterUserA,
  ),
  {
    capabilityId: 'UsersController.remove',
    operation: 'delete',
    request: { path: { id: posterUserA } },
    preState: {
      model: 'User',
      id: posterUserA,
      fields: { deletedAt: literal(null), status: literal('ACTIVE') },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'user',
          kind: 'row-delete',
          model: 'User',
          id: posterUserA,
          mode: 'soft',
          deletedAtPath: ['deletedAt'],
          expectedFields: {
            deletedAt: { now: 'iso' },
            status: literal('INACTIVE'),
            updatedAt: { now: 'iso' },
          },
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'refreshToken',
          kind: 'row-update',
          model: 'RefreshToken',
          id: binding('posterRefreshToken'),
          expectedFields: {
            revokedAt: { now: 'iso' },
            revokedReason: literal('USER_DEACTIVATED'),
          },
          recovery: 'restore-row',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: posterUserA,
    },
    audit: {
      required: true,
      action: 'USER_DEACTIVATED',
      entityType: 'User',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  transition(
    'WebhookEventsController.reprocess',
    'WebhookEvent',
    {
      processingStatus: literal('RECEIVED'),
      errorMessage: literal(null),
      processedAt: literal(null),
    },
    'WEBHOOK_EVENT_REPROCESSED',
    {
      processingStatus: literal('FAILED'),
      verificationStatus: literal('VERIFIED'),
      errorMessage: literal('CRUD evidence webhook failure'),
      processedAt: literal('2026-08-25T00:00:00.000Z'),
    },
  ),
  create(
    'WebhookEndpointsController.create',
    'WebhookEndpoint',
    {
      webhookCode: unique('CEWEBHOOK'),
      companyId: companyA,
      name: unique('CRUD webhook endpoint'),
      endpointPath: literal('/crud-evidence-webhook'),
      allowedEvents: { array: [literal('crud.evidence.created')] },
    },
    'WEBHOOK_ENDPOINT_CREATED',
    ['companyId'],
  ),
  update(
    'WebhookEndpointsController.update',
    'WebhookEndpoint',
    { name: unique('Updated webhook endpoint') },
    'WEBHOOK_ENDPOINT_UPDATED',
  ),
  softDelete('WebhookEndpointsController.remove', 'WebhookEndpoint', 'WEBHOOK_ENDPOINT_DELETED'),
  transition(
    'ThreeWayMatchingController.approve',
    'ThreeWayMatch',
    { approvedAt: { now: 'iso' }, approvedById: userA },
    'APPROVE',
    { matchStatus: literal('MATCHED'), approvedAt: literal(null), approvedById: literal(null) },
  ),
];

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/Controller\./g, '-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `mutation-tz-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

function pack(packId: string, definitions: readonly Definition[]): CrudMutationAnyFixturePack {
  const fixtures = definitions
    .map((definition): CrudMutationAnyFixtureRegistration => {
      const companyId =
        definition.audit.companyId ??
        REVIEWED_AUDIT_COMPANY[definition.capabilityId] ??
        ({ kind: 'effect-company' } as const);
      return Object.freeze({
        ...definition,
        fixtureId: fixtureId(definition.capabilityId),
        fixtureVersion: 1,
        controlKind: 'positive',
        description: `Execute and verify ${definition.capabilityId} against isolated PostgreSQL state.`,
        governance: CRUD_MUTATION_GOVERNANCE,
        audit: {
          ...definition.audit,
          companyId,
          scopeKind: definition.audit.scopeKind ?? crudMutationAuditScopeKind(companyId),
          attributionStatus:
            definition.audit.attributionStatus ??
            crudMutationAuditAttributionStatus(definition.capabilityId),
        },
        packId,
      });
    })
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  return Object.freeze({ packId, packVersion: 1, fixtures: Object.freeze(fixtures) });
}

export const CRUD_MUTATION_TZ_EVIDENCE_PACKS: readonly CrudMutationAnyFixturePack[] = Object.freeze(
  [
    pack('mutation-tz-tasks-tax', [...taskDefinitions, ...taxDefinitions]),
    pack('mutation-tz-units-shifts', unitAndShiftDefinitions),
    pack('mutation-tz-users-integrations', userAndIntegrationDefinitions),
  ],
);

const blocker = (
  capabilityId: string,
  reason: CrudMutationBlocker['reason'],
  detail: string,
): CrudMutationBlocker => ({ capabilityId, reason, detail: `${capabilityId}: ${detail}` });

export const CRUD_MUTATION_TZ_BLOCKERS: readonly CrudMutationBlocker[] = Object.freeze([
  blocker(
    'TaxAutoApplyController.applyPurchaseOrder',
    'exact_effect_not_represented',
    'the feature-flagged action may create zero-to-many ledger rows and has no single exact target effect contract.',
  ),
  blocker(
    'TaxAutoApplyController.applySalesOrder',
    'exact_effect_not_represented',
    'the feature-flagged action may create zero-to-many ledger rows and has no single exact target effect contract.',
  ),
  blocker(
    'TaxFilingEngineController.compute',
    'audit_attribution_not_persisted',
    'the persistent compute/upsert path does not append an attributable AuditLog row.',
  ),
  blocker(
    'ThreeWayMatchingController.create',
    'isolated_seed_not_available',
    'a truthful match requires mutually consistent purchase-order, invoice, GRN, supplier and line-level valuation fixtures.',
  ),
  blocker(
    'UserDashboardPreferencesController.upsertCreate',
    'body_schema_not_strict',
    'the DTO-derived request body schema is partial.',
  ),
  blocker(
    'UserDashboardPreferencesController.upsertUpdate',
    'body_schema_not_strict',
    'the DTO-derived request body schema is partial.',
  ),
  blocker(
    'UsersController.assignRoles',
    'body_schema_not_strict',
    'the DTO-derived request body schema is partial.',
  ),
  blocker(
    'UsersController.create',
    'body_schema_not_strict',
    'the DTO-derived request body schema is partial.',
  ),
  blocker(
    'UsersController.grantCompanyAccess',
    'exact_effect_not_represented',
    'the action replaces a compound set of company-access rows rather than one exact target row.',
  ),
  blocker(
    'WestsidesReportsController.saveDailyClose',
    'body_schema_not_strict',
    'the DTO-derived request body schema is partial.',
  ),
]);
