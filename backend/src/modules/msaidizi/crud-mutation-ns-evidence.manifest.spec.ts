import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_MUTATION_NS_BLOCKERS,
  CRUD_MUTATION_NS_EVIDENCE_PACKS,
} from './crud-mutation-ns-evidence';
import {
  CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK,
  CRUD_MUTATION_AUTONOMY_RELEASE_POSITIVE_IDS,
} from './crud-mutation-autonomy-release-evidence';
import {
  CrudMutationEffectValue,
  CrudMutationValue,
  crudMutationBusinessDeltaModels,
} from './crud-mutation-evidence';

const PRISMA_MODEL_BY_NAME = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
);
const PRISMA_ENUM_VALUES = new Map<string, ReadonlySet<string>>(
  Prisma.dmmf.datamodel.enums.map((definition) => [
    definition.name,
    new Set(definition.values.map((value) => value.name)),
  ]),
);

const ORIGINAL_BODY_SCHEMA_BLOCKERS = Object.freeze([
  'OfflineSyncController.resolveConflict',
  'OfflineSyncController.upsertCheckpoint',
  'PayrollRunsController.cancel',
  'PayrollRunsController.pay',
  'PostingRulesController.addLine',
  'PostingRulesController.create',
  'PostingRulesController.update',
  'PrintEngineController.render',
  'ProcurementPlansController.create',
  'ProcurementPlansController.update',
  'ProfitController.fixCostGap',
  'ProfitController.validateSaleLines',
  'PurchaseRequisitionsController.create',
  'PurchaseRequisitionsController.reject',
  'PurchaseRequisitionsController.update',
  'RfqsController.create',
  'RfqsController.send',
  'RfqsController.update',
  'RolesController.create',
  'RolesController.update',
  'SalaryAdvancesController.approve',
  'SalaryPaymentsController.reverse',
  'SalesCommissionsController.cancel',
  'SavedReportViewsController.create',
  'SavedReportViewsController.update',
  'ScheduledReportsController.create',
  'ScheduledReportsController.update',
  'SecurityEventsController.create',
  'SecurityEventsController.resolve',
  'SecurityEventsController.review',
  'SecurityPoliciesController.create',
  'SecurityPoliciesController.update',
  'StockAdjustmentsController.create',
  'StockAdjustmentsController.update',
  'SupplierQuotationsController.create',
  'SupplierQuotationsController.update',
]);

const REMEDIATED_BODY_SCHEMA_IDS = Object.freeze([
  'StockAdjustmentsController.create',
  'StockAdjustmentsController.update',
]);

describe('N-S mutation evidence against the live capability manifest', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const tranche = manifest
    .filter(
      (capability) =>
        /^[N-S]/.test(capability.controller) &&
        capability.verb !== 'GET' &&
        !capability.agentExcluded &&
        (capability.permissions.length > 0 || capability.anyPermissions.length > 0),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const fixtures = CRUD_MUTATION_NS_EVIDENCE_PACKS.flatMap((pack) => pack.fixtures);
  const capabilityById = new Map(manifest.map((capability) => [capability.id, capability]));
  const eligibleCapabilityIds = new Set(tranche.map((capability) => capability.id));
  const blockers = CRUD_MUTATION_NS_BLOCKERS.filter((blocker) =>
    eligibleCapabilityIds.has(blocker.capabilityId),
  );
  const remediatedBodySchemaFixtures = CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK.fixtures.filter(
    (fixture) => REMEDIATED_BODY_SCHEMA_IDS.includes(fixture.capabilityId),
  );

  it('partitions the exact live N-S mutation inventory across 50 controllers', () => {
    const registered = fixtures.map((fixture) => fixture.capabilityId);
    const blocked = blockers.map((blocker) => blocker.capabilityId);
    const remediated = remediatedBodySchemaFixtures.map((fixture) => fixture.capabilityId);
    const controllers = new Set(tranche.map((capability) => capability.controller));

    expect(tranche).toHaveLength(223);
    expect(controllers.size).toBe(50);
    expect(CRUD_MUTATION_NS_EVIDENCE_PACKS.map((pack) => pack.fixtures.length)).toEqual([
      48, 27, 29, 44, 28,
    ]);
    expect(registered).toHaveLength(176);
    expect(blocked).toHaveLength(45);
    expect(remediated.sort()).toEqual([...REMEDIATED_BODY_SCHEMA_IDS].sort());
    expect(blockers.filter((blocker) => blocker.reason === 'body_schema_not_strict')).toHaveLength(
      0,
    );
    expect(
      blockers.filter((blocker) => blocker.reason === 'audit_attribution_not_persisted'),
    ).toHaveLength(0);
    expect(
      blockers.filter((blocker) => blocker.reason === 'irreversible_without_recovery_control'),
    ).toHaveLength(5);
    expect(
      blockers.filter((blocker) => blocker.reason === 'exact_effect_not_represented'),
    ).toHaveLength(40);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(blocked).size).toBe(blocked.length);
    expect(new Set(remediated).size).toBe(remediated.length);
    expect(registered.filter((capabilityId) => blocked.includes(capabilityId))).toEqual([]);
    expect(remediated.filter((capabilityId) => blocked.includes(capabilityId))).toEqual([]);
    expect(remediated.filter((capabilityId) => registered.includes(capabilityId))).toEqual([]);
    expect(
      [...registered, ...blocked, ...remediated].sort((left, right) => left.localeCompare(right)),
    ).toEqual(tranche.map((capability) => capability.id));
    expect([...registered, ...blocked, ...remediated].filter((id) => !/^[N-S]/.test(id))).toEqual(
      [],
    );
  });

  it('proves mark-all-read as an exact actor-scoped two-row bulk transition', () => {
    const fixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'NotificationsController.markAllRead',
    );

    expect(fixture).toMatchObject({
      operation: 'action',
      request: {},
      audit: {
        action: 'NOTIFICATIONS_MARK_ALL_READ',
        entityType: 'Notification',
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'GLOBAL',
      },
      effect: {
        kind: 'compound',
        auditEntityId: { binding: 'userA' },
        effects: [
          {
            effectId: 'primaryNotification',
            kind: 'row-update',
            model: 'Notification',
            id: { binding: 'model:Notification' },
            expectedFields: {
              status: { literal: 'READ' },
              readAt: { now: 'iso' },
            },
          },
          {
            effectId: 'secondNotification',
            kind: 'row-update',
            model: 'Notification',
            id: { binding: 'notificationActorASecond' },
            expectedFields: {
              status: { literal: 'READ' },
              readAt: { now: 'iso' },
            },
          },
        ],
      },
    });
    expect(fixture?.preStates).toHaveLength(2);
    expect(fixture?.setupModels).toContain('Notification');
  });

  it('remediates every original schema blocker or preserves the exact conditional defect', () => {
    const registered = new Set([
      ...fixtures.map((fixture) => fixture.capabilityId),
      ...remediatedBodySchemaFixtures.map((fixture) => fixture.capabilityId),
    ]);
    const blockerById = new Map(blockers.map((blocker) => [blocker.capabilityId, blocker]));

    expect(ORIGINAL_BODY_SCHEMA_BLOCKERS).toHaveLength(36);
    for (const capabilityId of ORIGINAL_BODY_SCHEMA_BLOCKERS) {
      const capability = capabilityById.get(capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;

      const strictEnvelope =
        !capability.params.hasBody || capability.params.bodySchema?.quality === 'strict';
      const blocker = blockerById.get(capabilityId);
      if (strictEnvelope) {
        expect(registered.has(capabilityId) || blocker !== undefined).toBe(true);
        expect(blocker?.reason).not.toBe('body_schema_not_strict');
      } else {
        expect(blocker?.reason).toBe('body_schema_not_strict');
        expect(blocker?.detail).toContain('exact JSON envelope');
      }
    }

    expect(
      blockers
        .filter((blocker) => blocker.reason === 'body_schema_not_strict')
        .map((blocker) => blocker.capabilityId),
    ).toEqual([]);
    expect(
      REMEDIATED_BODY_SCHEMA_IDS.filter(
        (capabilityId) => !CRUD_MUTATION_AUTONOMY_RELEASE_POSITIVE_IDS.includes(capabilityId),
      ),
    ).toEqual([]);
  });

  it('binds every positive to the exact strict manifest envelope', () => {
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
        expect(fixture.request.body).toBeDefined();
        const schema = capability.params.bodySchema!.schema;
        const bodyKeys = Object.keys(fixture.request.body ?? {});
        expect((schema.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
        expect(bodyKeys.filter((key) => !schema.properties[key])).toEqual([]);
      } else {
        expect(fixture.request.body).toBeUndefined();
      }

      Object.values(fixture.request.path ?? {}).forEach(assertStrictValue);
      Object.values(fixture.request.query ?? {}).forEach(assertStrictValue);
      Object.values(fixture.request.body ?? {}).forEach(assertStrictValue);
    }
  });

  it('uses deterministic registrations and concrete Prisma seed/effect models', () => {
    const fixtureIds = new Set<string>();
    for (const pack of CRUD_MUTATION_NS_EVIDENCE_PACKS) {
      expect(pack.packId).toMatch(/^mutation-ns-[a-z0-9-]+$/);
      expect(pack.packVersion).toBe(1);
      for (const fixture of pack.fixtures) {
        const digest = createHash('sha256').update(fixture.capabilityId).digest('hex').slice(0, 12);
        expect(fixture.packId).toBe(pack.packId);
        expect(fixture.fixtureVersion).toBe(1);
        expect(fixture.controlKind).toBe('positive');
        expect(fixture.fixtureId).toMatch(new RegExp(`^mutation-ns-.+-${digest}$`));
        expect(fixtureIds.has(fixture.fixtureId)).toBe(false);
        fixtureIds.add(fixture.fixtureId);

        expect(fixture.audit.required).toBe(true);
        expect(fixture.audit.entityType).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
        expect(fixture.audit.action).toMatch(/^[A-Za-z0-9_.]+$/);
        expect(fixture.setupModels?.every((model) => PRISMA_MODEL_BY_NAME.has(model))).toBe(true);
        if (fixture.target) expect(PRISMA_MODEL_BY_NAME.has(fixture.target.model)).toBe(true);
        if (fixture.preState) {
          expect(PRISMA_MODEL_BY_NAME.has(fixture.preState.model)).toBe(true);
          assertModelValues(fixture.preState.model, fixture.preState.fields);
        }
        for (const preState of fixture.preStates ?? []) {
          expect(PRISMA_MODEL_BY_NAME.has(preState.model)).toBe(true);
          assertModelValues(preState.model, preState.fields);
        }

        if (fixture.effect.kind === 'compound') {
          const namedEffects = [
            ...fixture.effect.effects,
            ...(fixture.effect.allowedTableExceptions ?? []).map((exception) => exception.effect),
          ];
          expect(namedEffects.length).toBeGreaterThanOrEqual(2);
          for (const namedEffect of namedEffects) {
            const model = PRISMA_MODEL_BY_NAME.get(namedEffect.model);
            expect(model).toBeDefined();
            if (!model) continue;
            if (
              namedEffect.kind === 'row-create' ||
              namedEffect.kind === 'row-update' ||
              namedEffect.kind === 'row-delete'
            ) {
              assertModelValues(namedEffect.model, namedEffect.expectedFields);
            } else {
              for (const fieldName of [
                ...Object.keys(namedEffect.scope.equals),
                ...namedEffect.scope.identityFields,
              ]) {
                expect(model.fields.some((field) => field.name === fieldName)).toBe(true);
              }
            }
          }
          continue;
        }

        expect(PRISMA_MODEL_BY_NAME.has(fixture.effect.model)).toBe(true);

        if (fixture.effect.kind === 'create') {
          expect(fixture.operation).toBe('create');
          expect(fixture.effect.responseIdPath).toEqual(['id']);
          expect(
            PRISMA_MODEL_BY_NAME.get(fixture.effect.model)?.fields.some(
              (field) => field.name === 'id',
            ),
          ).toBe(true);
          for (const path of [fixture.effect.companyPath]) {
            if (!path?.length) continue;
            expect(
              PRISMA_MODEL_BY_NAME.get(fixture.effect.model)?.fields.some(
                (field) => field.name === path[0],
              ),
            ).toBe(true);
          }
        } else if (fixture.effect.kind === 'delete') {
          expect(fixture.operation).toBe('delete');
          expect(fixture.effect.mode).toBe('soft');
          expect(fixture.effect.deletedAtPath).toEqual(['deletedAt']);
          expect(
            PRISMA_MODEL_BY_NAME.get(fixture.effect.model)?.fields.some(
              (field) => field.name === 'deletedAt',
            ),
          ).toBe(true);
        } else {
          expect(Object.keys(fixture.effect.expectedFields).length).toBeGreaterThan(0);
          assertModelValues(fixture.effect.model, fixture.effect.expectedFields);
          const forbiddenFields =
            'forbiddenFields' in fixture.effect ? fixture.effect.forbiddenFields : undefined;
          for (const forbiddenField of forbiddenFields ?? []) {
            expect(
              PRISMA_MODEL_BY_NAME.get(fixture.effect.model)?.fields.some(
                (field) => field.name === forbiddenField,
              ),
            ).toBe(true);
          }
        }
      }
    }
  });

  it('keeps the payable request notes-only while declaring its derived supplier name', () => {
    const updateFixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'PayablesController.update',
    );
    expect(updateFixture?.operation).toBe('update');
    expect(updateFixture?.request.body).toEqual({
      notes: { unique: { prefix: 'Updated payable evidence' } },
    });
    expect(updateFixture?.effect).toMatchObject({
      kind: 'update',
      model: 'Payable',
      expectedFields: {
        notes: { unique: { prefix: 'Updated payable evidence' } },
        supplierName: { binding: 'model:Supplier', path: ['name'] },
      },
    });
    expect(updateFixture?.setupModels).toEqual(['Payable', 'Supplier']);

    const deleteFixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'PayablesController.remove',
    );
    expect(deleteFixture).toBeDefined();
    expect(deleteFixture?.operation).toBe('delete');
    expect(deleteFixture?.preState).toEqual({
      model: 'Supplier',
      id: { binding: 'model:Supplier' },
      fields: { currentBalance: { literal: 1 } },
    });
    expect(deleteFixture?.audit.companyId).toEqual({
      kind: 'exact',
      value: { binding: 'companyA' },
    });
    expect(deleteFixture?.effect).toEqual({
      kind: 'compound',
      effects: [
        expect.objectContaining({
          effectId: 'payable',
          kind: 'row-delete',
          model: 'Payable',
          expectedFields: {
            deletedAt: { now: 'iso' },
            updatedAt: { now: 'iso' },
          },
          recovery: 'restore-row',
          recoveryOrder: 20,
        }),
        expect.objectContaining({
          effectId: 'supplierBalance',
          kind: 'row-update',
          model: 'Supplier',
          expectedFields: {
            currentBalance: { literal: 0 },
            updatedAt: { now: 'iso' },
          },
          recovery: 'restore-row',
          recoveryOrder: 10,
        }),
      ],
      auditEntityId: { binding: 'model:Payable' },
    });
    expect(deleteFixture?.setupModels).toEqual(expect.arrayContaining(['Payable', 'Supplier']));
    if (deleteFixture?.effect.kind !== 'compound')
      throw new Error('payable delete is not compound');
    expect([...crudMutationBusinessDeltaModels(deleteFixture.effect)].sort()).toEqual([
      'Payable',
      'Supplier',
    ]);
  });

  it('keeps the receivable request notes-only while declaring its derived customer name', () => {
    const updateFixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'ReceivablesController.update',
    );
    expect(updateFixture?.operation).toBe('update');
    expect(updateFixture?.request.body).toEqual({
      notes: { unique: { prefix: 'Updated receivable evidence' } },
    });
    expect(updateFixture?.effect).toMatchObject({
      kind: 'update',
      model: 'Receivable',
      expectedFields: {
        notes: { unique: { prefix: 'Updated receivable evidence' } },
        customerName: { binding: 'model:Customer', path: ['name'] },
      },
    });
    expect(updateFixture?.setupModels).toEqual(['Customer', 'Receivable']);

    const deleteFixture = fixtures.find(
      (candidate) => candidate.capabilityId === 'ReceivablesController.remove',
    );
    expect(deleteFixture?.operation).toBe('delete');
    expect(deleteFixture?.request.path).toEqual({
      id: { binding: 'receivableRemoveTarget' },
    });
    expect(deleteFixture?.preState).toEqual({
      model: 'Customer',
      id: { binding: 'receivableRemoveCustomer' },
      fields: { currentBalance: { literal: 1 } },
    });
    expect(deleteFixture?.audit.companyId).toEqual({
      kind: 'exact',
      value: { binding: 'companyA' },
    });
    expect(deleteFixture?.effect).toEqual({
      kind: 'compound',
      effects: [
        expect.objectContaining({
          effectId: 'receivable',
          kind: 'row-delete',
          model: 'Receivable',
          id: { binding: 'receivableRemoveTarget' },
          expectedFields: { deletedAt: { now: 'iso' }, updatedAt: { now: 'iso' } },
          recovery: 'restore-row',
          recoveryOrder: 20,
        }),
        expect.objectContaining({
          effectId: 'customerBalance',
          kind: 'row-update',
          model: 'Customer',
          id: { binding: 'receivableRemoveCustomer' },
          expectedFields: {
            currentBalance: { literal: 0 },
            updatedAt: { now: 'iso' },
          },
          recovery: 'restore-row',
          recoveryOrder: 10,
        }),
      ],
      auditEntityId: { binding: 'receivableRemoveTarget' },
    });
    if (deleteFixture?.effect.kind !== 'compound') {
      throw new Error('receivable delete is not compound');
    }
    expect([...crudMutationBusinessDeltaModels(deleteFixture.effect)].sort()).toEqual([
      'Customer',
      'Receivable',
    ]);
    expect(deleteFixture?.setupModels).toEqual(expect.arrayContaining(['Customer', 'Receivable']));
  });

  it('isolates the category delete target and declares every soft-delete side field', () => {
    const category = fixtures.find(
      (fixture) => fixture.capabilityId === 'ProductCategoriesController.remove',
    );
    expect(category).toMatchObject({
      request: { path: { id: { binding: 'productCategoryDelete' } } },
      target: { model: 'ProductCategory', id: { binding: 'productCategoryDelete' } },
      effect: { id: { binding: 'productCategoryDelete' } },
    });

    for (const capabilityId of [
      'ProductsController.removeFamily',
      'RecordBookController.removeCategory',
    ]) {
      expect(fixtures.find((fixture) => fixture.capabilityId === capabilityId)).toMatchObject({
        preState: { fields: { isActive: { literal: true } } },
        effect: {
          kind: 'delete',
          expectedFields: {
            deletedAt: { now: 'iso' },
            isActive: { literal: false },
          },
        },
      });
    }

    for (const capabilityId of [
      'RecordBookController.removeDailySale',
      'RecordBookController.removeExpense',
    ]) {
      expect(fixtures.find((fixture) => fixture.capabilityId === capabilityId)).toMatchObject({
        preState: { fields: { updatedById: { literal: null } } },
        effect: {
          kind: 'delete',
          expectedFields: { updatedById: { binding: 'userA' } },
        },
      });
    }
  });

  it('pins OSHA expiry input and persistence to the database date boundary', () => {
    const registration = fixtures.find(
      (fixture) => fixture.capabilityId === 'OshaRegistrationsController.create',
    );
    if (registration?.effect.kind !== 'create') throw new Error('OSHA fixture drifted');
    const expectedFields = {
      branchId: { binding: 'model:Branch' },
      certificateNumber: { unique: { prefix: 'CE-OSHA' } },
      companyId: { binding: 'companyA' },
      expiresAt: { literal: '2031-12-31' },
    };
    expect(registration.request.body).toEqual(expectedFields);
    expect(registration.effect.expectedFields).toEqual(expectedFields);
  });

  it('uses reversible prerequisites for duplicate, controlled-link, and profitability guards', () => {
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'PeriodCloseController.create')?.preState,
    ).toEqual({
      model: 'AccountingPeriodClose',
      id: { binding: 'model:AccountingPeriodClose' },
      fields: { status: { literal: 'REOPENED' } },
    });
    expect(
      fixtures.find(
        (fixture) => fixture.capabilityId === 'PurchaseOrdersController.updateInvoiceReference',
      )?.preState,
    ).toEqual({
      model: 'SupplierInvoice',
      id: { binding: 'model:SupplierInvoice' },
      fields: { purchaseOrderId: { literal: null } },
    });
    const salesOrderUpdate = fixtures.find(
      (fixture) => fixture.capabilityId === 'SalesOrdersController.update',
    );
    expect(salesOrderUpdate?.preState).toEqual({
      model: 'SalesOrder',
      id: { binding: 'model:SalesOrder' },
      fields: {
        paymentMethod: { literal: 'CREDIT' },
        salesType: { literal: 'CASH_SALE' },
      },
    });
    expect(salesOrderUpdate?.preStates).toEqual([
      {
        model: 'SalesOrderLine',
        id: { binding: 'model:SalesOrderLine' },
        fields: { unitPrice: { literal: 100 } },
      },
    ]);
    expect(salesOrderUpdate?.effect).toMatchObject({
      kind: 'update',
      expectedFields: {
        notes: { unique: { prefix: 'Updated sales order evidence' } },
        paymentMethod: { literal: 'CASH' },
      },
      allowedFields: ['updatedAt'],
    });
  });

  it('declares service-owned and intentionally unchanged N-S fields exactly', () => {
    for (const capabilityId of [
      'PayrollRunsController.approveHr',
      'PayrollRunsController.approveFinance',
    ]) {
      const effect = fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.effect;
      expect(effect).toMatchObject({ forbiddenFields: ['status'] });
      if (effect?.kind === 'transition') {
        expect(effect.expectedFields).not.toHaveProperty('status');
      }
    }

    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'SupplierOrderDraftsController.reopen')
        ?.effect,
    ).toMatchObject({
      expectedFields: { status: { literal: 'DRAFT' }, cancelledAt: { literal: null } },
      forbiddenFields: ['acceptedAt', 'declinedAt', 'sentAt'],
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'RecordBookController.createExpense'),
    ).toMatchObject({
      request: { body: { recordDate: { literal: '2026-08-25T00:00:00.000Z' } } },
      effect: {
        expectedFields: { recordDate: { literal: '2026-08-24T21:00:00.000Z' } },
      },
    });
    for (const capabilityId of [
      'RecordBookController.updateExpense',
      'SuppliersController.update',
    ]) {
      expect(
        fixtures.find((fixture) => fixture.capabilityId === capabilityId)?.effect,
      ).toMatchObject({ expectedFields: { updatedById: { binding: 'userA' } } });
    }
  });

  it('uses dedicated create identities and a real group execution principal', () => {
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'SalesCommissionsController.create')
        ?.request.body,
    ).toMatchObject({ employeeId: { binding: 'salesCommissionCreateEmployee' } });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'SupplierPerformanceController.create'),
    ).toMatchObject({
      request: { body: { supplierId: { binding: 'supplierPerformanceCreateSupplier' } } },
      effect: {
        generatedFields: {
          lastReviewedAt: { kind: 'action-time' },
          reviewedById: { kind: 'exact', value: { binding: 'userA' } },
        },
      },
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'SupplierPerformanceController.update'),
    ).toMatchObject({
      request: {
        body: {
          companyId: { binding: 'companyA' },
          supplierId: { binding: 'model:Supplier' },
        },
      },
      effect: {
        expectedFields: {
          lastReviewedAt: { now: 'iso' },
          reviewedById: { binding: 'userA' },
        },
      },
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'PermissionsController.create'),
    ).toMatchObject({ executionPrincipal: 'group' });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'PriceListsController.addItem')?.request
        .body,
    ).toMatchObject({ minimumQuantity: { literal: 0 } });
  });

  it('binds package movements only to ReturnablePackage in schema and migration', () => {
    const schema = readFileSync(
      resolve(__dirname, '../../../../database/prisma/schema.prisma'),
      'utf8',
    );
    const packageMovement = schema.match(/model PackageMovement \{([\s\S]*?)\n\}/)?.[1];
    const unitOfMeasure = schema.match(/model UnitOfMeasure \{([\s\S]*?)\n\}/)?.[1];
    expect(packageMovement).toContain(
      'returnablePackage ReturnablePackage? @relation(fields: [returnablePackageId]',
    );
    expect(packageMovement).not.toMatch(/\bunit\s+UnitOfMeasure/);
    expect(unitOfMeasure).not.toContain('PackageMovement_unit_fk');
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'PackageMovementsController.create')
        ?.request.body,
    ).toMatchObject({ returnablePackageId: { binding: 'model:ReturnablePackage' } });

    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../../database/prisma/migrations/20260825360000_drop_package_movement_unit_fk/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "PackageMovement_unit_fk"');
    expect(migration).not.toContain('package_movements_returnablePackageId_fkey');
  });

  it('keeps every blocker precise, machine readable, and tied to the live route defect', () => {
    for (const blocker of CRUD_MUTATION_NS_BLOCKERS) {
      const capability = capabilityById.get(blocker.capabilityId);
      expect(capability).toBeDefined();
      expect(blocker.detail).toContain(blocker.capabilityId);
      expect(blocker.detail.length).toBeGreaterThan(40);
      if (blocker.reason === 'body_schema_not_strict') {
        expect(capability?.params.hasBody).toBe(true);
        expect(capability?.params.bodySchema?.quality).not.toBe('strict');
      }
    }
  });
});

function assertStrictValue(value: CrudMutationValue): void {
  const keys = Object.keys(value);
  expect(keys).toHaveLength(1);
  const key = keys[0];
  expect(['literal', 'binding', 'unique', 'now', 'array', 'object']).toContain(key);
  if ('binding' in value) {
    expect(value.binding).toMatch(/^[A-Za-z][A-Za-z0-9:]*$/);
  } else if ('unique' in value) {
    expect(value.unique.prefix).toMatch(/^[A-Za-z0-9 _.-]{1,64}$/);
  } else if ('array' in value) {
    value.array.forEach(assertStrictValue);
  } else if ('object' in value) {
    Object.values(value.object).forEach(assertStrictValue);
  }
}

function assertModelValues(
  modelName: string,
  values: Readonly<Record<string, CrudMutationEffectValue>>,
): void {
  const model = PRISMA_MODEL_BY_NAME.get(modelName);
  expect(model).toBeDefined();
  if (!model) return;

  for (const [fieldName, value] of Object.entries(values)) {
    const field = model.fields.find((candidate) => candidate.name === fieldName);
    expect(field).toBeDefined();
    if (!field || field.kind !== 'enum' || !('literal' in value) || value.literal === null) {
      continue;
    }
    expect(PRISMA_ENUM_VALUES.get(field.type)?.has(String(value.literal))).toBe(true);
  }
}
