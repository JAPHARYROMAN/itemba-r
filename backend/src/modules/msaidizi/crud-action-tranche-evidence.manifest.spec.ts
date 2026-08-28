import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_ACTION_TRANCHE_CLOSED_IDS,
  CRUD_ACTION_TRANCHE_EVIDENCE_PACK,
} from './crud-action-tranche-evidence';
import {
  CRUD_MUTATION_EVIDENCE_BLOCKERS,
  mutationEvidencePacksForManifest,
} from './crud-mutation-evidence-registry';
import {
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const EXPECTED_IDS = [
  'MobilePosLiteController.issueActivation',
  'OfflineSyncController.createBatch',
  'ProformaInvoicesController.convertToSalesOrder',
  'RecordBookController.auditExport',
  'SupplierInvoicesController.runMatch',
  'SupplierOrderDraftsController.auditExport',
] as const;

describe('bounded database-only action evidence tranche', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_ACTION_TRANCHE_EVIDENCE_PACK.fixtures;

  it('registers exactly the six reserved non-external mutations with their coverage operations', () => {
    expect([...CRUD_ACTION_TRANCHE_CLOSED_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(6);
    expect(fixtures.filter((fixture) => fixture.operation === 'action')).toHaveLength(5);
    expect(fixtures.filter((fixture) => fixture.operation === 'create')).toEqual([
      expect.objectContaining({ capabilityId: 'OfflineSyncController.createBatch' }),
    ]);
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'MobilePosLiteController.issueActivation')
        ?.executionPrincipal,
    ).toBe('group');
    const coverageOperations = new Map(
      buildCrudCoverageReport(manifest).capabilities.map((entry) => [
        entry.capabilityId,
        entry.operation,
      ]),
    );
    expect(fixtures.map((fixture) => [fixture.capabilityId, fixture.operation])).toEqual(
      fixtures.map((fixture) => [
        fixture.capabilityId,
        coverageOperations.get(fixture.capabilityId),
      ]),
    );
    expect(
      fixtures.some((fixture) => /email|filesystem|cache|provider/i.test(fixture.description)),
    ).toBe(false);
  });

  it('binds every mutation to the exact live path/query/body envelope', () => {
    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId);
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
      if (!capability.params.hasBody) {
        expect(fixture.request.body).toBeUndefined();
        continue;
      }
      expect(capability.params.bodySchema?.quality).toBe('strict');
      const schema = capability.params.bodySchema?.schema;
      const bodyKeys = Object.keys(fixture.request.body ?? {});
      expect((schema?.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
      expect(bodyKeys.filter((key) => !schema?.properties[key])).toEqual([]);
    }
  });

  it('declares closed field sets, exact audits, and deterministic recovery', () => {
    for (const fixture of fixtures) {
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
      expect(fixture.audit.required).toBe(true);
      expect(fixture.audit.scopeKind).toMatch(/^(COMPANY|GLOBAL)$/);

      const effect = fixture.effect;
      if (effect.kind === 'audit-only') {
        expect(effect.expectedFields).toEqual({});
        expect([...crudMutationAllowedModels(effect)].sort()).toEqual([
          'AuditLog',
          'AuditLogCompanyScope',
        ]);
        expect([...crudMutationBusinessDeltaModels(effect)]).toEqual([]);
        expect(crudMutationRecoveryPlan(effect)).toEqual([]);
        continue;
      }
      if (effect.kind === 'generated-transition') {
        expect(Object.keys(effect.expectedFields)).toEqual([]);
        expect(effect.generatedFields).toEqual({
          activationExpiresAt: { kind: 'action-time', offsetMs: 1_200_000 },
          activationTokenHash: {
            kind: 'response-secret-digest',
            responsePath: ['activationCode'],
            algorithm: 'sha256',
            encoding: 'hex',
          },
        });
        expect(effect.allowedFields).toEqual(['updatedAt']);
        expect(crudMutationRecoveryPlan(effect)).toEqual([
          expect.objectContaining({ model: 'MobilePosTerminal', recovery: 'restore-row' }),
        ]);
        continue;
      }
      if (effect.kind === 'create') {
        assertCompleteCreateModel(effect.model, {
          expected: Object.keys(effect.expectedFields),
          generated: Object.keys(effect.generatedFields),
          allowed: effect.allowedFields ?? [],
        });
        expect(crudMutationRecoveryPlan(effect)).toEqual([
          expect.objectContaining({ model: 'OfflineSyncBatch', recovery: 'delete-created' }),
        ]);
        continue;
      }
      expect(effect.kind).toBe('compound');
      if (effect.kind !== 'compound') continue;
      for (const named of effect.effects) {
        if (named.kind !== 'scoped-row-create') continue;
        assertCompleteCreateModel(named.model, {
          expected: Object.keys(named.expectedFields),
          generated: Object.keys(named.generatedFields),
          allowed: named.allowedFields ?? [],
        });
      }
      const recovery = crudMutationRecoveryPlan(effect);
      expect(recovery.map((item) => item.recoveryOrder)).toEqual(
        [...recovery.map((item) => item.recoveryOrder)].sort((left, right) => left - right),
      );
      expect(new Set(recovery.map((item) => item.recoveryOrder)).size).toBe(recovery.length);
    }
  });

  it('pins conversion idempotency to the proforma and derives the sales-order year at action time', () => {
    const fixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'ProformaInvoicesController.convertToSalesOrder',
    );
    expect(fixture?.effect.kind).toBe('compound');
    if (!fixture || fixture.effect.kind !== 'compound') return;
    const salesOrder = fixture.effect.effects.find(
      (effect) => effect.effectId === 'salesOrder' && effect.kind === 'scoped-row-create',
    );
    expect(salesOrder?.kind).toBe('scoped-row-create');
    if (!salesOrder || salesOrder.kind !== 'scoped-row-create') return;
    expect(salesOrder.expectedFields).toEqual(
      expect.objectContaining({
        confirmedAt: { literal: null },
        confirmedById: { literal: null },
        journalEntryId: { literal: null },
        receivableId: { literal: null },
        salesType: { literal: 'CREDIT_SALE' },
        status: { literal: 'DRAFT' },
      }),
    );
    expect(salesOrder.generatedFields.idempotencyKey).toEqual({
      kind: 'value-with-prefix',
      prefix: 'proforma:',
      value: { binding: 'actionTrancheProforma' },
    });
    expect(salesOrder.generatedFields.salesOrderNumber).toEqual({
      kind: 'timestamp-id',
      prefix: 'SO-',
      actionLocalCalendarYear: { separator: '-' },
      timestampEncoding: 'base36-upper',
    });
  });

  it('pins audit-only payloads and activation-secret DLP to signed contracts', () => {
    const byCapability = new Map(fixtures.map((fixture) => [fixture.capabilityId, fixture]));
    expect(byCapability.get('MobilePosLiteController.issueActivation')?.audit.payload).toEqual({
      severity: 'HIGH',
      oldValue: { literal: null },
      newValue: { literal: null },
      metadata: { literal: null },
      responseSecretsAbsent: [['activationCode']],
      forbiddenKeys: ['activationCode', 'activationPath'],
    });
    expect(byCapability.get('RecordBookController.auditExport')?.audit.payload).toEqual(
      expect.objectContaining({
        severity: 'MEDIUM',
        newValue: expect.objectContaining({ object: expect.any(Object) }),
      }),
    );
    expect(byCapability.get('SupplierOrderDraftsController.auditExport')?.audit.payload).toEqual(
      expect.objectContaining({
        severity: 'LOW',
        newValue: {
          object: {
            format: { literal: 'PDF' },
            draftNumber: {
              binding: 'model:SupplierOrderDraft',
              path: ['draftNumber'],
            },
          },
        },
      }),
    );
  });

  it('removes only these closed IDs from the aggregate blocker inventory', () => {
    const blockers = new Set(
      CRUD_MUTATION_EVIDENCE_BLOCKERS.map((blocker) => blocker.capabilityId),
    );
    expect(EXPECTED_IDS.filter((id) => blockers.has(id))).toEqual([]);
  });

  it('survives live-manifest filtering without silently dropping a fixture', () => {
    const registeredPacks = mutationEvidencePacksForManifest(manifest);
    const pack = registeredPacks.find(
      (candidate) => candidate.packId === CRUD_ACTION_TRANCHE_EVIDENCE_PACK.packId,
    );
    expect(pack).toBeDefined();
    expect(pack?.fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    const registeredTrancheIds = registeredPacks
      .flatMap((candidate) => candidate.fixtures)
      .map((fixture) => fixture.capabilityId)
      .filter((id) => (EXPECTED_IDS as readonly string[]).includes(id));
    expect(registeredTrancheIds.sort()).toEqual([...EXPECTED_IDS].sort());
  });
});

function assertCompleteCreateModel(
  modelName: string,
  fields: { expected: readonly string[]; generated: readonly string[]; allowed: readonly string[] },
) {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalarNames =
    model?.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => field.name)
      .sort() ?? [];
  expect([...fields.expected, ...fields.generated, ...fields.allowed].sort()).toEqual(scalarNames);
}
