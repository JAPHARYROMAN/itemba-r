import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_MUTATION_GAP_CREATE_EVIDENCE_PACK,
  CRUD_MUTATION_GAP_TRANCHE_CLOSED_IDS,
  CRUD_MUTATION_GAP_TRANCHE_EVIDENCE_PACK,
} from './crud-mutation-gap-tranche-evidence';
import { CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS } from './crud-admin-operations-positive-evidence';
import {
  CRUD_MUTATION_EVIDENCE_BLOCKERS,
  mutationEvidencePacksForManifest,
} from './crud-mutation-evidence-registry';
import {
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const EXPECTED_CLOSED_IDS = [
  'ApprovalStepsController.remove',
  'AuditEvidencePacksController.removeItem',
  'ComplianceDocumentStatusController.remove',
  'CustomerSegmentsController.removeMember',
  'EmployeesController.remove',
  'JobQueueConfigsController.remove',
  'NotificationsController.remove',
  'PermissionsController.remove',
  'PostingRulesController.remove',
  'PriceListsController.removeItem',
  'RefundsController.create',
  'RolesController.remove',
  'SuppliersController.create',
] as const;

const ADMIN_PACK_CLOSED_DELETE_IDS = [
  'CompaniesController.remove',
  'DivisionsController.remove',
  'ProductsController.removeImage',
] as const;

describe('database-only mutation gap tranche against the live manifest', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const capabilityById = new Map(manifest.map((capability) => [capability.id, capability]));
  const packs = [CRUD_MUTATION_GAP_TRANCHE_EVIDENCE_PACK, CRUD_MUTATION_GAP_CREATE_EVIDENCE_PACK];
  const fixtures = packs.flatMap((pack) => pack.fixtures);

  it('registers the exact thirteen reviewed database-only mutation gaps', () => {
    expect([...CRUD_MUTATION_GAP_TRANCHE_CLOSED_IDS].sort()).toEqual(
      [...EXPECTED_CLOSED_IDS].sort(),
    );
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_CLOSED_IDS].sort(),
    );
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(fixtures.length);
    expect(fixtures.filter((fixture) => fixture.operation === 'delete')).toHaveLength(11);
    expect(fixtures.filter((fixture) => fixture.operation === 'create')).toHaveLength(2);
  });

  it('binds every fixture to the exact live path/query/body envelope', () => {
    for (const fixture of fixtures) {
      const capability = capabilityById.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;
      expect(capability.verb).not.toBe('GET');
      expect(capability.agentExcluded).toBe(false);
      expect(capability.permissions.length + capability.anyPermissions.length).toBeGreaterThan(0);
      expect(Object.keys(fixture.request.path ?? {}).sort()).toEqual(
        [...capability.params.path].sort(),
      );
      expect(Object.keys(fixture.request.query ?? {}).sort()).toEqual(
        [...capability.params.query].sort(),
      );
      if (capability.params.hasBody) {
        expect(capability.params.bodySchema?.quality).toBe('strict');
        const schema = capability.params.bodySchema?.schema;
        const bodyKeys = Object.keys(fixture.request.body ?? {});
        expect(schema).toBeDefined();
        expect((schema?.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
        expect(bodyKeys.filter((key) => !schema?.properties[key])).toEqual([]);
      } else {
        expect(fixture.request.body).toBeUndefined();
      }
    }
  });

  it('declares exact before/after, audit scope, and deterministic recovery contracts', () => {
    for (const fixture of fixtures) {
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
      if (fixture.effect.kind === 'compound') {
        expect(fixture.preState).toBeUndefined();
      } else {
        expect(fixture.preState).toBeDefined();
      }
      expect(fixture.audit.required).toBe(true);
      expect(fixture.audit.scopeKind).toMatch(/^(COMPANY|GLOBAL)$/);

      const effect = fixture.effect;
      expect(['create', 'delete', 'compound']).toContain(effect.kind);
      if (effect.kind === 'compound') {
        expect(effect.effects.map((candidate) => candidate.effectId)).toEqual([
          'supplier',
          'supplierCategory',
        ]);
        for (const namedEffect of effect.effects) {
          expect(namedEffect.kind).toBe('scoped-row-create');
          if (namedEffect.kind !== 'scoped-row-create') continue;
          const model = Prisma.dmmf.datamodel.models.find(
            (candidate) => candidate.name === namedEffect.model,
          );
          const scalarNames =
            model?.fields
              .filter((field) => field.kind !== 'object')
              .map((field) => field.name)
              .sort() ?? [];
          const declaredNames = [
            ...Object.keys(namedEffect.expectedFields),
            ...Object.keys(namedEffect.generatedFields),
            ...(namedEffect.allowedFields ?? []),
          ].sort();
          expect(declaredNames).toEqual(scalarNames);
          expect(
            [...Object.keys(namedEffect.scope.equals), ...namedEffect.scope.identityFields].every(
              (field) => scalarNames.includes(field),
            ),
          ).toBe(true);
        }
        expect(effect.auditEntityId).toEqual({ effectRef: { effectId: 'supplier' } });
        expect(crudMutationRecoveryPlan(effect)).toEqual([
          expect.objectContaining({
            contractId: 'supplierCategory',
            model: 'SupplierProductCategory',
            recovery: 'restore-scope',
            recoveryOrder: 10,
          }),
          expect.objectContaining({
            contractId: 'supplier',
            model: 'Supplier',
            recovery: 'restore-scope',
            recoveryOrder: 20,
          }),
        ]);
        continue;
      }
      const model = Prisma.dmmf.datamodel.models.find(
        (candidate) => candidate.name === effect.model,
      );
      expect(model).toBeDefined();
      const scalarNames = new Set(
        model?.fields.filter((field) => field.kind !== 'object').map((field) => field.name),
      );
      expect(Object.keys(effect.expectedFields).length).toBeGreaterThan(0);
      expect(Object.keys(effect.expectedFields).every((field) => scalarNames.has(field))).toBe(
        true,
      );

      if (effect.kind === 'create') {
        expect(fixture.target).toBeUndefined();
        expect(effect.responseIdPath).toEqual(['id']);
        expect(effect.companyPath).toEqual(['companyId']);
        expect(effect.generatedFields.refundNumber).toEqual({
          kind: 'entity-code',
          entityType: 'Refund',
          companyId: { binding: 'companyA' },
        });
        expect(crudMutationRecoveryPlan(effect)).toEqual([
          expect.objectContaining({
            contractId: 'primary',
            recovery: 'delete-created',
            recoveryOrder: 0,
          }),
          expect.objectContaining({
            contractId: 'generated:refundNumber',
            model: 'DocumentNumberSequence',
            recovery: 'restore-scope',
          }),
        ]);
        continue;
      }
      expect(effect.kind).toBe('delete');
      if (effect.kind !== 'delete') continue;
      expect(fixture.target).toBeDefined();
      expect(fixture.preState?.model).toBe(effect.model);
      expect(crudMutationRecoveryPlan(effect)).toEqual([
        expect.objectContaining({
          contractId: 'primary',
          recovery: 'restore-row',
          recoveryOrder: 0,
        }),
      ]);
      if (effect.mode === 'hard') {
        expect(effect.allowedFields).toBeUndefined();
        expect(effect.expectedFields).toEqual(fixture.preState?.fields);
      } else {
        expect(effect.deletedAtPath).toEqual(['deletedAt']);
        expect(effect.expectedFields.deletedAt).toEqual({ now: 'iso' });
        expect(effect.allowedFields).toEqual(['updatedAt']);
      }
    }
  });

  it('uses isolated targets where shared seeds would cascade or fail a deletion guard', () => {
    const targetBinding = (capabilityId: string) => {
      const fixture = fixtures.find((candidate) => candidate.capabilityId === capabilityId);
      const id = fixture?.target?.id;
      return id && 'binding' in id ? id.binding : undefined;
    };
    expect(targetBinding('ApprovalStepsController.remove')).toBe('mutationGapApprovalStep');
    expect(targetBinding('EmployeesController.remove')).toBe('mutationGapEmployee');
    expect(targetBinding('PermissionsController.remove')).toBe('mutationGapPermission');
    expect(targetBinding('RolesController.remove')).toBe('mutationGapRole');
  });

  it('removes the gap-tranche and later admin-pack closures from the aggregate blocker inventory', () => {
    const blocked = new Set(CRUD_MUTATION_EVIDENCE_BLOCKERS.map((blocker) => blocker.capabilityId));
    expect(EXPECTED_CLOSED_IDS.filter((capabilityId) => blocked.has(capabilityId))).toEqual([]);
    expect(
      ADMIN_PACK_CLOSED_DELETE_IDS.filter(
        (capabilityId) => !CRUD_ADMIN_OPERATIONS_POSITIVE_CLOSED_IDS.includes(capabilityId),
      ),
    ).toEqual([]);
    expect(
      ADMIN_PACK_CLOSED_DELETE_IDS.filter((capabilityId) => blocked.has(capabilityId)),
    ).toEqual([]);
  });

  it('survives live-manifest filtering without silently dropping a fixture', () => {
    const filteredPacks = mutationEvidencePacksForManifest(manifest).filter((candidate) =>
      packs.some((pack) => pack.packId === candidate.packId),
    );
    expect(filteredPacks).toHaveLength(2);
    expect(
      filteredPacks.flatMap((pack) => pack.fixtures.map((fixture) => fixture.capabilityId)).sort(),
    ).toEqual([...EXPECTED_CLOSED_IDS].sort());
  });
});
