import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_NEXT_ACTION_CLOSED_IDS,
  CRUD_NEXT_ACTION_EVIDENCE_PACK,
} from './crud-next-action-evidence';
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
  'CreditNotesController.void',
  'DisbursementsController.generate',
  'FixedAssetsController.dispose',
  'PayablesController.writeOff',
  'PurchaseOrdersController.receive',
  'ReceivablesController.writeOff',
] as const;

const EXPECTED_PERMISSIONS: Readonly<Record<(typeof EXPECTED_IDS)[number], string>> = {
  'CreditNotesController.void': 'receivables.manage',
  'DisbursementsController.generate': 'payroll.pay',
  'FixedAssetsController.dispose': 'fixed-assets.update',
  'PayablesController.writeOff': 'payables.manage',
  'PurchaseOrdersController.receive': 'purchases.receive',
  'ReceivablesController.writeOff': 'receivables.manage',
};

describe('next bounded finance and operations mutation evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_NEXT_ACTION_EVIDENCE_PACK.fixtures;

  it('registers exactly the six reserved operations as action controls', () => {
    expect([...CRUD_NEXT_ACTION_CLOSED_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(6);
    expect(fixtures.every((fixture) => fixture.operation === 'action')).toBe(true);
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
  });

  it('binds every fixture to the exact strict live manifest envelope and permission', () => {
    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;

      expect(capability.verb).not.toBe('GET');
      expect(capability.agentExcluded).toBe(false);
      expect(capability.permissions).toEqual([
        EXPECTED_PERMISSIONS[fixture.capabilityId as (typeof EXPECTED_IDS)[number]],
      ]);
      expect(capability.anyPermissions).toEqual([]);
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
      expect(capability.params.bodySchema?.schema.additionalProperties).toBe(false);
      const schema = capability.params.bodySchema!.schema;
      const bodyKeys = Object.keys(fixture.request.body ?? {});
      expect((schema.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
      expect(bodyKeys.filter((key) => !schema.properties[key])).toEqual([]);
    }
  });

  it('declares real Prisma fields, exact audit attribution, and deterministic recovery', () => {
    for (const fixture of fixtures) {
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
      expect(fixture.audit.required).toBe(true);
      expect(fixture.audit.scopeKind).toBe('COMPANY');

      for (const state of [
        ...(fixture.preState ? [fixture.preState] : []),
        ...(fixture.preStates ?? []),
      ]) {
        assertScalarFields(state.model, Object.keys(state.fields));
      }

      if (fixture.effect.kind === 'audit-only') {
        expect([...crudMutationAllowedModels(fixture.effect)].sort()).toEqual([
          'AuditLog',
          'AuditLogCompanyScope',
        ]);
        expect([...crudMutationBusinessDeltaModels(fixture.effect)]).toEqual([]);
        expect(crudMutationRecoveryPlan(fixture.effect)).toEqual([]);
        continue;
      }

      if (fixture.effect.kind === 'compound') {
        expect(fixture.capabilityId).toBe('PurchaseOrdersController.receive');
        for (const effect of fixture.effect.effects) {
          const fields =
            effect.kind === 'scoped-row-create'
              ? [
                  ...Object.keys(effect.expectedFields),
                  ...Object.keys(effect.generatedFields),
                  ...(effect.allowedFields ?? []),
                ]
              : effect.kind === 'row-update' || effect.kind === 'row-delete'
                ? Object.keys(effect.expectedFields)
                : [];
          assertScalarFields(effect.model, fields);
        }
        expect(crudMutationRecoveryPlan(fixture.effect)).toHaveLength(4);
        continue;
      }

      expect(fixture.effect.kind).toBe('transition');
      if (fixture.effect.kind !== 'transition') continue;
      assertScalarFields(fixture.effect.model, [
        ...Object.keys(fixture.effect.expectedFields),
        ...(fixture.effect.allowedFields ?? []),
      ]);
      expect([...crudMutationAllowedModels(fixture.effect)].sort()).toEqual(
        ['AuditLog', 'AuditLogCompanyScope', fixture.effect.model].sort(),
      );
      expect(crudMutationRecoveryPlan(fixture.effect)).toEqual([
        {
          source: 'effect',
          contractId: 'primary',
          model: fixture.effect.model,
          recovery: 'restore-row',
          recoveryOrder: 0,
        },
      ]);
    }
  });

  it('pins each bounded branch so ledger, child, and projection paths remain outside authority', () => {
    expect(fixture('DisbursementsController.generate')).toMatchObject({
      preState: { fields: { deletedAt: { literal: null }, status: { literal: 'CALCULATED' } } },
      effect: { kind: 'audit-only', model: 'PayrollRun', expectedFields: {} },
      audit: {
        action: 'PAYROLL_DISBURSEMENT_FILES_GENERATED',
        entityType: 'PayrollRun',
        companyId: { kind: 'exact', value: { binding: 'companyA' } },
      },
    });

    expect(fixture('CreditNotesController.void')).toMatchObject({
      preState: {
        fields: {
          appliedAmount: { literal: 0 },
          journalEntryId: { literal: null },
          receivableId: { literal: null },
          status: { literal: 'ISSUED' },
        },
      },
      effect: {
        kind: 'transition',
        model: 'CreditNote',
        expectedFields: { status: { literal: 'VOID' } },
        allowedFields: ['updatedAt'],
      },
    });

    expect(fixture('FixedAssetsController.dispose')).toMatchObject({
      executionPrincipal: 'group',
      preState: {
        fields: {
          companyId: { binding: 'companyA' },
          currentBookValue: { literal: 100 },
          disposalDate: { literal: null },
          disposalValue: { literal: null },
          groupId: { literal: null },
          ownershipLevel: { literal: 'COMPANY' },
          status: { literal: 'ACTIVE' },
        },
      },
      effect: {
        kind: 'transition',
        model: 'FixedAsset',
        expectedFields: {
          currentBookValue: { literal: 0 },
          disposalDate: { literal: '2031-07-01T00:00:00.000Z' },
          disposalValue: { literal: 25.5 },
          status: { literal: 'DISPOSED' },
        },
      },
      audit: { scopeKind: 'COMPANY' },
    });
    expect(capabilityRequiresSensitiveAccessAudit(byId.get('FixedAssetsController.dispose')!)).toBe(
      true,
    );

    for (const [capabilityId, model, relationshipField] of [
      ['PayablesController.writeOff', 'Payable', 'supplierId'],
      ['ReceivablesController.writeOff', 'Receivable', 'customerId'],
    ] as const) {
      expect(fixture(capabilityId)).toMatchObject({
        preState: {
          fields: {
            [relationshipField]: { literal: null },
            notes: { literal: null },
            outstandingAmount: { literal: 0 },
            status: { literal: 'OPEN' },
          },
        },
        effect: {
          kind: 'transition',
          model,
          expectedFields: {
            notes: expect.objectContaining({ literal: expect.stringContaining('write-off') }),
            status: { literal: 'WRITTEN_OFF' },
          },
          allowedFields: ['updatedAt'],
        },
      });
    }

    expect(fixture('PurchaseOrdersController.receive')).toMatchObject({
      setupModels: [
        'Branch',
        'InventoryBalance',
        'Product',
        'PurchaseOrder',
        'PurchaseOrderLine',
        'UnitOfMeasure',
      ],
      request: { path: { id: { binding: 'model:PurchaseOrder' } }, body: {} },
      effect: {
        kind: 'compound',
        effects: expect.arrayContaining([
          expect.objectContaining({
            effectId: 'movement',
            kind: 'scoped-row-create',
            model: 'InventoryMovement',
            recovery: 'restore-scope',
          }),
          expect.objectContaining({
            effectId: 'inventoryBalance',
            kind: 'row-update',
            model: 'InventoryBalance',
            recovery: 'restore-row',
          }),
          expect.objectContaining({
            effectId: 'order',
            kind: 'row-update',
            model: 'PurchaseOrder',
            recovery: 'restore-row',
          }),
          expect.objectContaining({
            effectId: 'movementSequence',
            kind: 'scoped-row-create',
            model: 'DocumentNumberSequence',
            recovery: 'restore-scope',
          }),
        ]),
      },
      audit: {
        additionalAudits: [
          expect.objectContaining({
            action: 'INVENTORY_MOVEMENT_CREATE',
            entityType: 'InventoryMovement',
          }),
        ],
      },
    });
    const receive = fixture('PurchaseOrdersController.receive');
    expect([...crudMutationBusinessDeltaModels(receive.effect)].sort()).toEqual([
      'DocumentNumberSequence',
      'InventoryBalance',
      'InventoryMovement',
      'PurchaseOrder',
    ]);
    expect(crudMutationRecoveryPlan(receive.effect).map((entry) => entry.model)).toEqual([
      'InventoryMovement',
      'InventoryBalance',
      'PurchaseOrder',
      'DocumentNumberSequence',
    ]);

    const forbiddenModels = new Set([
      'Customer',
      'DocumentNumberSequence',
      'InventoryBalance',
      'InventoryMovement',
      'JournalEntry',
      'JournalEntryLine',
      'Payable',
      'Receivable',
      'Supplier',
    ]);
    for (const candidate of fixtures) {
      if (candidate.capabilityId === 'PurchaseOrdersController.receive') {
        expect(candidate.effect.kind).toBe('compound');
        continue;
      }
      if (candidate.effect.kind === 'audit-only') {
        expect([...crudMutationAllowedModels(candidate.effect)].sort()).toEqual([
          'AuditLog',
          'AuditLogCompanyScope',
        ]);
        continue;
      }
      expect(candidate.effect.kind).toBe('transition');
      if (candidate.effect.kind !== 'transition') continue;
      const primaryModel = candidate.effect.model;
      const unexpected = [...crudMutationAllowedModels(candidate.effect)].filter(
        (model) => forbiddenModels.has(model) && model !== primaryModel,
      );
      expect(unexpected).toEqual([]);
    }
  });

  it('survives aggregate manifest binding and removes only its reviewed blockers', () => {
    const aggregatePack = mutationEvidencePacksForManifest(manifest).find(
      (pack) => pack.packId === CRUD_NEXT_ACTION_EVIDENCE_PACK.packId,
    );
    expect(aggregatePack?.fixtures.map((fixture) => fixture.capabilityId)).toEqual(
      CRUD_NEXT_ACTION_EVIDENCE_PACK.fixtures.map((fixture) => fixture.capabilityId),
    );
    const blockerIds = new Set(
      CRUD_MUTATION_EVIDENCE_BLOCKERS.map((blocker) => blocker.capabilityId),
    );
    expect(CRUD_NEXT_ACTION_CLOSED_IDS.filter((id) => blockerIds.has(id))).toEqual([]);
  });

  function fixture(capabilityId: (typeof EXPECTED_IDS)[number]) {
    const found = fixtures.find((candidate) => candidate.capabilityId === capabilityId);
    expect(found).toBeDefined();
    return found!;
  }
});

function assertScalarFields(modelName: string, fields: readonly string[]): void {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalarFields = new Set(
    model?.fields.filter((field) => field.kind !== 'object').map((field) => field.name) ?? [],
  );
  expect(fields.filter((field) => !scalarFields.has(field))).toEqual([]);
}
