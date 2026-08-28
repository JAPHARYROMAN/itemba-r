import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_ACTION_CLOSURE_CLOSED_IDS,
  CRUD_ACTION_CLOSURE_EVIDENCE_PACK,
  CRUD_ACTION_CLOSURE_REQUIRED_BINDINGS,
} from './crud-action-closure-evidence';
import {
  crudMutationAllowedModels,
  crudMutationBusinessDeltaModels,
  crudMutationRecoveryPlan,
  validateCrudMutationFixtureContract,
} from './crud-mutation-evidence';

const EXPECTED_IDS = [
  'CacheManagementController.invalidateByCompany',
  'CacheManagementController.invalidateByPrefix',
  'CacheManagementController.remove',
  'DepreciationController.generateEntries',
  'EmployeeAssignmentsController.create',
  'StockAdjustmentsController.post',
] as const;

const EXPECTED_PERMISSIONS: Readonly<Record<(typeof EXPECTED_IDS)[number], string>> = {
  'CacheManagementController.invalidateByCompany': 'cache.invalidate',
  'CacheManagementController.invalidateByPrefix': 'cache.invalidate',
  'CacheManagementController.remove': 'cache.invalidate',
  'DepreciationController.generateEntries': 'depreciation.create',
  'EmployeeAssignmentsController.create': 'employees.assignments.manage',
  'StockAdjustmentsController.post': 'inventory.adjustments.post',
};

const EXPECTED_MODELS: Readonly<Record<(typeof EXPECTED_IDS)[number], string>> = {
  'CacheManagementController.invalidateByCompany': 'CacheEntry',
  'CacheManagementController.invalidateByPrefix': 'CacheEntry',
  'CacheManagementController.remove': 'CacheEntry',
  'DepreciationController.generateEntries': 'DepreciationEntry',
  'EmployeeAssignmentsController.create': 'EmployeeAssignment',
  'StockAdjustmentsController.post': 'StockAdjustment',
};

describe('second standalone action-closure mutation evidence pack', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_ACTION_CLOSURE_EVIDENCE_PACK.fixtures;

  it('contains exactly the six reserved controls and matches coverage classification', () => {
    expect([...CRUD_ACTION_CLOSURE_CLOSED_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...EXPECTED_IDS].sort(),
    );
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(6);
    expect(fixtures.filter((fixture) => fixture.operation === 'action')).toHaveLength(2);
    expect(fixtures.filter((fixture) => fixture.operation === 'create')).toHaveLength(1);
    expect(fixtures.filter((fixture) => fixture.operation === 'delete')).toHaveLength(3);

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

  it('binds every control to its exact live envelope, permission, and strict DTO schema', () => {
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

    const assignmentSchema = byId.get('EmployeeAssignmentsController.create')!.params.bodySchema!
      .schema;
    expect([...(assignmentSchema.required ?? [])].sort()).toEqual([
      'companyId',
      'employeeId',
      'startDate',
    ]);
    expect(assignmentSchema.properties.createdById).toBeUndefined();
    expect(assignmentSchema.properties.isPrimary).toMatchObject({ type: 'boolean' });

    const generationSchema = byId.get('DepreciationController.generateEntries')!.params.bodySchema!
      .schema;
    expect(generationSchema.required ?? []).toEqual([]);
    expect(generationSchema.properties).toEqual({
      months: expect.objectContaining({ type: 'number' }),
    });
  });

  it('declares only real Prisma scalars with complete create closures', () => {
    for (const fixture of fixtures) {
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
      for (const state of [
        ...(fixture.preState ? [fixture.preState] : []),
        ...(fixture.preStates ?? []),
      ]) {
        assertScalarFields(state.model, Object.keys(state.fields));
      }

      if (fixture.effect.kind === 'create') {
        assertCompleteCreateModel(fixture.effect.model, {
          expected: Object.keys(fixture.effect.expectedFields),
          generated: Object.keys(fixture.effect.generatedFields),
          allowed: fixture.effect.allowedFields ?? [],
        });
      } else if (fixture.effect.kind !== 'compound' && fixture.effect.kind !== 'audit-only') {
        assertScalarFields(fixture.effect.model, [
          ...Object.keys(fixture.effect.expectedFields),
          ...(fixture.effect.allowedFields ?? []),
          ...('forbiddenFields' in fixture.effect ? (fixture.effect.forbiddenFields ?? []) : []),
        ]);
      }

      expect([...crudMutationAllowedModels(fixture.effect)].sort()).toEqual(
        [
          'AuditLog',
          'AuditLogCompanyScope',
          ...crudMutationBusinessDeltaModels(fixture.effect),
        ].sort(),
      );
      expect([...crudMutationBusinessDeltaModels(fixture.effect)]).toEqual([
        EXPECTED_MODELS[fixture.capabilityId as (typeof EXPECTED_IDS)[number]],
      ]);
    }
  });

  it('pins the zero-line, same-company, straight-line, and collision-proof branches', () => {
    expect(fixture('StockAdjustmentsController.post')).toMatchObject({
      request: { path: { id: { binding: 'actionClosureStockAdjustment' } } },
      preState: {
        fields: {
          branchId: { binding: 'actionClosureStockAdjustment', path: ['branchId'] },
          deletedAt: { literal: null },
          postedAt: { literal: null },
          postedById: { literal: null },
          status: { literal: 'APPROVED' },
        },
      },
      effect: {
        kind: 'transition',
        expectedFields: {
          postedAt: { now: 'iso' },
          postedById: { binding: 'userA' },
          status: { literal: 'POSTED' },
        },
        forbiddenFields: ['approvedAt', 'approvedById', 'branchId', 'deletedAt'],
        allowedFields: ['updatedAt'],
      },
    });

    expect(fixture('EmployeeAssignmentsController.create')).toMatchObject({
      request: {
        body: {
          employeeId: { binding: 'model:Employee' },
          companyId: { binding: 'companyA' },
          isPrimary: { literal: false },
        },
      },
      preState: {
        model: 'Employee',
        fields: {
          companyId: { binding: 'companyA' },
          divisionId: { literal: null },
          deletedAt: { literal: null },
        },
      },
      effect: { kind: 'create', model: 'EmployeeAssignment' },
      audit: { action: 'CREATE', scopeKind: 'COMPANY' },
    });

    expect(fixture('DepreciationController.generateEntries')).toMatchObject({
      request: { body: { months: { literal: 1 } } },
      preState: {
        fields: {
          depreciationMethod: { literal: 'STRAIGHT_LINE' },
          usefulLifeMonths: { literal: 10 },
          totalDepreciableAmount: { literal: 1000 },
          accumulatedDepreciation: { literal: 0 },
        },
      },
      effect: {
        kind: 'create',
        model: 'DepreciationEntry',
        responseIdPath: ['entryIds', '0'],
        generatedFields: {
          amount: { kind: 'exact', value: { literal: 100 } },
          accumulatedDepreciationAfter: { kind: 'exact', value: { literal: 100 } },
          status: { kind: 'exact', value: { literal: 'DRAFT' } },
        },
      },
      audit: {
        action: 'GENERATE',
        entityType: 'DepreciationSchedule',
        entityId: { binding: 'actionClosureDepreciationSchedule' },
        scopeKind: 'COMPANY',
      },
    });

    expect(fixture('CacheManagementController.remove')).toMatchObject({
      request: { path: { id: { binding: 'actionClosureCacheCompanyA' } } },
      effect: { kind: 'delete', model: 'CacheEntry', mode: 'hard' },
      audit: { action: 'CACHE_ENTRY_INVALIDATED', scopeKind: 'COMPANY' },
    });
    expect(fixture('CacheManagementController.invalidateByPrefix')).toMatchObject({
      request: {
        path: {
          prefix: { binding: 'actionClosureCacheCompanyA', path: ['cacheKey'] },
        },
      },
      target: { id: { binding: 'actionClosureCacheCompanyA' } },
      effect: { kind: 'delete', model: 'CacheEntry', mode: 'hard' },
      audit: {
        action: 'CACHE_INVALIDATED_BY_PREFIX',
        entityId: { literal: null },
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'GLOBAL',
      },
      executionPrincipal: 'group',
    });
    expect(fixture('CacheManagementController.invalidateByCompany')).toMatchObject({
      request: { path: { companyId: { binding: 'companyB' } } },
      target: { id: { binding: 'actionClosureCacheCompanyB' } },
      effect: { kind: 'delete', model: 'CacheEntry', mode: 'hard' },
      audit: {
        action: 'CACHE_INVALIDATED_BY_COMPANY',
        entityId: { literal: null },
        companyId: { kind: 'exact', value: { binding: 'companyB' } },
        scopeKind: 'COMPANY',
      },
      executionPrincipal: 'group',
    });

    for (const capabilityId of [
      'CacheManagementController.remove',
      'CacheManagementController.invalidateByPrefix',
      'CacheManagementController.invalidateByCompany',
    ] as const) {
      const effect = fixture(capabilityId).effect;
      expect(effect.kind).toBe('delete');
      if (effect.kind !== 'delete') continue;
      expect(Object.keys(effect.expectedFields).sort()).toEqual([
        'cacheKey',
        'cacheType',
        'companyId',
        'expiresAt',
        'scopeHash',
        'value',
      ]);
    }
  });

  it('has exact audit contracts, deterministic recovery, and only four private bindings', () => {
    expect([...CRUD_ACTION_CLOSURE_REQUIRED_BINDINGS]).toEqual([
      'actionClosureStockAdjustment',
      'actionClosureDepreciationSchedule',
      'actionClosureCacheCompanyA',
      'actionClosureCacheCompanyB',
    ]);

    const expectedRecovery: Readonly<Record<(typeof EXPECTED_IDS)[number], string>> = {
      'CacheManagementController.invalidateByCompany': 'restore-row',
      'CacheManagementController.invalidateByPrefix': 'restore-row',
      'CacheManagementController.remove': 'restore-row',
      'DepreciationController.generateEntries': 'delete-created',
      'EmployeeAssignmentsController.create': 'delete-created',
      'StockAdjustmentsController.post': 'restore-row',
    };
    for (const candidate of fixtures) {
      expect(candidate.audit.required).toBe(true);
      expect(crudMutationRecoveryPlan(candidate.effect)).toEqual([
        expect.objectContaining({
          contractId: 'primary',
          model:
            candidate.effect.kind === 'compound' || candidate.effect.kind === 'audit-only'
              ? undefined
              : candidate.effect.model,
          recovery: expectedRecovery[candidate.capabilityId as (typeof EXPECTED_IDS)[number]],
          recoveryOrder: 0,
        }),
      ]);
    }

    expect(fixture('StockAdjustmentsController.post').audit).toEqual({
      required: true,
      action: 'STOCK_ADJUSTMENT_POST',
      entityType: 'StockAdjustment',
      companyId: { kind: 'effect-company' },
      scopeKind: 'COMPANY',
      attributionStatus: 'EXPLICIT',
    });
    expect(fixture('EmployeeAssignmentsController.create').audit).toEqual({
      required: true,
      action: 'CREATE',
      entityType: 'EmployeeAssignment',
      companyId: { kind: 'effect-company' },
      scopeKind: 'COMPANY',
      attributionStatus: 'EXPLICIT',
    });
    expect(fixture('DepreciationController.generateEntries').audit).toEqual({
      required: true,
      action: 'GENERATE',
      entityType: 'DepreciationSchedule',
      entityId: { binding: 'actionClosureDepreciationSchedule' },
      companyId: { kind: 'exact', value: { binding: 'companyA' } },
      scopeKind: 'COMPANY',
      attributionStatus: 'EXPLICIT',
    });
    expect(fixture('CacheManagementController.remove').audit).toEqual({
      required: true,
      action: 'CACHE_ENTRY_INVALIDATED',
      entityType: 'CacheEntry',
      companyId: { kind: 'effect-company' },
      scopeKind: 'COMPANY',
      attributionStatus: 'EXPLICIT',
    });
    expect(fixture('CacheManagementController.invalidateByPrefix').audit).toEqual({
      required: true,
      action: 'CACHE_INVALIDATED_BY_PREFIX',
      entityType: 'CacheEntry',
      entityId: { literal: null },
      companyId: { kind: 'exact', value: { literal: null } },
      scopeKind: 'GLOBAL',
      attributionStatus: 'EXPLICIT',
    });
    expect(fixture('CacheManagementController.invalidateByCompany').audit).toEqual({
      required: true,
      action: 'CACHE_INVALIDATED_BY_COMPANY',
      entityType: 'CacheEntry',
      entityId: { literal: null },
      companyId: { kind: 'exact', value: { binding: 'companyB' } },
      scopeKind: 'COMPANY',
      attributionStatus: 'EXPLICIT',
    });
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

function assertCompleteCreateModel(
  modelName: string,
  fields: { expected: readonly string[]; generated: readonly string[]; allowed: readonly string[] },
): void {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  expect(model).toBeDefined();
  const scalarFields =
    model?.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => field.name)
      .sort() ?? [];
  expect([...fields.expected, ...fields.generated, ...fields.allowed].sort()).toEqual(scalarFields);
}
