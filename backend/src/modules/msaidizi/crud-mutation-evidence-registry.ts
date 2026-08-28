import { Prisma } from '@prisma/client';
import { Capability } from '../../common/capabilities/capability-manifest';
import {
  CRUD_ACTION_TRANCHE_CLOSED_IDS,
  CRUD_ACTION_TRANCHE_EVIDENCE_PACK,
} from './crud-action-tranche-evidence';
import {
  CRUD_ACTION_CLOSURE_CLOSED_IDS,
  CRUD_ACTION_CLOSURE_EVIDENCE_PACK,
} from './crud-action-closure-evidence';
import {
  CRUD_FINANCIAL_ACTION_POSITIVE_CLOSED_IDS,
  CRUD_FINANCIAL_ACTION_POSITIVE_EVIDENCE_PACK,
} from './crud-financial-action-positive-evidence';
import {
  CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS,
  CRUD_ADMIN_OPERATIONS_POSITIVE_EVIDENCE_PACK,
} from './crud-admin-operations-positive-evidence';
import {
  CRUD_MUTATION_AM_BLOCKERS,
  CRUD_MUTATION_AM_EVIDENCE_PACKS,
} from './crud-mutation-am-evidence';
import {
  CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK,
  CRUD_MUTATION_AUTONOMY_RELEASE_POSITIVE_IDS,
} from './crud-mutation-autonomy-release-evidence';
import {
  CRUD_MUTATION_BASE_BLOCKERS,
  CRUD_MUTATION_BASE_EVIDENCE_PACK,
} from './crud-mutation-base-evidence';
import {
  CRUD_MUTATION_GAP_CREATE_EVIDENCE_PACK,
  CRUD_MUTATION_GAP_TRANCHE_CLOSED_IDS,
  CRUD_MUTATION_GAP_TRANCHE_EVIDENCE_PACK,
} from './crud-mutation-gap-tranche-evidence';
import {
  CRUD_MUTATION_NS_BLOCKERS,
  CRUD_MUTATION_NS_EVIDENCE_PACKS,
} from './crud-mutation-ns-evidence';
import {
  CRUD_NEXT_ACTION_CLOSED_IDS,
  CRUD_NEXT_ACTION_EVIDENCE_PACK,
} from './crud-next-action-evidence';
import {
  CRUD_MUTATION_TZ_BLOCKERS,
  CRUD_MUTATION_TZ_EVIDENCE_PACKS,
} from './crud-mutation-tz-evidence';
import {
  CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS,
  CRUD_USER_DASHBOARD_ACTION_EVIDENCE_PACK,
} from './crud-user-dashboard-action-evidence';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationBlocker,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const staticPacks: readonly CrudMutationAnyFixturePack[] = Object.freeze([
  CRUD_MUTATION_BASE_EVIDENCE_PACK,
  ...CRUD_MUTATION_AM_EVIDENCE_PACKS,
  ...CRUD_MUTATION_NS_EVIDENCE_PACKS,
  ...CRUD_MUTATION_TZ_EVIDENCE_PACKS,
  CRUD_MUTATION_GAP_TRANCHE_EVIDENCE_PACK,
  CRUD_MUTATION_GAP_CREATE_EVIDENCE_PACK,
  CRUD_ACTION_TRANCHE_EVIDENCE_PACK,
  CRUD_ACTION_CLOSURE_EVIDENCE_PACK,
  CRUD_FINANCIAL_ACTION_POSITIVE_EVIDENCE_PACK,
  CRUD_ADMIN_OPERATIONS_POSITIVE_EVIDENCE_PACK,
  CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK,
  CRUD_USER_DASHBOARD_ACTION_EVIDENCE_PACK,
  CRUD_NEXT_ACTION_EVIDENCE_PACK,
]);

/**
 * Binds independently owned mutation definitions to one exact live manifest.
 * Drift removes the fixture rather than silently invoking a stale envelope;
 * tranche manifest tests then expose the missing registration as a red gap.
 */
export function mutationEvidencePacksForManifest(
  manifest: readonly Capability[],
): readonly CrudMutationAnyFixturePack[] {
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  for (const fixture of staticPacks.flatMap((pack) => pack.fixtures)) {
    const errors = [...validateCrudMutationFixtureContract(fixture)];
    errors.push(...validateCrudMutationFixtureDmmfContract(fixture));
    if (errors.length > 0) {
      throw new Error(
        `Invalid mutation evidence contract ${fixture.fixtureId}: ${errors.join('; ')}`,
      );
    }
  }
  return Object.freeze(
    staticPacks.map((pack) =>
      Object.freeze({
        ...pack,
        fixtures: Object.freeze(
          pack.fixtures.filter((fixture) =>
            matchesManifest(fixture, byId.get(fixture.capabilityId)),
          ),
        ),
      }),
    ),
  );
}

/**
 * Fail-fast create preflight against the generated Prisma model. A required
 * persisted scalar cannot be hidden behind a request DTO alias or a permissive
 * allowedFields entry: it must be request-backed or carry a generatedFields
 * validator.
 */
export function validateCrudMutationFixtureDmmfContract(
  fixture: CrudMutationAnyFixtureRegistration,
): string[] {
  if (fixture.effect.kind !== 'create') return [];
  const effect = fixture.effect;
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === effect.model);
  if (!model) return [`Prisma model ${effect.model} is absent`];

  const scalarFields = new Map(
    model.fields.filter((field) => field.kind !== 'object').map((field) => [field.name, field]),
  );
  const expected = new Set(Object.keys(effect.expectedFields));
  const generated = new Set(Object.keys(effect.generatedFields));
  const allowed = new Set(effect.allowedFields ?? []);
  const companyField = effect.companyPath?.length === 1 ? effect.companyPath[0] : undefined;
  const errors: string[] = [];

  for (const [source, names] of [
    ['expectedFields', expected],
    ['generatedFields', generated],
    ['allowedFields', allowed],
  ] as const) {
    for (const name of names) {
      if (!scalarFields.has(name))
        errors.push(`${source}.${name} is not a scalar on ${effect.model}`);
    }
  }
  if (effect.companyPath && !companyField) {
    errors.push('companyPath must identify one persisted scalar field');
  } else if (companyField && !scalarFields.has(companyField)) {
    errors.push(`companyPath.${companyField} is not a scalar on ${effect.model}`);
  }

  for (const field of model.fields.filter(
    (candidate) =>
      candidate.kind !== 'object' &&
      candidate.isRequired &&
      !candidate.isList &&
      !candidate.hasDefaultValue &&
      !(candidate as { isUpdatedAt?: boolean }).isUpdatedAt,
  )) {
    if (!expected.has(field.name) && !generated.has(field.name) && field.name !== companyField) {
      errors.push(`required scalar ${effect.model}.${field.name} has no exact create contract`);
    }
  }

  for (const name of allowed) {
    const field = scalarFields.get(name);
    if (
      field &&
      !field.isId &&
      !field.hasDefaultValue &&
      !(field as { isUpdatedAt?: boolean }).isUpdatedAt
    ) {
      errors.push(`allowed field ${effect.model}.${name} is not schema-managed`);
    }
  }

  for (const [name, validator] of Object.entries(effect.generatedFields)) {
    const field = scalarFields.get(name);
    if (!field) continue;
    if (
      ![
        'exact',
        'action-time',
        'action-local-calendar-days',
        'local-day-start',
        'local-day-end',
        'utc-day-start',
        'utc-day-end',
        'independent-domain-aggregate',
        // The response value is compared to the persisted scalar through the
        // loopback harness' canonical database-value comparison, so it is an
        // exact contract for Int/Json/DateTime fields as well as String.
        'response-exact',
      ].includes(validator.kind) &&
      !['String'].includes(String(field.type))
    ) {
      errors.push(`generated field ${effect.model}.${name} requires a String scalar validator`);
    }
    if (
      validator.kind === 'exact' &&
      'now' in validator.value &&
      String(field.type) !== 'DateTime'
    ) {
      errors.push(`generated timestamp ${effect.model}.${name} is not DateTime`);
    }
    if (validator.kind === 'action-time' && String(field.type) !== 'DateTime') {
      errors.push(`generated action time ${effect.model}.${name} is not DateTime`);
    }
    if (validator.kind === 'action-local-calendar-days' && String(field.type) !== 'DateTime') {
      errors.push(`generated local calendar time ${effect.model}.${name} is not DateTime`);
    }
    if (
      (validator.kind === 'local-day-start' || validator.kind === 'local-day-end') &&
      String(field.type) !== 'DateTime'
    ) {
      errors.push(`generated local day boundary ${effect.model}.${name} is not DateTime`);
    }
    if (
      (validator.kind === 'utc-day-start' || validator.kind === 'utc-day-end') &&
      String(field.type) !== 'DateTime'
    ) {
      errors.push(`generated UTC day boundary ${effect.model}.${name} is not DateTime`);
    }
    if (
      validator.kind === 'independent-domain-aggregate' &&
      validator.source === 'financial-trial-balance' &&
      String(field.type) !== 'Json'
    ) {
      errors.push(`generated financial aggregate ${effect.model}.${name} is not Json`);
    }
    if (
      validator.kind === 'independent-domain-aggregate' &&
      validator.source !== 'financial-trial-balance' &&
      String(field.type) !== 'Decimal'
    ) {
      errors.push(`generated statement aggregate ${effect.model}.${name} is not Decimal`);
    }
  }
  return errors;
}

const closedGapCapabilityIds = new Set([
  ...CRUD_MUTATION_GAP_TRANCHE_CLOSED_IDS,
  ...CRUD_ACTION_TRANCHE_CLOSED_IDS,
  ...CRUD_ACTION_CLOSURE_CLOSED_IDS,
  ...CRUD_FINANCIAL_ACTION_POSITIVE_CLOSED_IDS,
  ...CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS,
  ...CRUD_MUTATION_AUTONOMY_RELEASE_POSITIVE_IDS,
  ...CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS,
  ...CRUD_NEXT_ACTION_CLOSED_IDS,
]);

export const CRUD_MUTATION_EVIDENCE_BLOCKERS: readonly CrudMutationBlocker[] = Object.freeze(
  [
    ...CRUD_MUTATION_BASE_BLOCKERS,
    ...CRUD_MUTATION_AM_BLOCKERS,
    ...CRUD_MUTATION_NS_BLOCKERS,
    ...CRUD_MUTATION_TZ_BLOCKERS,
  ].filter((blocker) => !closedGapCapabilityIds.has(blocker.capabilityId)),
);

function matchesManifest(
  fixture: CrudMutationAnyFixtureRegistration,
  capability: Capability | undefined,
): boolean {
  if (
    !capability ||
    capability.agentExcluded ||
    capability.verb === 'GET' ||
    (capability.permissions.length === 0 && capability.anyPermissions.length === 0)
  ) {
    return false;
  }
  if (!sameNames(Object.keys(fixture.request.path ?? {}), capability.params.path)) return false;
  if (!sameNames(Object.keys(fixture.request.query ?? {}), capability.params.query)) return false;

  if (!capability.params.hasBody) return fixture.request.body === undefined;
  const schema = capability.params.bodySchema;
  if (!schema || schema.quality !== 'strict') return false;
  const bodyKeys = Object.keys(fixture.request.body ?? {});
  return (
    (schema.schema.required ?? []).every((name) => bodyKeys.includes(name)) &&
    bodyKeys.every((name) => Boolean(schema.schema.properties[name]))
  );
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}
