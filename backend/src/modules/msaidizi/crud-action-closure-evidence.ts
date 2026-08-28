import { createHash } from 'node:crypto';
import { CRUD_MUTATION_GOVERNANCE } from './crud-evidence-governance';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationAuditContract,
  CrudMutationValue,
  crudMutationAuditScopeKind,
} from './crud-mutation-evidence';

type FixtureDefinition = Omit<
  CrudMutationAnyFixtureRegistration,
  'audit' | 'controlKind' | 'description' | 'fixtureId' | 'fixtureVersion' | 'governance' | 'packId'
> & {
  audit: Omit<CrudMutationAuditContract, 'scopeKind'>;
  description: string;
};

const PACK_ID = 'mutation-action-closure-second-tranche';
const ASSIGNMENT_START = '2031-01-01T00:00:00.000Z';
const DEPRECIATION_START = '2031-02-01T00:00:00.000Z';

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const idOf = (model: string): CrudMutationValue => binding(`model:${model}`);
const companyA = binding('companyA');
const companyB = binding('companyB');
const userA = binding('userA');
const nowIso: CrudMutationValue = { now: 'iso' };

const stockAdjustment = binding('actionClosureStockAdjustment');
const depreciationSchedule = binding('actionClosureDepreciationSchedule');
const companyACacheEntry = binding('actionClosureCacheCompanyA');
const companyBCacheEntry = binding('actionClosureCacheCompanyB');

const cacheFields = (recordBinding: string) => ({
  cacheKey: binding(recordBinding, ['cacheKey']),
  companyId: binding(recordBinding, ['companyId']),
  scopeHash: binding(recordBinding, ['scopeHash']),
  cacheType: binding(recordBinding, ['cacheType']),
  value: binding(recordBinding, ['value']),
  expiresAt: binding(recordBinding, ['expiresAt']),
});

const definitions: readonly FixtureDefinition[] = [
  {
    capabilityId: 'StockAdjustmentsController.post',
    operation: 'action',
    description:
      'Post one isolated, branch-bound APPROVED stock adjustment with exactly zero lines, prove only its POSTED actor/time transition and attributable company audit, then restore the header.',
    request: { path: { id: stockAdjustment } },
    target: { model: 'StockAdjustment', id: stockAdjustment },
    preState: {
      model: 'StockAdjustment',
      id: stockAdjustment,
      fields: {
        branchId: binding('actionClosureStockAdjustment', ['branchId']),
        deletedAt: literal(null),
        postedAt: literal(null),
        postedById: literal(null),
        status: literal('APPROVED'),
      },
    },
    effect: {
      kind: 'transition',
      model: 'StockAdjustment',
      id: stockAdjustment,
      expectedFields: {
        postedAt: nowIso,
        postedById: userA,
        status: literal('POSTED'),
      },
      forbiddenFields: ['approvedAt', 'approvedById', 'branchId', 'deletedAt'],
      allowedFields: ['updatedAt'],
    },
    audit: {
      required: true,
      action: 'STOCK_ADJUSTMENT_POST',
      entityType: 'StockAdjustment',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'EmployeeAssignmentsController.create',
    operation: 'create',
    description:
      'Create one explicitly non-primary assignment for an existing same-company employee with no division transfer, prove the complete persisted scalar closure and resolved company audit, then delete only the created assignment.',
    setupModels: ['Employee'],
    request: {
      body: {
        employeeId: idOf('Employee'),
        companyId: companyA,
        startDate: literal(ASSIGNMENT_START),
        isPrimary: literal(false),
      },
    },
    preState: {
      model: 'Employee',
      id: idOf('Employee'),
      fields: {
        companyId: companyA,
        divisionId: literal(null),
        deletedAt: literal(null),
      },
    },
    effect: {
      kind: 'create',
      model: 'EmployeeAssignment',
      responseIdPath: ['id'],
      companyPath: ['companyId'],
      expectedFields: {
        employeeId: idOf('Employee'),
        companyId: companyA,
        startDate: literal(ASSIGNMENT_START),
        isPrimary: literal(false),
      },
      generatedFields: {
        divisionId: { kind: 'exact', value: literal(null) },
        branchId: { kind: 'exact', value: literal(null) },
        licensedBusinessUnitId: { kind: 'exact', value: literal(null) },
        departmentId: { kind: 'exact', value: literal(null) },
        positionId: { kind: 'exact', value: literal(null) },
        assignmentContextType: { kind: 'exact', value: literal('COMPANY') },
        assignmentContextId: { kind: 'exact', value: literal(null) },
        endDate: { kind: 'exact', value: literal(null) },
        status: { kind: 'exact', value: literal('ACTIVE') },
        approvalStatus: { kind: 'exact', value: literal('APPROVED') },
        transferRequestedById: { kind: 'exact', value: literal(null) },
        transferRequestedAt: { kind: 'exact', value: literal(null) },
        sourceDivisionApprovedById: { kind: 'exact', value: literal(null) },
        sourceDivisionApprovedAt: { kind: 'exact', value: literal(null) },
        targetDivisionApprovedById: { kind: 'exact', value: literal(null) },
        targetDivisionApprovedAt: { kind: 'exact', value: literal(null) },
        companyGmApprovedById: { kind: 'exact', value: literal(null) },
        companyGmApprovedAt: { kind: 'exact', value: literal(null) },
        groupHrApprovedById: { kind: 'exact', value: literal(null) },
        groupHrApprovedAt: { kind: 'exact', value: literal(null) },
        groupCfoApprovedById: { kind: 'exact', value: literal(null) },
        groupCfoApprovedAt: { kind: 'exact', value: literal(null) },
        notes: { kind: 'exact', value: literal(null) },
        deletedAt: { kind: 'exact', value: literal(null) },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'CREATE',
      entityType: 'EmployeeAssignment',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'DepreciationController.generateEntries',
    operation: 'action',
    description:
      'Generate exactly one straight-line DRAFT depreciation entry from an isolated zero-entry schedule, bind the additive response entry ID to a complete persisted scalar closure and schedule audit, then delete the created entry.',
    request: {
      path: { scheduleId: depreciationSchedule },
      body: { months: literal(1) },
    },
    target: { model: 'DepreciationSchedule', id: depreciationSchedule },
    preState: {
      model: 'DepreciationSchedule',
      id: depreciationSchedule,
      fields: {
        depreciationMethod: literal('STRAIGHT_LINE'),
        startDate: literal(DEPRECIATION_START),
        endDate: literal(null),
        usefulLifeMonths: literal(10),
        salvageValue: literal(0),
        depreciationRate: literal(null),
        totalDepreciableAmount: literal(1000),
        accumulatedDepreciation: literal(0),
        status: literal('ACTIVE'),
        deletedAt: literal(null),
      },
    },
    effect: {
      kind: 'create',
      model: 'DepreciationEntry',
      responseIdPath: ['entryIds', '0'],
      companyPath: ['companyId'],
      expectedFields: {},
      generatedFields: {
        depreciationScheduleId: { kind: 'exact', value: depreciationSchedule },
        companyId: { kind: 'exact', value: companyA },
        fixedAssetId: {
          kind: 'exact',
          value: binding('actionClosureDepreciationSchedule', ['fixedAssetId']),
        },
        depreciationDate: { kind: 'exact', value: literal(DEPRECIATION_START) },
        amount: { kind: 'exact', value: literal(100) },
        accumulatedDepreciationAfter: { kind: 'exact', value: literal(100) },
        journalEntryId: { kind: 'exact', value: literal(null) },
        status: { kind: 'exact', value: literal('DRAFT') },
        postedById: { kind: 'exact', value: literal(null) },
        postedAt: { kind: 'exact', value: literal(null) },
        deletedAt: { kind: 'exact', value: literal(null) },
      },
      allowedFields: ['id', 'createdAt', 'updatedAt'],
    },
    audit: {
      required: true,
      action: 'GENERATE',
      entityType: 'DepreciationSchedule',
      entityId: depreciationSchedule,
      companyId: { kind: 'exact', value: companyA },
    },
  },
  {
    capabilityId: 'CacheManagementController.remove',
    operation: 'delete',
    description:
      'Permanently remove the dedicated company-A cache row by exact ID, prove its complete business scalar state and the absence of same-model collateral deletion, attribute the company audit, then restore the row.',
    request: { path: { id: companyACacheEntry } },
    target: { model: 'CacheEntry', id: companyACacheEntry },
    preState: {
      model: 'CacheEntry',
      id: companyACacheEntry,
      fields: cacheFields('actionClosureCacheCompanyA'),
    },
    effect: {
      kind: 'delete',
      model: 'CacheEntry',
      id: companyACacheEntry,
      mode: 'hard',
      expectedFields: cacheFields('actionClosureCacheCompanyA'),
    },
    audit: {
      required: true,
      action: 'CACHE_ENTRY_INVALIDATED',
      entityType: 'CacheEntry',
      companyId: { kind: 'effect-company' },
    },
  },
  {
    capabilityId: 'CacheManagementController.invalidateByPrefix',
    operation: 'delete',
    description:
      'Invalidate the dedicated company-A cache row using its entire collision-proof cache key as the prefix, prove exactly that one hard deletion across the whole model, attribute the global audit, then restore the row.',
    request: {
      path: { prefix: binding('actionClosureCacheCompanyA', ['cacheKey']) },
    },
    target: { model: 'CacheEntry', id: companyACacheEntry },
    preState: {
      model: 'CacheEntry',
      id: companyACacheEntry,
      fields: cacheFields('actionClosureCacheCompanyA'),
    },
    effect: {
      kind: 'delete',
      model: 'CacheEntry',
      id: companyACacheEntry,
      mode: 'hard',
      expectedFields: cacheFields('actionClosureCacheCompanyA'),
    },
    audit: {
      required: true,
      action: 'CACHE_INVALIDATED_BY_PREFIX',
      entityType: 'CacheEntry',
      entityId: literal(null),
      companyId: { kind: 'exact', value: literal(null) },
    },
    executionPrincipal: 'group',
  },
  {
    capabilityId: 'CacheManagementController.invalidateByCompany',
    operation: 'delete',
    description:
      'Invalidate the sole dedicated company-B cache row under a group principal, prove exactly one hard deletion across the whole model and company-B audit scope, then restore the row.',
    request: { path: { companyId: companyB } },
    target: { model: 'CacheEntry', id: companyBCacheEntry },
    preState: {
      model: 'CacheEntry',
      id: companyBCacheEntry,
      fields: cacheFields('actionClosureCacheCompanyB'),
    },
    effect: {
      kind: 'delete',
      model: 'CacheEntry',
      id: companyBCacheEntry,
      mode: 'hard',
      expectedFields: cacheFields('actionClosureCacheCompanyB'),
    },
    audit: {
      required: true,
      action: 'CACHE_INVALIDATED_BY_COMPANY',
      entityType: 'CacheEntry',
      entityId: literal(null),
      companyId: { kind: 'exact', value: companyB },
    },
    executionPrincipal: 'group',
  },
];

export const CRUD_ACTION_CLOSURE_REQUIRED_BINDINGS = Object.freeze([
  'actionClosureStockAdjustment',
  'actionClosureDepreciationSchedule',
  'actionClosureCacheCompanyA',
  'actionClosureCacheCompanyB',
] as const);

export const CRUD_ACTION_CLOSURE_CLOSED_IDS: readonly string[] = Object.freeze(
  definitions.map((definition) => definition.capabilityId),
);

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 76);
  return `mutation-closure-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

export const CRUD_ACTION_CLOSURE_EVIDENCE_PACK: CrudMutationAnyFixturePack = Object.freeze({
  packId: PACK_ID,
  packVersion: 1,
  fixtures: Object.freeze(
    definitions.map((definition) => {
      const scopeKind = crudMutationAuditScopeKind(definition.audit.companyId);
      return Object.freeze({
        ...definition,
        audit: Object.freeze({
          ...definition.audit,
          scopeKind,
          attributionStatus: definition.audit.attributionStatus ?? 'EXPLICIT',
        }),
        controlKind: 'positive' as const,
        fixtureId: fixtureId(definition.capabilityId),
        fixtureVersion: 1 as const,
        governance: CRUD_MUTATION_GOVERNANCE,
        packId: PACK_ID,
      });
    }),
  ),
});
