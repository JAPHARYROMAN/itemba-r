import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK,
  CRUD_MUTATION_AUTONOMY_RELEASE_EXTERNAL_EXCLUSIONS,
  CRUD_MUTATION_AUTONOMY_RELEASE_POSITIVE_IDS,
} from './crud-mutation-autonomy-release-evidence';
import {
  CrudMutationAnyFixtureRegistration,
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

interface PermissionContract {
  permissions: readonly string[];
  anyPermissions: readonly string[];
}

const EXPECTED_PERMISSIONS = {
  'DeliveryNotesController.create': {
    permissions: ['delivery_notes.create'],
    anyPermissions: [],
  },
  'PurchaseOrdersController.create': {
    permissions: ['purchases.create'],
    anyPermissions: [],
  },
  'QuotationsController.create': {
    permissions: ['quotations.create'],
    anyPermissions: [],
  },
  'SupplierInvoicesController.create': {
    permissions: ['supplier_invoices.create'],
    anyPermissions: [],
  },
  'StockAdjustmentsController.create': {
    permissions: ['inventory.adjustments.create'],
    anyPermissions: [],
  },
  'StockAdjustmentsController.update': {
    permissions: ['inventory.adjustments.create'],
    anyPermissions: [],
  },
  'TaxAutoApplyController.applySalesOrder': {
    permissions: ['finance.reports.view'],
    anyPermissions: [],
  },
  'TaxAutoApplyController.applyPurchaseOrder': {
    permissions: ['finance.reports.view'],
    anyPermissions: [],
  },
  'SupplierOrderDraftsController.create': {
    permissions: ['supplier_order_drafts.create'],
    anyPermissions: [],
  },
  'SupplierOrderDraftsController.update': {
    permissions: ['supplier_order_drafts.update'],
    anyPermissions: [],
  },
  'SupplierOrderDraftsController.duplicate': {
    permissions: ['supplier_order_drafts.create'],
    anyPermissions: [],
  },
  'RecordBookController.createDailySale': {
    permissions: ['record_book.create'],
    anyPermissions: [],
  },
  'RecordBookController.updateDailySale': {
    permissions: ['record_book.update'],
    anyPermissions: [],
  },
  'SalesOrdersController.create': {
    permissions: ['sales.create'],
    anyPermissions: [],
  },
  'SalesOrdersController.confirm': {
    permissions: ['sales.confirm'],
    anyPermissions: [],
  },
  'SalesOrdersController.quickSale': {
    permissions: ['sales.create'],
    anyPermissions: [],
  },
  'SalesOrdersController.mobilePosQuickSale': {
    permissions: [],
    anyPermissions: ['pos.create', 'sales.create'],
  },
  'QuotationsController.convertToSalesOrder': {
    permissions: ['quotations.convert'],
    anyPermissions: [],
  },
  'SupplierInvoicesController.approve': {
    permissions: ['supplier_invoices.approve'],
    anyPermissions: [],
  },
  'StockDamageController.post': {
    permissions: ['stock_damage.post'],
    anyPermissions: [],
  },
  'PayrollRunsController.calculate': {
    permissions: ['payroll.calculate'],
    anyPermissions: [],
  },
  'PayrollRunsController.approve': {
    permissions: ['payroll.approve'],
    anyPermissions: [],
  },
  'PayrollRunsController.pay': {
    permissions: ['payroll.pay'],
    anyPermissions: [],
  },
} as const satisfies Readonly<Record<string, PermissionContract>>;

type ExpectedId = keyof typeof EXPECTED_PERMISSIONS;
const EXPECTED_IDS = Object.keys(EXPECTED_PERMISSIONS) as ExpectedId[];

describe('standalone autonomy release positive mutation evidence tranche', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK.fixtures;

  it('provides exactly 23 executable positive controls for the requested 24-route tranche', () => {
    expect([...CRUD_MUTATION_AUTONOMY_RELEASE_POSITIVE_IDS].sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(fixtures.map((candidate) => candidate.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(fixtures).toHaveLength(23);
    expect(new Set(fixtures.map((candidate) => candidate.fixtureId)).size).toBe(23);
    expect(fixtures.every((candidate) => candidate.controlKind === 'positive')).toBe(true);

    const coverage = new Map(
      buildCrudCoverageReport(manifest).capabilities.map((entry) => [
        entry.capabilityId,
        entry.operation,
      ]),
    );
    for (const candidate of fixtures) {
      expect(candidate.operation).toBe(coverage.get(candidate.capabilityId));
    }
  });

  it('pins each executable route envelope, permission contract and strict request body', () => {
    for (const candidate of fixtures) {
      const capability = byId.get(candidate.capabilityId);
      expect(capability).toBeDefined();
      if (!capability) continue;
      const permissions = EXPECTED_PERMISSIONS[candidate.capabilityId as ExpectedId];
      expect(capability.verb).not.toBe('GET');
      expect(capability.agentExcluded).toBe(false);
      expect(capability.permissions).toEqual(permissions.permissions);
      expect(capability.anyPermissions).toEqual(permissions.anyPermissions);
      expect(Object.keys(candidate.request.path ?? {}).sort()).toEqual(
        [...capability.params.path].sort(),
      );
      expect(Object.keys(candidate.request.query ?? {}).sort()).toEqual(
        [...capability.params.query].sort(),
      );
      assertStrictRequestBody(candidate, capability);
    }
  });

  it('preserves emailPdf as a human route and records its sole exact agent exclusion', () => {
    expect(CRUD_MUTATION_AUTONOMY_RELEASE_EXTERNAL_EXCLUSIONS).toEqual([
      {
        capabilityId: 'SupplierOrderDraftsController.emailPdf',
        reason: 'external_egress_not_represented',
        detail:
          'The human route renders a PDF to the filesystem and sends it through SMTP; neither external effect has an exact transactional rollback or a recoverable evidence adapter.',
      },
    ]);
    const capability = byId.get('SupplierOrderDraftsController.emailPdf');
    expect(capability).toMatchObject({
      verb: 'POST',
      agentExcluded: true,
      agentExclusionReason: 'external_egress_not_represented',
      permissions: ['supplier_order_drafts.export'],
      anyPermissions: [],
      params: { path: ['id'], query: [], hasBody: true },
    });
    expect(capability?.params.bodySchema?.quality).toBe('strict');
    expect(capability?.params.bodySchema?.schema).toMatchObject({
      required: ['to'],
      additionalProperties: false,
    });
    expect(Object.keys(capability?.params.bodySchema?.schema.properties ?? {}).sort()).toEqual([
      'cc',
      'message',
      'subject',
      'to',
    ]);
  });

  it('uses closed scalar contracts and complete additive-row schemas', () => {
    const createClosureErrors: string[] = [];
    for (const candidate of fixtures) {
      expect(validateCrudMutationFixtureContract(candidate)).toEqual([]);
      for (const state of [
        ...(candidate.preState ? [candidate.preState] : []),
        ...(candidate.preStates ?? []),
      ]) {
        assertScalarFields(state.model, Object.keys(state.fields));
      }

      if (candidate.effect.kind === 'create') {
        createClosureErrors.push(
          ...completeCreateErrors(candidate.effect.model, {
            expected: Object.keys(candidate.effect.expectedFields),
            generated: Object.keys(candidate.effect.generatedFields),
            allowed: candidate.effect.allowedFields ?? [],
          }),
        );
      }
      if (candidate.effect.kind === 'compound') {
        for (const effect of candidate.effect.effects) {
          assertScalarFields(
            effect.model,
            effect.kind === 'scoped-row-create'
              ? [
                  ...Object.keys(effect.scope.equals),
                  ...effect.scope.identityFields,
                  ...Object.keys(effect.expectedFields),
                  ...Object.keys(effect.generatedFields),
                  ...(effect.allowedFields ?? []),
                ]
              : effect.kind === 'row-create'
                ? Object.keys(effect.expectedFields)
                : effect.kind === 'row-update' || effect.kind === 'row-delete'
                  ? [
                      ...Object.keys(effect.expectedFields),
                      ...(effect.kind === 'row-update' ? (effect.forbiddenFields ?? []) : []),
                    ]
                  : [...Object.keys(effect.scope.equals), ...effect.scope.identityFields],
          );
          if (effect.kind === 'scoped-row-create') {
            createClosureErrors.push(
              ...completeCreateErrors(effect.model, {
                expected: Object.keys(effect.expectedFields),
                generated: Object.keys(effect.generatedFields),
                allowed: effect.allowedFields ?? [],
              }),
            );
          }
        }
      }

      expect([...crudMutationAllowedModels(candidate.effect)].sort()).toEqual(
        [
          'AuditLog',
          'AuditLogCompanyScope',
          ...crudMutationBusinessDeltaModels(candidate.effect),
        ].sort(),
      );
    }
    expect(createClosureErrors).toEqual([]);
  });

  it('requires explicit primary/additional audits and a unique deterministic recovery plan', () => {
    for (const candidate of fixtures) {
      expect(candidate.audit).toMatchObject({ required: true, attributionStatus: 'EXPLICIT' });
      for (const audit of candidate.audit.additionalAudits ?? []) {
        expect(audit.attributionStatus).toBe('EXPLICIT');
        expect(audit.scopeKind).toBe('COMPANY');
      }
      const recovery = crudMutationRecoveryPlan(candidate.effect);
      expect(recovery.length).toBeGreaterThan(0);
      expect(new Set(recovery.map((item) => item.recoveryOrder)).size).toBe(recovery.length);
    }

    expect(additionalAuditInventory()).toEqual({
      'QuotationsController.convertToSalesOrder': [
        ['SALES_ORDER_CONFIRM', 'SalesOrder', 'COMPANY'],
      ],
      'SalesOrdersController.mobilePosQuickSale': [['SALES_ORDER_CREATE', 'SalesOrder', 'COMPANY']],
      'SalesOrdersController.quickSale': [['SALES_ORDER_CREATE', 'SalesOrder', 'COMPANY']],
      'StockDamageController.post': [['INVENTORY_MOVEMENT_CREATE', 'InventoryMovement', 'COMPANY']],
      'SupplierOrderDraftsController.duplicate': [
        ['SUPPLIER_ORDER_DRAFT_CREATE', 'SupplierOrderDraft', 'COMPANY'],
      ],
    });
  });

  it('isolates the three live procurement and payroll prerequisites without weakening effects', () => {
    const purchaseOrder = fixture('PurchaseOrdersController.create');
    expect(purchaseOrder.effect.kind).toBe('compound');
    if (purchaseOrder.effect.kind !== 'compound') throw new Error('purchase fixture drifted');
    expect(
      purchaseOrder.effect.effects.find((effect) => effect.effectId === 'purchaseOrder'),
    ).toMatchObject({ expectedFields: { supplierName: { literal: 'Fixture Supplier' } } });

    const supplierInvoice = fixture('SupplierInvoicesController.approve');
    expect(supplierInvoice.preStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: 'ChartOfAccount',
          id: { binding: 'autonomyInventoryChartOfAccountA' },
          fields: expect.objectContaining({ accountSubType: { literal: 'inventory_asset' } }),
        }),
      ]),
    );

    const payroll = fixture('PayrollRunsController.calculate');
    const payrollExclusions = (payroll.preStates ?? []).filter(
      (state) =>
        state.model === 'Employee' &&
        'binding' in state.id &&
        state.id.binding.startsWith('autonomyPayrollExcludedEmployee'),
    );
    expect(payrollExclusions).toEqual([
      expect.objectContaining({
        id: { binding: 'autonomyPayrollExcludedEmployeeOne' },
        fields: expect.objectContaining({ employmentStatus: { literal: 'INACTIVE' } }),
      }),
      expect.objectContaining({
        id: { binding: 'autonomyPayrollExcludedEmployeeTwo' },
        fields: expect.objectContaining({ employmentStatus: { literal: 'INACTIVE' } }),
      }),
    ]);
    expect(payroll.effect.kind).toBe('compound');
    if (payroll.effect.kind !== 'compound') throw new Error('payroll fixture drifted');
    expect(payroll.effect.effects.find((effect) => effect.effectId === 'entry')).toMatchObject({
      scope: {
        equals: {
          payrollRunId: { binding: 'autonomyPayrollCalculateRun' },
          employeeId: { binding: 'autonomyPayrollCalculateEmployee' },
        },
        identityFields: ['id'],
      },
    });
    for (const effectId of ['nssfFiling', 'payeFiling', 'wcfFiling']) {
      expect(payroll.effect.effects.find((effect) => effect.effectId === effectId)).toMatchObject({
        model: 'TaxFilingPeriod',
        generatedFields: {
          periodStart: {
            kind: 'utc-day-start',
            value: { literal: '2026-08-01T00:00:00.000Z' },
          },
          periodEnd: {
            kind: 'utc-day-end',
            value: { literal: '2026-08-31T00:00:00.000Z' },
          },
        },
      });
    }
  });

  it('finds a record-book create through a unique non-temporal closed scope', () => {
    const candidate = fixture('RecordBookController.createDailySale');
    expect(candidate.effect.kind).toBe('compound');
    if (candidate.effect.kind !== 'compound') throw new Error('record-book fixture drifted');
    expect(
      candidate.effect.effects.find((effect) => effect.effectId === 'dailySale'),
    ).toMatchObject({
      kind: 'scoped-row-create',
      scope: {
        equals: {
          companyId: { binding: 'companyA' },
          divisionId: { binding: 'divisionA' },
          branchId: { binding: 'branchA' },
          notes: { literal: 'fixture record-book sale' },
        },
        identityFields: ['id'],
      },
      generatedFields: {
        recordDate: {
          kind: 'local-day-start',
          value: { literal: '2026-08-25T12:00:00.000Z' },
        },
      },
    });
  });

  it('reconciles a supplier draft replacement line before restoring the deleted line snapshot', () => {
    const candidate = fixture('SupplierOrderDraftsController.update');
    expect(candidate.effect.kind).toBe('compound');
    if (candidate.effect.kind !== 'compound') throw new Error('supplier draft fixture drifted');

    expect(crudMutationRecoveryPlan(candidate.effect)).toEqual([
      expect.objectContaining({
        contractId: 'draft',
        model: 'SupplierOrderDraft',
        recovery: 'restore-row',
        recoveryOrder: 10,
      }),
      expect.objectContaining({
        contractId: 'newDraftLine',
        model: 'SupplierOrderDraftLine',
        recovery: 'restore-scope',
        recoveryOrder: 11,
      }),
      expect.objectContaining({
        contractId: 'oldDraftLine',
        model: 'SupplierOrderDraftLine',
        recovery: 'restore-row',
        recoveryOrder: 12,
      }),
    ]);
  });

  it('pins fixture-only tax enablement, exact tax audits and the one-row closed delta', () => {
    for (const capabilityId of [
      'TaxAutoApplyController.applyPurchaseOrder',
      'TaxAutoApplyController.applySalesOrder',
    ] as const) {
      const candidate = fixture(capabilityId);
      expect(candidate.testEnvironment).toEqual({ TAX_AUTO_APPLY: 'true' });
      expect(candidate.effect).toMatchObject({
        kind: 'compound',
        effects: [{ effectId: 'taxTransaction', model: 'TaxTransaction' }],
      });
      expect(candidate.effect.kind === 'compound' && candidate.effect.effects).toHaveLength(1);
      expect(candidate.audit).toMatchObject({
        action:
          capabilityId === 'TaxAutoApplyController.applySalesOrder'
            ? 'TAX_AUTO_APPLY_SALES_ORDER'
            : 'TAX_AUTO_APPLY_PURCHASE_ORDER',
        scopeKind: 'COMPANY',
      });
    }

    const valid = fixture('TaxAutoApplyController.applySalesOrder');
    if (valid.effect.kind !== 'compound') throw new Error('tax fixture contract drifted');
    const emptyNamedDelta = {
      ...valid,
      effect: { ...valid.effect, effects: [] },
    } as CrudMutationAnyFixtureRegistration;
    expect(validateCrudMutationFixtureContract(emptyNamedDelta)).toContain(
      'compound effects require at least one named effect',
    );
  });

  function fixture(capabilityId: ExpectedId): CrudMutationAnyFixtureRegistration {
    const found = fixtures.find((candidate) => candidate.capabilityId === capabilityId);
    expect(found).toBeDefined();
    return found!;
  }

  function additionalAuditInventory(): Record<string, Array<[string, string, string]>> {
    return Object.fromEntries(
      fixtures
        .filter((candidate) => (candidate.audit.additionalAudits?.length ?? 0) > 0)
        .map((candidate) => [
          candidate.capabilityId,
          candidate.audit.additionalAudits!.map((audit) => [
            audit.action,
            audit.entityType,
            audit.scopeKind,
          ]),
        ]),
    );
  }
});

function assertStrictRequestBody(
  fixture: CrudMutationAnyFixtureRegistration,
  capability: ReturnType<typeof extractCapabilities>[number],
): void {
  if (!capability.params.hasBody) {
    expect(fixture.request.body).toBeUndefined();
    return;
  }
  expect(capability.params.bodySchema?.quality).toBe('strict');
  expect(capability.params.bodySchema?.schema.additionalProperties).toBe(false);
  const schema = capability.params.bodySchema!.schema;
  const bodyKeys = Object.keys(fixture.request.body ?? {});
  expect((schema.required ?? []).filter((key) => !bodyKeys.includes(key))).toEqual([]);
  expect(bodyKeys.filter((key) => !schema.properties[key])).toEqual([]);
}

function assertScalarFields(modelName: string, fields: readonly string[]): void {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalars = new Set(
    model?.fields.filter((field) => field.kind !== 'object').map((field) => field.name) ?? [],
  );
  expect(fields.filter((field) => !scalars.has(field))).toEqual([]);
}

function completeCreateErrors(
  modelName: string,
  fields: { expected: readonly string[]; generated: readonly string[]; allowed: readonly string[] },
): string[] {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalars =
    model?.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => field.name)
      .sort() ?? [];
  const declared = [...fields.expected, ...fields.generated, ...fields.allowed].sort();
  const declaredSet = new Set(declared);
  const scalarSet = new Set(scalars);
  const missing = scalars.filter((field) => !declaredSet.has(field));
  const unknown = declared.filter((field) => !scalarSet.has(field));
  return missing.length === 0 && unknown.length === 0
    ? []
    : [`${modelName}: missing=[${missing.join(',')}] unknown=[${unknown.join(',')}]`];
}
