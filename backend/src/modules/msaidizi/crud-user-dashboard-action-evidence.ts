import { createHash } from 'node:crypto';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';
import { createFrameworkFieldsForModel } from './crud-mutation-generated-fields';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationValue,
} from './crud-mutation-evidence';

const PACK_ID = 'mutation-user-dashboard-upserts';
const MODEL = 'UserDashboardPreference';

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string): CrudMutationValue => ({ binding: name });
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);
const object = (value: Readonly<Record<string, CrudMutationValue>>): CrudMutationValue => ({
  object: value,
});

const dashboardId = idOf('DashboardDefinition');
const createDashboardId = binding('userDashboardCreateDefinition');
const existingPreferenceId = idOf(MODEL);
const userA = binding('userA');
const posterUserA = binding('posterUserA');
const globalAudit = Object.freeze({
  required: true as const,
  action: 'UPSERT',
  entityType: MODEL,
  companyId: { kind: 'exact' as const, value: literal(null) },
  scopeKind: 'GLOBAL' as const,
  attributionStatus: 'EXPLICIT' as const,
});

const createFilters = object({ evidence: literal('dashboard-create') });
const createLayout = object({ columns: literal(2), compact: literal(true) });
const baselineFilters = object({ evidence: literal('dashboard-before-update') });
const baselineLayout = object({ columns: literal(1), compact: literal(false) });
const updateFilters = object({ evidence: literal('dashboard-update') });
const updateLayout = object({ columns: literal(3), compact: literal(false) });

function fixtureId(capabilityId: string): string {
  return `user-dashboard-upsert-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 16)}`;
}

const fixtures = Object.freeze<readonly CrudMutationAnyFixtureRegistration[]>([
  {
    fixtureId: fixtureId('UserDashboardPreferencesController.upsertCreate'),
    fixtureVersion: 1,
    capabilityId: 'UserDashboardPreferencesController.upsertCreate',
    controlKind: 'positive',
    description:
      'Exercise the create branch of the user/dashboard upsert with a poster-owned isolated row, exact JSON scalars, explicit global audit attribution, and delete-created recovery.',
    governance: CRUD_MUTATION_GOVERNANCE,
    packId: PACK_ID,
    operation: 'action',
    setupModels: ['DashboardDefinition'],
    executionPrincipal: 'poster',
    request: {
      path: { dashboardId: createDashboardId },
      body: {
        filters: createFilters,
        isDefault: literal(false),
        layoutOverride: createLayout,
      },
    },
    effect: {
      kind: 'create',
      model: MODEL,
      responseIdPath: ['id'],
      expectedFields: {
        dashboardDefinitionId: createDashboardId,
        filters: createFilters,
        isDefault: literal(false),
        layoutOverride: createLayout,
        userId: posterUserA,
      },
      generatedFields: {},
      allowedFields: createFrameworkFieldsForModel(MODEL),
    },
    audit: globalAudit,
  } satisfies CrudMutationAnyFixtureRegistration,
  {
    fixtureId: fixtureId('UserDashboardPreferencesController.upsertUpdate'),
    fixtureVersion: 1,
    capabilityId: 'UserDashboardPreferencesController.upsertUpdate',
    controlKind: 'positive',
    description:
      'Exercise the update branch of the user/dashboard upsert against the exact creator-owned preference and restore its complete pre-action row.',
    governance: CRUD_MUTATION_GOVERNANCE,
    packId: PACK_ID,
    operation: 'action',
    setupModels: ['DashboardDefinition', MODEL],
    request: {
      path: { dashboardId },
      body: {
        filters: updateFilters,
        isDefault: literal(true),
        layoutOverride: updateLayout,
      },
    },
    target: { model: MODEL, id: existingPreferenceId },
    preState: {
      model: MODEL,
      id: existingPreferenceId,
      fields: {
        dashboardDefinitionId: dashboardId,
        filters: baselineFilters,
        isDefault: literal(false),
        layoutOverride: baselineLayout,
        userId: userA,
      },
    },
    effect: {
      kind: 'update',
      model: MODEL,
      id: existingPreferenceId,
      expectedFields: {
        filters: updateFilters,
        isDefault: literal(true),
        layoutOverride: updateLayout,
      },
      allowedFields: ['updatedAt'],
    },
    audit: globalAudit,
  } satisfies CrudMutationAnyFixtureRegistration,
]);

export const CRUD_USER_DASHBOARD_ACTION_EVIDENCE_PACK: CrudMutationAnyFixturePack = Object.freeze({
  packId: PACK_ID,
  packVersion: 1,
  fixtures,
});

export const CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS = Object.freeze(
  fixtures.map((fixture) => fixture.capabilityId),
);
