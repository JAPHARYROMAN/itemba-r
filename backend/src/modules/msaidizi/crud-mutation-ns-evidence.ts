import { createHash } from 'node:crypto';
import {
  CrudMutationAnyFixturePack,
  CrudMutationAnyFixtureRegistration,
  CrudMutationBlocker,
  CrudMutationAuditContract,
  CrudMutationEffectValue,
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
type FixtureDefinition = Omit<
  CrudMutationAnyFixtureRegistration,
  'audit' | 'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> & {
  audit: Omit<CrudMutationAuditContract, 'companyId'> &
    Partial<Pick<CrudMutationAuditContract, 'companyId'>>;
  description?: string;
};

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const unique = (prefix: string): CrudMutationValue => ({ unique: { prefix } });
const object = (value: ValueMap): CrudMutationValue => ({ object: value });
const nowIso: CrudMutationValue = { now: 'iso' };

const companyA = binding('companyA');
const userA = binding('userA');
const divisionA = binding('divisionA');
const branchA = binding('branchA');
const accountingPeriodA = binding('accountingPeriodA');
const debitAccountA = binding('debitChartOfAccountA');
const creditAccountA = binding('creditChartOfAccountA');
const notificationActorASecond = binding('notificationActorASecond');
const receivableRemoveCustomer = binding('receivableRemoveCustomer');
const receivableRemoveTarget = binding('receivableRemoveTarget');
const idOf = (model: string) => binding(`model:${model}`);
const pathId = (model: string): ValueMap => ({ id: idOf(model) });
const effectRef = (effectId: string): CrudMutationEffectValue => ({ effectRef: { effectId } });

const REVIEWED_AUDIT_COMPANY: Readonly<Record<string, CrudMutationAuditContract['companyId']>> =
  Object.freeze({
    'OfflineSyncController.resolveConflict': { kind: 'exact', value: companyA },
    'PostingRulesController.addLine': { kind: 'exact', value: companyA },
    'PriceListsController.addItem': { kind: 'exact', value: companyA },
    'PriceListsController.updateItem': { kind: 'exact', value: companyA },
    'PermissionsController.create': { kind: 'exact', value: literal(null) },
    'RolesController.create': { kind: 'exact', value: literal(null) },
    'RolesController.update': { kind: 'exact', value: literal(null) },
    'StatutoryDeductionRulesController.create': { kind: 'exact', value: literal(null) },
  });

function createFixture(
  capabilityId: string,
  model: string,
  body: ValueMap,
  action: string,
  entityType = model,
  options: {
    path?: ValueMap;
    companyPath?: readonly string[];
    executionPrincipal?: 'company' | 'group';
    description?: string;
    preState?: { model: string; id: CrudMutationValue; fields: ValueMap };
    persistedFields?: ValueMap;
  } = {},
): FixtureDefinition {
  return {
    capabilityId,
    operation: 'create',
    request: { ...(options.path ? { path: options.path } : {}), body },
    effect: {
      kind: 'create',
      model,
      responseIdPath: ['id'],
      expectedFields: options.persistedFields ?? body,
      generatedFields: generatedFieldsForCapability(capabilityId),
      allowedFields: createFrameworkFieldsForModel(model),
      ...(options.companyPath ? { companyPath: options.companyPath } : {}),
    },
    audit: { required: true, action, entityType },
    ...(options.preState ? { preState: options.preState } : {}),
    ...(options.executionPrincipal ? { executionPrincipal: options.executionPrincipal } : {}),
    ...(options.description ? { description: options.description } : {}),
  };
}

function updateFixture(
  capabilityId: string,
  model: string,
  requestFields: ValueMap,
  action: string,
  entityType = model,
  preStateFields?: ValueMap,
  options: {
    additionalExpectedFields?: ValueMap;
    persistedFields?: ValueMap;
    preState?: { model: string; id: CrudMutationValue; fields: ValueMap };
    preStates?: NonNullable<FixtureDefinition['preStates']>;
  } = {},
): FixtureDefinition {
  const id = idOf(model);
  const expectedFields = options.persistedFields ?? {
    ...requestFields,
    ...options.additionalExpectedFields,
  };
  return {
    capabilityId,
    operation: 'update',
    request: { path: pathId(model), body: requestFields },
    target: { model, id },
    ...(options.preState
      ? { preState: options.preState }
      : preStateFields
        ? { preState: { model, id, fields: preStateFields } }
        : {}),
    ...(options.preStates ? { preStates: options.preStates } : {}),
    effect: { kind: 'update', model, id, expectedFields, allowedFields: ['updatedAt'] },
    audit: { required: true, action, entityType },
  };
}

function softDeleteFixture(
  capabilityId: string,
  model: string,
  action: string,
  entityType = model,
  preStateFields?: ValueMap,
  additionalExpectedFields?: ValueMap,
  id: CrudMutationValue = idOf(model),
): FixtureDefinition {
  return {
    capabilityId,
    operation: 'delete',
    request: { path: { id } },
    target: { model, id },
    ...(preStateFields ? { preState: { model, id, fields: preStateFields } } : {}),
    effect: {
      kind: 'delete',
      model,
      id,
      mode: 'soft',
      deletedAtPath: ['deletedAt'],
      expectedFields: { deletedAt: nowIso, ...additionalExpectedFields },
      allowedFields: ['updatedAt'],
    },
    audit: { required: true, action, entityType },
  };
}

function transitionFixture(
  capabilityId: string,
  model: string,
  expectedFields: ValueMap,
  action: string,
  entityType = model,
  options: {
    preState?: ValueMap;
    body?: ValueMap;
    path?: ValueMap;
    executionPrincipal?: 'company' | 'group';
    forbiddenFields?: readonly string[];
  } = {},
): FixtureDefinition {
  const id = idOf(model);
  return {
    capabilityId,
    operation: 'action',
    request: {
      path: options.path ?? pathId(model),
      ...(options.body ? { body: options.body } : {}),
    },
    target: { model, id },
    ...(options.preState ? { preState: { model, id, fields: options.preState } } : {}),
    effect: {
      kind: 'transition',
      model,
      id,
      expectedFields,
      allowedFields: ['updatedAt'],
      ...(options.forbiddenFields ? { forbiddenFields: options.forbiddenFields } : {}),
    },
    audit: { required: true, action, entityType },
    ...(options.executionPrincipal ? { executionPrincipal: options.executionPrincipal } : {}),
  };
}

const operationsDefinitions: readonly FixtureDefinition[] = [
  transitionFixture(
    'NotificationsController.markRead',
    'Notification',
    { status: literal('READ'), readAt: nowIso },
    'NOTIFICATION_MARK_READ',
    'Notification',
    { preState: { status: literal('UNREAD'), readAt: literal(null) } },
  ),
  transitionFixture(
    'NotificationsController.dismiss',
    'Notification',
    { status: literal('DISMISSED'), dismissedAt: nowIso },
    'NOTIFICATION_DISMISS',
    'Notification',
    { preState: { status: literal('UNREAD'), dismissedAt: literal(null) } },
  ),
  {
    capabilityId: 'NotificationsController.markAllRead',
    operation: 'action',
    request: {},
    preStates: [
      {
        model: 'Notification',
        id: idOf('Notification'),
        fields: {
          recipientUserId: userA,
          status: literal('UNREAD'),
          readAt: literal(null),
          dismissedAt: literal(null),
        },
      },
      {
        model: 'Notification',
        id: notificationActorASecond,
        fields: {
          recipientUserId: userA,
          status: literal('UNREAD'),
          readAt: literal(null),
          dismissedAt: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'primaryNotification',
          kind: 'row-update',
          model: 'Notification',
          id: idOf('Notification'),
          expectedFields: { status: literal('READ'), readAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'secondNotification',
          kind: 'row-update',
          model: 'Notification',
          id: notificationActorASecond,
          expectedFields: { status: literal('READ'), readAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: userA,
    },
    audit: {
      required: true,
      action: 'NOTIFICATIONS_MARK_ALL_READ',
      entityType: 'Notification',
      companyId: { kind: 'exact', value: literal(null) },
    },
    description:
      "Mark exactly the executing actor's two unread notifications as read while the compound model snapshot proves same-company actor-B rows remain unchanged.",
  },
  transitionFixture(
    'OfflineSyncController.resolveConflict',
    'OfflineSyncRecord',
    {
      status: literal('REJECTED'),
      conflictReason: literal('REJECT'),
      resolvedAt: nowIso,
      resolvedById: userA,
    },
    'SYNC_CONFLICT_RESOLVED',
    'OfflineSyncRecord',
    {
      preState: {
        status: literal('CONFLICT'),
        conflictReason: literal(null),
        resolvedAt: literal(null),
        resolvedById: literal(null),
      },
      body: { resolution: literal('REJECT') },
    },
  ),
  createFixture(
    'OfflineSyncController.upsertCheckpoint',
    'SyncCheckpoint',
    {
      companyId: companyA,
      entityType: unique('CRUD checkpoint entity'),
      lastSyncAt: literal('2026-08-25T12:00:00.000Z'),
    },
    'SYNC_CHECKPOINT_UPSERTED',
    'SyncCheckpoint',
    { companyPath: ['companyId'] },
  ),
  createFixture(
    'OshaRegistrationsController.create',
    'OshaRegistration',
    {
      branchId: idOf('Branch'),
      certificateNumber: unique('CE-OSHA'),
      companyId: companyA,
      expiresAt: literal('2031-12-31'),
    },
    'CREATE',
    'OshaRegistration',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'OshaRegistrationsController.update',
    'OshaRegistration',
    { notes: unique('Updated OSHA evidence') },
    'UPDATE',
  ),
  softDeleteFixture('OshaRegistrationsController.remove', 'OshaRegistration', 'DELETE'),
  createFixture(
    'PackageMovementsController.create',
    'PackageMovement',
    {
      companyId: companyA,
      movementDate: literal('2026-08-25T10:00:00.000Z'),
      movementType: literal('OTHER'),
      quantity: literal(1),
      returnablePackageId: idOf('ReturnablePackage'),
    },
    'PACKAGE_MOVEMENT_CREATE',
    'PackageMovement',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PayablesController.update',
    'Payable',
    { notes: unique('Updated payable evidence') },
    'PAYABLE_UPDATE',
    'Payable',
    undefined,
    {
      additionalExpectedFields: {
        supplierName: binding('model:Supplier', ['name']),
      },
    },
  ),
  {
    capabilityId: 'PayablesController.remove',
    operation: 'delete',
    request: { path: pathId('Payable') },
    preState: {
      model: 'Supplier',
      id: idOf('Supplier'),
      fields: { currentBalance: literal(1) },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'payable',
          kind: 'row-delete',
          model: 'Payable',
          id: idOf('Payable'),
          mode: 'soft',
          deletedAtPath: ['deletedAt'],
          expectedFields: { deletedAt: nowIso, updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'supplierBalance',
          kind: 'row-update',
          model: 'Supplier',
          id: idOf('Supplier'),
          expectedFields: { currentBalance: literal(0), updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: idOf('Payable'),
    },
    audit: {
      required: true,
      action: 'PAYABLE_DELETE',
      entityType: 'Payable',
      companyId: { kind: 'exact', value: companyA },
    },
    description:
      'Soft-delete a payable and prove the exact supplier balance projection refresh in the same recoverable transaction.',
  },
  createFixture(
    'PermissionsController.create',
    'Permission',
    {
      action: literal('execute'),
      code: unique('crud.permission'),
      description: unique('CRUD evidence permission'),
      module: literal('crud-evidence'),
    },
    'PERMISSION_CREATE',
    'Permission',
    { executionPrincipal: 'group' },
  ),
  updateFixture(
    'PayrollEntriesController.update',
    'PayrollEntry',
    { notes: unique('Updated payroll entry evidence') },
    'PAYROLL_ENTRY_UPDATE',
  ),
  createFixture(
    'PayrollPeriodsController.create',
    'PayrollPeriod',
    {
      companyId: companyA,
      createdById: userA,
      endDate: literal('2031-01-31T23:59:59.000Z'),
      name: unique('CRUD payroll period'),
      startDate: literal('2031-01-01T00:00:00.000Z'),
    },
    'CREATE',
    'PayrollPeriod',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PayrollPeriodsController.update',
    'PayrollPeriod',
    { name: unique('Updated payroll period') },
    'UPDATE',
  ),
  softDeleteFixture('PayrollPeriodsController.remove', 'PayrollPeriod', 'DELETE'),
  createFixture(
    'PayrollRunsController.create',
    'PayrollRun',
    {
      companyId: companyA,
      createdById: userA,
      payrollPeriodId: idOf('PayrollPeriod'),
    },
    'PAYROLL_RUN_CREATE',
    'PayrollRun',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PayrollRunsController.update',
    'PayrollRun',
    { notes: unique('Updated payroll run evidence') },
    'PAYROLL_RUN_UPDATE',
  ),
  transitionFixture(
    'PayrollRunsController.submit',
    'PayrollRun',
    { status: literal('SUBMITTED'), submittedAt: nowIso, submittedById: userA },
    'UPDATE',
    'PayrollRun',
    {
      preState: {
        status: literal('CALCULATED'),
        submittedAt: literal(null),
        submittedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'PayrollRunsController.approveHr',
    'PayrollRun',
    {
      hrApprovedAt: nowIso,
      hrApprovedById: userA,
    },
    'UPDATE',
    'PayrollRun',
    {
      preState: {
        status: literal('SUBMITTED'),
        hrApprovedAt: literal(null),
        hrApprovedById: literal(null),
        financeApprovedAt: literal(null),
        financeApprovedById: literal(null),
      },
      forbiddenFields: ['status'],
    },
  ),
  transitionFixture(
    'PayrollRunsController.approveFinance',
    'PayrollRun',
    {
      financeApprovedAt: nowIso,
      financeApprovedById: userA,
    },
    'UPDATE',
    'PayrollRun',
    {
      preState: {
        status: literal('SUBMITTED'),
        hrApprovedAt: literal(null),
        hrApprovedById: literal(null),
        financeApprovedAt: literal(null),
        financeApprovedById: literal(null),
      },
      forbiddenFields: ['status'],
    },
  ),
  transitionFixture(
    'PayrollRunsController.cancel',
    'PayrollRun',
    { status: literal('CANCELLED') },
    'UPDATE',
    'PayrollRun',
    {
      preState: {
        status: literal('DRAFT'),
        journalEntryId: literal(null),
        notes: literal(null),
      },
      body: {},
    },
  ),
  softDeleteFixture('PayrollRunsController.remove', 'PayrollRun', 'DELETE', 'PayrollRun', {
    status: literal('DRAFT'),
  }),
  createFixture(
    'PerformanceController.create',
    'PerformanceRecord',
    {
      companyId: companyA,
      employeeId: idOf('Employee'),
      performanceNumber: unique('CE-PERF'),
      reviewDate: literal('2026-08-25T00:00:00.000Z'),
      reviewerId: userA,
    },
    'CREATE',
    'PerformanceRecord',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PerformanceController.update',
    'PerformanceRecord',
    { recommendations: unique('Updated performance recommendation') },
    'UPDATE',
    'PerformanceRecord',
    { status: literal('DRAFT'), bonusAmount: literal(null) },
  ),
  softDeleteFixture('PerformanceController.remove', 'PerformanceRecord', 'DELETE'),
  createFixture(
    'PeriodCloseController.create',
    'AccountingPeriodClose',
    {
      accountingPeriodId: idOf('AccountingPeriod'),
      closeNumber: unique('CE-CLOSE'),
      companyId: companyA,
      fiscalYearId: idOf('FiscalYear'),
    },
    'CREATE',
    'AccountingPeriodClose',
    {
      companyPath: ['companyId'],
      preState: {
        model: 'AccountingPeriodClose',
        id: idOf('AccountingPeriodClose'),
        fields: { status: literal('REOPENED') },
      },
    },
  ),
  {
    capabilityId: 'PeriodCloseController.close',
    operation: 'action',
    request: { path: pathId('AccountingPeriodClose') },
    target: { model: 'AccountingPeriodClose', id: idOf('AccountingPeriodClose') },
    preStates: [
      {
        model: 'AccountingPeriodClose',
        id: idOf('AccountingPeriodClose'),
        fields: {
          companyId: companyA,
          fiscalYearId: idOf('FiscalYear'),
          accountingPeriodId: idOf('AccountingPeriod'),
          status: literal('DRAFT'),
          closedById: literal(null),
          closedAt: literal(null),
          reopenedById: literal(null),
          reopenedAt: literal(null),
          deletedAt: literal(null),
        },
      },
      {
        model: 'AccountingPeriod',
        id: idOf('AccountingPeriod'),
        fields: {
          companyId: companyA,
          fiscalYearId: idOf('FiscalYear'),
          status: literal('OPEN'),
        },
      },
      {
        model: 'AccountingLock',
        id: idOf('AccountingLock'),
        fields: {
          companyId: companyA,
          fiscalYearId: idOf('FiscalYear'),
          accountingPeriodId: idOf('AccountingPeriod'),
          lockType: literal('PERIOD_LOCK'),
          status: literal('ACTIVE'),
          releasedById: literal(null),
          releasedAt: literal(null),
          deletedAt: literal(null),
        },
      },
      {
        model: 'JournalEntry',
        id: idOf('JournalEntry'),
        fields: {
          companyId: companyA,
          accountingPeriodId: idOf('AccountingPeriod'),
          status: literal('POSTED'),
          deletedAt: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'periodClose',
          kind: 'row-update',
          model: 'AccountingPeriodClose',
          id: idOf('AccountingPeriodClose'),
          expectedFields: {
            status: literal('CLOSED'),
            closedById: userA,
            closedAt: nowIso,
            updatedAt: nowIso,
          },
          forbiddenFields: ['reopenedById', 'reopenedAt', 'companyId', 'accountingPeriodId'],
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'accountingPeriod',
          kind: 'row-update',
          model: 'AccountingPeriod',
          id: idOf('AccountingPeriod'),
          expectedFields: { status: literal('CLOSED'), updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: idOf('AccountingPeriodClose'),
    },
    audit: {
      required: true,
      action: 'CLOSE',
      entityType: 'AccountingPeriodClose',
      companyId: { kind: 'exact', value: companyA },
    },
    description:
      'Close a draft accounting period on the existing-lock branch and prove both lifecycle rows while a posted-journal precondition rules out an ambiguous draft-journal failure.',
  },
  {
    capabilityId: 'PeriodCloseController.reopen',
    operation: 'action',
    request: { path: pathId('AccountingPeriodClose') },
    target: { model: 'AccountingPeriodClose', id: idOf('AccountingPeriodClose') },
    preStates: [
      {
        model: 'AccountingPeriodClose',
        id: idOf('AccountingPeriodClose'),
        fields: {
          companyId: companyA,
          fiscalYearId: idOf('FiscalYear'),
          accountingPeriodId: idOf('AccountingPeriod'),
          status: literal('CLOSED'),
          closedById: userA,
          closedAt: literal('2026-08-25T00:00:00.000Z'),
          reopenedById: literal(null),
          reopenedAt: literal(null),
          deletedAt: literal(null),
        },
      },
      {
        model: 'AccountingPeriod',
        id: idOf('AccountingPeriod'),
        fields: {
          companyId: companyA,
          fiscalYearId: idOf('FiscalYear'),
          status: literal('CLOSED'),
        },
      },
      {
        model: 'AccountingLock',
        id: idOf('AccountingLock'),
        fields: {
          companyId: companyA,
          fiscalYearId: idOf('FiscalYear'),
          accountingPeriodId: idOf('AccountingPeriod'),
          lockType: literal('PERIOD_LOCK'),
          status: literal('ACTIVE'),
          releasedById: literal(null),
          releasedAt: literal(null),
          deletedAt: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'periodClose',
          kind: 'row-update',
          model: 'AccountingPeriodClose',
          id: idOf('AccountingPeriodClose'),
          expectedFields: {
            status: literal('REOPENED'),
            reopenedById: userA,
            reopenedAt: nowIso,
            updatedAt: nowIso,
          },
          forbiddenFields: ['closedById', 'closedAt', 'companyId', 'accountingPeriodId'],
          recovery: 'restore-row',
          recoveryOrder: 30,
        },
        {
          effectId: 'accountingPeriod',
          kind: 'row-update',
          model: 'AccountingPeriod',
          id: idOf('AccountingPeriod'),
          expectedFields: { status: literal('OPEN'), updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'periodLock',
          kind: 'row-update',
          model: 'AccountingLock',
          id: idOf('AccountingLock'),
          expectedFields: {
            status: literal('RELEASED'),
            releasedById: userA,
            releasedAt: nowIso,
            updatedAt: nowIso,
          },
          forbiddenFields: ['companyId', 'accountingPeriodId', 'lockType', 'deletedAt'],
          recovery: 'restore-row',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: idOf('AccountingPeriodClose'),
    },
    audit: {
      required: true,
      action: 'REOPEN',
      entityType: 'AccountingPeriodClose',
      companyId: { kind: 'exact', value: companyA },
    },
    description:
      'Reopen a closed period and prove the close, accounting-period, and active period-lock transitions exactly before restoring all three rows.',
  },
  createFixture(
    'PositionsController.create',
    'Position',
    {
      companyId: companyA,
      departmentId: idOf('Department'),
      title: unique('CRUD evidence position'),
    },
    'CREATE',
    'Position',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PositionsController.update',
    'Position',
    { description: unique('Updated position evidence') },
    'UPDATE',
  ),
  softDeleteFixture('PositionsController.remove', 'Position', 'DELETE'),
  createFixture(
    'PostingRulesController.create',
    'AccountingPostingRule',
    {
      companyId: companyA,
      name: unique('CRUD posting rule'),
      ruleCode: unique('CE-POST-RULE'),
      sourceType: literal('OTHER'),
      triggerAction: literal('OTHER'),
    },
    'CREATE',
    'AccountingPostingRule',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PostingRulesController.update',
    'AccountingPostingRule',
    { description: unique('Updated posting rule evidence') },
    'UPDATE',
  ),
  createFixture(
    'PostingRulesController.addLine',
    'AccountingPostingRuleLine',
    {
      accountId: idOf('ChartOfAccount'),
      amountSource: literal('TOTAL_AMOUNT'),
      debitCredit: literal('DEBIT'),
      lineOrder: literal(1),
    },
    'CREATE',
    'AccountingPostingRuleLine',
    { path: pathId('AccountingPostingRule') },
  ),
  createFixture(
    'PostingRunsController.create',
    'PostingRun',
    {
      companyId: companyA,
      postingRunNumber: unique('CE-POST-RUN'),
      sourceId: idOf('Product'),
      sourceType: literal('OTHER'),
    },
    'CREATE',
    'PostingRun',
    { companyPath: ['companyId'] },
  ),
  transitionFixture(
    'PostingRunsController.post',
    'PostingRun',
    { status: literal('POSTED'), postedAt: nowIso, postedById: userA },
    'POST',
    'PostingRun',
    { preState: { status: literal('DRAFT'), postedAt: literal(null), postedById: literal(null) } },
  ),
  transitionFixture(
    'PostingRunsController.reverse',
    'PostingRun',
    { status: literal('REVERSED'), reversedAt: nowIso, reversedById: userA },
    'REVERSE',
    'PostingRun',
    {
      preState: {
        status: literal('POSTED'),
        reversedAt: literal(null),
        reversedById: literal(null),
      },
    },
  ),
  createFixture(
    'PriceListsController.create',
    'PriceList',
    {
      companyId: companyA,
      currency: literal('TZS'),
      effectiveFrom: literal('2026-08-25T00:00:00.000Z'),
      name: unique('CRUD evidence price list'),
      priceListType: literal('RETAIL'),
    },
    'PRICE_LIST_CREATE',
    'PriceList',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PriceListsController.update',
    'PriceList',
    { notes: unique('Updated price list evidence') },
    'PRICE_LIST_UPDATE',
  ),
  softDeleteFixture('PriceListsController.remove', 'PriceList', 'PRICE_LIST_DELETE'),
  transitionFixture(
    'PriceListsController.approve',
    'PriceList',
    { approvedAt: nowIso, approvedById: userA },
    'PRICE_LIST_APPROVE',
    'PriceList',
    { preState: { approvedAt: literal(null), approvedById: literal(null) } },
  ),
  createFixture(
    'PriceListsController.addItem',
    'PriceListItem',
    {
      minimumQuantity: literal(0),
      price: literal(15),
      productId: idOf('Product'),
      unitId: idOf('UnitOfMeasure'),
    },
    'PRICE_LIST_ITEM_CREATE',
    'PriceListItem',
    { path: pathId('PriceList') },
  ),
  updateFixture(
    'PriceListsController.updateItem',
    'PriceListItem',
    { price: literal(17) },
    'PRICE_LIST_ITEM_UPDATE',
  ),
  transitionFixture(
    'ProcurementPlansController.approve',
    'ProcurementPlan',
    { status: literal('APPROVED'), approvedAt: nowIso, approvedById: userA },
    'APPROVE',
    'ProcurementPlan',
    {
      preState: {
        status: literal('DRAFT'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
    },
  ),
  createFixture(
    'ProcurementPlansController.create',
    'ProcurementPlan',
    {
      companyId: companyA,
      planNumber: unique('CE-PROC-PLAN'),
      title: unique('CRUD procurement plan'),
    },
    'CREATE',
    'ProcurementPlan',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ProcurementPlansController.update',
    'ProcurementPlan',
    { description: unique('Updated procurement plan evidence') },
    'UPDATE',
    'ProcurementPlan',
    { status: literal('DRAFT') },
  ),
  createFixture(
    'PrintEngineController.render',
    'GeneratedDocument',
    {
      entityId: idOf('Customer'),
      entityType: literal('Customer'),
      outputFormat: literal('TEXT'),
      templateId: idOf('DocumentTemplate'),
    },
    'RENDER',
    'GeneratedDocument',
    {
      persistedFields: {
        outputFormat: literal('TEXT'),
        templateId: idOf('DocumentTemplate'),
      },
      preState: {
        model: 'DocumentTemplate',
        id: idOf('DocumentTemplate'),
        fields: { status: literal('ACTIVE') },
      },
    },
  ),
];

const productAndProcurementDefinitions: readonly FixtureDefinition[] = [
  createFixture(
    'ProductBatchesController.create',
    'ProductBatch',
    {
      companyId: companyA,
      initialQuantity: literal(8),
      productId: idOf('Product'),
      unitId: idOf('UnitOfMeasure'),
    },
    'PRODUCT_BATCH_CREATE',
    'ProductBatch',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ProductBatchesController.update',
    'ProductBatch',
    { notes: unique('Updated product batch evidence') },
    'PRODUCT_BATCH_UPDATE',
  ),
  softDeleteFixture('ProductBatchesController.remove', 'ProductBatch', 'PRODUCT_BATCH_DELETE'),
  createFixture(
    'ProductCategoriesController.create',
    'ProductCategory',
    {
      categoryType: literal('OTHER'),
      companyId: companyA,
      name: unique('CRUD evidence category'),
    },
    'PRODUCT_CATEGORY_CREATE',
    'ProductCategory',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ProductCategoriesController.update',
    'ProductCategory',
    { description: unique('Updated category evidence') },
    'PRODUCT_CATEGORY_UPDATE',
  ),
  softDeleteFixture(
    'ProductCategoriesController.remove',
    'ProductCategory',
    'PRODUCT_CATEGORY_DELETE',
    'ProductCategory',
    undefined,
    undefined,
    binding('productCategoryDelete'),
  ),
  createFixture(
    'ProductsController.create',
    'Product',
    {
      baseUnitId: idOf('UnitOfMeasure'),
      categoryId: idOf('ProductCategory'),
      companyId: companyA,
      name: unique('CRUD evidence service product'),
      productType: literal('SERVICE'),
    },
    'PRODUCT_CREATE',
    'Product',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ProductsController.update',
    'Product',
    { description: unique('Updated product evidence') },
    'PRODUCT_UPDATE',
  ),
  softDeleteFixture('ProductsController.remove', 'Product', 'PRODUCT_DELETE'),
  createFixture(
    'ProductsController.createFamily',
    'ProductFamily',
    {
      categoryId: idOf('ProductCategory'),
      companyId: companyA,
      name: unique('CRUD evidence family'),
    },
    'PRODUCT_FAMILY_CREATE',
    'ProductFamily',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ProductsController.updateFamily',
    'ProductFamily',
    { description: unique('Updated product family evidence') },
    'PRODUCT_FAMILY_UPDATE',
  ),
  softDeleteFixture(
    'ProductsController.removeFamily',
    'ProductFamily',
    'PRODUCT_FAMILY_DELETE',
    'ProductFamily',
    { isActive: literal(true) },
    { isActive: literal(false) },
  ),
  transitionFixture(
    'ProfitController.fixCostGap',
    'Product',
    { defaultPurchasePrice: literal(11) },
    'PROFIT_COST_FIX',
    'Product',
    {
      preState: { defaultPurchasePrice: literal(null) },
      body: { defaultPurchasePrice: literal(11) },
      path: { productId: idOf('Product') },
    },
  ),
  updateFixture(
    'ProformaInvoicesController.update',
    'ProformaInvoice',
    { notes: unique('Updated proforma evidence') },
    'PROFORMA_INVOICE_UPDATE',
    'ProformaInvoice',
    { status: literal('DRAFT') },
  ),
  transitionFixture(
    'ProformaInvoicesController.send',
    'ProformaInvoice',
    { status: literal('SENT') },
    'PROFORMA_INVOICE_SENT',
    'ProformaInvoice',
    { preState: { status: literal('DRAFT') } },
  ),
  transitionFixture(
    'ProformaInvoicesController.accept',
    'ProformaInvoice',
    { status: literal('ACCEPTED') },
    'PROFORMA_INVOICE_ACCEPTED',
    'ProformaInvoice',
    { preState: { status: literal('SENT') } },
  ),
  softDeleteFixture(
    'ProformaInvoicesController.remove',
    'ProformaInvoice',
    'PROFORMA_INVOICE_DELETE',
    'ProformaInvoice',
    { status: literal('DRAFT') },
  ),
  updateFixture(
    'PurchaseOrdersController.update',
    'PurchaseOrder',
    { notes: unique('Updated purchase order evidence') },
    'PURCHASE_ORDER_UPDATE',
    'PurchaseOrder',
    { status: literal('DRAFT') },
  ),
  updateFixture(
    'PurchaseOrdersController.updateInvoiceReference',
    'PurchaseOrder',
    { supplierInvoiceNumber: unique('CE-INV') },
    'PURCHASE_ORDER_INVOICE_REFERENCE_UPDATE',
    'PurchaseOrder',
    undefined,
    {
      preState: {
        model: 'SupplierInvoice',
        id: idOf('SupplierInvoice'),
        fields: { purchaseOrderId: literal(null) },
      },
    },
  ),
  transitionFixture(
    'PurchaseOrdersController.confirm',
    'PurchaseOrder',
    { status: literal('CONFIRMED'), confirmedById: userA, confirmedAt: nowIso },
    'PURCHASE_ORDER_CONFIRM',
    'PurchaseOrder',
    {
      preState: {
        status: literal('DRAFT'),
        confirmedById: literal(null),
        confirmedAt: literal(null),
        payableId: literal(null),
        journalEntryId: literal(null),
      },
      forbiddenFields: ['companyId', 'purchaseType', 'totalAmount', 'payableId', 'journalEntryId'],
    },
  ),
  transitionFixture(
    'PurchaseOrdersController.cancel',
    'PurchaseOrder',
    { status: literal('CANCELLED'), outstandingAmount: literal(0) },
    'PURCHASE_ORDER_CANCEL',
    'PurchaseOrder',
    {
      preState: {
        status: literal('DRAFT'),
        payableId: literal(null),
        outstandingAmount: literal(25),
      },
    },
  ),
  softDeleteFixture(
    'PurchaseOrdersController.remove',
    'PurchaseOrder',
    'PURCHASE_ORDER_DELETE',
    'PurchaseOrder',
    { status: literal('DRAFT') },
  ),
  createFixture(
    'PurchaseRequisitionsController.create',
    'PurchaseRequisition',
    {
      companyId: companyA,
      requisitionNumber: unique('CE-REQ'),
    },
    'CREATE',
    'PurchaseRequisition',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'PurchaseRequisitionsController.update',
    'PurchaseRequisition',
    { notes: unique('Updated purchase requisition evidence') },
    'UPDATE',
    'PurchaseRequisition',
    { status: literal('DRAFT') },
  ),
  transitionFixture(
    'PurchaseRequisitionsController.submit',
    'PurchaseRequisition',
    { status: literal('SUBMITTED') },
    'SUBMIT',
    'PurchaseRequisition',
    { preState: { status: literal('DRAFT') } },
  ),
  transitionFixture(
    'PurchaseRequisitionsController.approve',
    'PurchaseRequisition',
    { status: literal('APPROVED'), approvedAt: nowIso, approvedById: userA },
    'APPROVE',
    'PurchaseRequisition',
    {
      preState: {
        status: literal('SUBMITTED'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'PurchaseRequisitionsController.reject',
    'PurchaseRequisition',
    {
      status: literal('REJECTED'),
      rejectedAt: nowIso,
      rejectedById: userA,
      rejectionReason: unique('Purchase requisition rejection'),
    },
    'REJECT',
    'PurchaseRequisition',
    {
      preState: {
        status: literal('SUBMITTED'),
        rejectedAt: literal(null),
        rejectedById: literal(null),
        rejectionReason: literal(null),
      },
      body: { reason: unique('Purchase requisition rejection') },
    },
  ),
];

const revenueAndRecordsDefinitions: readonly FixtureDefinition[] = [
  createFixture(
    'RolesController.create',
    'Role',
    {
      displayName: unique('CRUD evidence role'),
      name: unique('CRUD_ROLE'),
      scope: literal('COMPANY'),
    },
    'ROLE_CREATE',
    'Role',
  ),
  updateFixture(
    'RolesController.update',
    'Role',
    { displayName: unique('Updated CRUD role') },
    'ROLE_UPDATE',
    'Role',
    { scope: literal('COMPANY') },
  ),
  createFixture(
    'RfqsController.create',
    'RequestForQuotation',
    {
      companyId: companyA,
      rfqNumber: unique('CE-RFQ'),
      title: unique('CRUD request for quotation'),
    },
    'CREATE',
    'RequestForQuotation',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'RfqsController.update',
    'RequestForQuotation',
    { notes: unique('Updated RFQ evidence') },
    'UPDATE',
  ),
  transitionFixture(
    'RfqsController.send',
    'RequestForQuotation',
    { status: literal('SENT') },
    'SEND',
    'RequestForQuotation',
    { preState: { status: literal('DRAFT') }, body: {} },
  ),
  updateFixture(
    'QuotationsController.update',
    'Quotation',
    { notes: unique('Updated quotation evidence') },
    'QUOTATION_UPDATE',
    'Quotation',
    { status: literal('DRAFT') },
  ),
  transitionFixture(
    'QuotationsController.send',
    'Quotation',
    { status: literal('SENT') },
    'QUOTATION_STATUS_CHANGED',
    'Quotation',
    { preState: { status: literal('DRAFT') } },
  ),
  transitionFixture(
    'QuotationsController.accept',
    'Quotation',
    { status: literal('ACCEPTED'), approvedAt: nowIso, approvedById: userA },
    'QUOTATION_STATUS_CHANGED',
    'Quotation',
    {
      preState: {
        status: literal('SENT'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'QuotationsController.reject',
    'Quotation',
    { status: literal('REJECTED') },
    'QUOTATION_STATUS_CHANGED',
    'Quotation',
    { preState: { status: literal('SENT') } },
  ),
  softDeleteFixture('QuotationsController.remove', 'Quotation', 'QUOTATION_DELETE'),
  updateFixture(
    'ReceivablesController.update',
    'Receivable',
    { notes: unique('Updated receivable evidence') },
    'RECEIVABLE_UPDATE',
    'Receivable',
    undefined,
    {
      additionalExpectedFields: {
        customerName: binding('model:Customer', ['name']),
      },
    },
  ),
  {
    capabilityId: 'ReceivablesController.remove',
    operation: 'delete',
    setupModels: ['Customer', 'Receivable'],
    request: { path: { id: receivableRemoveTarget } },
    preState: {
      model: 'Customer',
      id: receivableRemoveCustomer,
      fields: { currentBalance: literal(1) },
    },
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'receivable',
          kind: 'row-delete',
          model: 'Receivable',
          id: receivableRemoveTarget,
          mode: 'soft',
          deletedAtPath: ['deletedAt'],
          expectedFields: { deletedAt: nowIso, updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 20,
        },
        {
          effectId: 'customerBalance',
          kind: 'row-update',
          model: 'Customer',
          id: receivableRemoveCustomer,
          expectedFields: { currentBalance: literal(0), updatedAt: nowIso },
          recovery: 'restore-row',
          recoveryOrder: 10,
        },
      ],
      auditEntityId: receivableRemoveTarget,
    },
    audit: {
      required: true,
      action: 'RECEIVABLE_DELETE',
      entityType: 'Receivable',
      companyId: { kind: 'exact', value: companyA },
    },
    description:
      'Soft-delete a receivable and prove the exact customer balance projection refresh in the same recoverable transaction.',
  },
  transitionFixture(
    'RefundsController.void',
    'Refund',
    {
      status: literal('VOID'),
      reason: literal('CRUD evidence legacy refund void'),
      voidedAt: nowIso,
    },
    'REFUND_VOID',
    'Refund',
    {
      body: { reason: literal('CRUD evidence legacy refund void') },
      // The service explicitly supports a paid legacy row with no traceable
      // journal. This branch proves the guarded lifecycle claim without
      // pretending that a financial reversal occurred.
      preState: {
        status: literal('PAID'),
        journalEntryId: literal(null),
        reversalJournalEntryId: literal(null),
        reason: literal(null),
        voidedAt: literal(null),
        deletedAt: literal(null),
      },
      forbiddenFields: [
        'journalEntryId',
        'reversalJournalEntryId',
        'cashAccountId',
        'amount',
        'companyId',
        'deletedAt',
      ],
    },
  ),
  createFixture(
    'RecordBookController.createCategory',
    'RecordBookExpenseCategory',
    { companyId: companyA, name: unique('CRUD record category') },
    'RECORD_BOOK_CATEGORY_CREATE',
    'RecordBookExpenseCategory',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'RecordBookController.updateCategory',
    'RecordBookExpenseCategory',
    { description: unique('Updated record category evidence') },
    'RECORD_BOOK_CATEGORY_UPDATE',
  ),
  softDeleteFixture(
    'RecordBookController.removeCategory',
    'RecordBookExpenseCategory',
    'RECORD_BOOK_CATEGORY_DELETE',
    'RecordBookExpenseCategory',
    { isActive: literal(true) },
    { isActive: literal(false) },
  ),
  transitionFixture(
    'RecordBookController.restoreCategory',
    'RecordBookExpenseCategory',
    { deletedAt: literal(null), isActive: literal(true) },
    'RECORD_BOOK_CATEGORY_RESTORE',
    'RecordBookExpenseCategory',
    {
      preState: {
        deletedAt: literal('2026-08-24T00:00:00.000Z'),
        isActive: literal(false),
      },
    },
  ),
  transitionFixture(
    'RecordBookController.finalizeDailySale',
    'RecordBookDailySale',
    { status: literal('FINALIZED'), finalizedAt: nowIso, finalizedById: userA },
    'RECORD_BOOK_DAILY_SALE_FINALIZE',
    'RecordBookDailySale',
    {
      preState: {
        status: literal('DRAFT'),
        finalizedAt: literal(null),
        finalizedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'RecordBookController.reopenDailySale',
    'RecordBookDailySale',
    {
      status: literal('DRAFT'),
      reopenedAt: nowIso,
      reopenedById: userA,
      reopenReason: unique('Daily sale reopen reason'),
      updatedById: userA,
    },
    'RECORD_BOOK_DAILY_SALE_REOPEN',
    'RecordBookDailySale',
    {
      preState: { status: literal('FINALIZED') },
      body: { reason: unique('Daily sale reopen reason') },
    },
  ),
  transitionFixture(
    'RecordBookController.voidDailySale',
    'RecordBookDailySale',
    {
      status: literal('VOIDED'),
      voidedAt: nowIso,
      voidedById: userA,
      voidReason: unique('Daily sale void reason'),
    },
    'RECORD_BOOK_DAILY_SALE_VOID',
    'RecordBookDailySale',
    {
      preState: { status: literal('DRAFT') },
      body: { reason: unique('Daily sale void reason') },
    },
  ),
  softDeleteFixture(
    'RecordBookController.removeDailySale',
    'RecordBookDailySale',
    'RECORD_BOOK_DAILY_SALE_DELETE',
    'RecordBookDailySale',
    { status: literal('DRAFT'), updatedById: literal(null) },
    { updatedById: userA },
  ),
  transitionFixture(
    'RecordBookController.restoreDailySale',
    'RecordBookDailySale',
    { deletedAt: literal(null), updatedById: userA },
    'RECORD_BOOK_DAILY_SALE_RESTORE',
    'RecordBookDailySale',
    {
      preState: {
        status: literal('DRAFT'),
        deletedAt: literal('2026-08-24T00:00:00.000Z'),
      },
    },
  ),
  createFixture(
    'RecordBookController.createExpense',
    'RecordBookExpense',
    {
      amount: literal(12),
      companyId: companyA,
      description: unique('CRUD record expense'),
      expenseCategoryId: idOf('RecordBookExpenseCategory'),
      recordDate: literal('2026-08-25T00:00:00.000Z'),
    },
    'RECORD_BOOK_EXPENSE_CREATE',
    'RecordBookExpense',
    {
      companyPath: ['companyId'],
      // recordDate is deliberately NOT declared here: the service truncates it
      // to the SERVER-LOCAL day start, so its persisted instant is proven by
      // the capability's local-day-start generated-field validator instead of
      // a timezone-dependent literal.
      persistedFields: {
        amount: literal(12),
        companyId: companyA,
        description: unique('CRUD record expense'),
        expenseCategoryId: idOf('RecordBookExpenseCategory'),
      },
    },
  ),
  updateFixture(
    'RecordBookController.updateExpense',
    'RecordBookExpense',
    { description: unique('Updated record expense evidence') },
    'RECORD_BOOK_EXPENSE_UPDATE',
    'RecordBookExpense',
    { status: literal('DRAFT') },
    { additionalExpectedFields: { updatedById: userA } },
  ),
  transitionFixture(
    'RecordBookController.finalizeExpense',
    'RecordBookExpense',
    { status: literal('FINALIZED'), finalizedAt: nowIso, finalizedById: userA },
    'RECORD_BOOK_EXPENSE_FINALIZE',
    'RecordBookExpense',
    {
      preState: {
        status: literal('DRAFT'),
        finalizedAt: literal(null),
        finalizedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'RecordBookController.reopenExpense',
    'RecordBookExpense',
    {
      status: literal('DRAFT'),
      reopenedAt: nowIso,
      reopenedById: userA,
      reopenReason: unique('Expense reopen reason'),
      updatedById: userA,
    },
    'RECORD_BOOK_EXPENSE_REOPEN',
    'RecordBookExpense',
    {
      preState: { status: literal('FINALIZED') },
      body: { reason: unique('Expense reopen reason') },
    },
  ),
  transitionFixture(
    'RecordBookController.voidExpense',
    'RecordBookExpense',
    {
      status: literal('VOIDED'),
      voidedAt: nowIso,
      voidedById: userA,
      voidReason: unique('Expense void reason'),
    },
    'RECORD_BOOK_EXPENSE_VOID',
    'RecordBookExpense',
    {
      preState: { status: literal('DRAFT') },
      body: { reason: unique('Expense void reason') },
    },
  ),
  softDeleteFixture(
    'RecordBookController.removeExpense',
    'RecordBookExpense',
    'RECORD_BOOK_EXPENSE_DELETE',
    'RecordBookExpense',
    { status: literal('DRAFT'), updatedById: literal(null) },
    { updatedById: userA },
  ),
  transitionFixture(
    'RecordBookController.restoreExpense',
    'RecordBookExpense',
    { deletedAt: literal(null), updatedById: userA },
    'RECORD_BOOK_EXPENSE_RESTORE',
    'RecordBookExpense',
    {
      preState: {
        status: literal('DRAFT'),
        deletedAt: literal('2026-08-24T00:00:00.000Z'),
      },
    },
  ),
];

const workforceAndSalesDefinitions: readonly FixtureDefinition[] = [
  createFixture(
    'ReturnablePackagesController.create',
    'ReturnablePackage',
    {
      companyId: companyA,
      depositValue: literal(5),
      name: unique('CRUD returnable package'),
      packageType: literal('OTHER'),
    },
    'RETURNABLE_PACKAGE_CREATE',
    'ReturnablePackage',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ReturnablePackagesController.update',
    'ReturnablePackage',
    { name: unique('Updated returnable package') },
    'RETURNABLE_PACKAGE_UPDATE',
  ),
  softDeleteFixture(
    'ReturnablePackagesController.remove',
    'ReturnablePackage',
    'RETURNABLE_PACKAGE_DELETE',
  ),
  createFixture(
    'SalaryAdvancesController.create',
    'SalaryAdvance',
    {
      amount: literal(50),
      companyId: companyA,
      createdById: userA,
      employeeId: idOf('Employee'),
      requestDate: literal('2026-08-25T00:00:00.000Z'),
    },
    'SALARY_ADVANCE_CREATE',
    'SalaryAdvance',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SalaryAdvancesController.update',
    'SalaryAdvance',
    { notes: unique('Updated salary advance evidence') },
    'SALARY_ADVANCE_UPDATE',
  ),
  transitionFixture(
    'SalaryAdvancesController.approve',
    'SalaryAdvance',
    { status: literal('APPROVED'), approvedAt: nowIso, approvedById: userA },
    'SALARY_ADVANCE_APPROVE',
    'SalaryAdvance',
    {
      preState: {
        status: literal('REQUESTED'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
      body: {},
    },
  ),
  softDeleteFixture('SalaryAdvancesController.remove', 'SalaryAdvance', 'SALARY_ADVANCE_DELETE'),
  createFixture(
    'SalaryPaymentsController.create',
    'SalaryPayment',
    {
      amount: literal(40),
      companyId: companyA,
      employeeId: idOf('Employee'),
      paymentDate: literal('2026-08-25T00:00:00.000Z'),
      payrollEntryId: idOf('PayrollEntry'),
      payrollRunId: idOf('PayrollRun'),
    },
    'SALARY_PAYMENT_CREATE',
    'SalaryPayment',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SalaryPaymentsController.update',
    'SalaryPayment',
    { notes: unique('Updated salary payment evidence') },
    'SALARY_PAYMENT_UPDATE',
  ),
  transitionFixture(
    'SalaryPaymentsController.reverse',
    'SalaryPayment',
    { status: literal('REVERSED'), notes: literal('Reversed') },
    'SALARY_PAYMENT_REVERSE',
    'SalaryPayment',
    { preState: { status: literal('PAID') }, body: {} },
  ),
  softDeleteFixture('SalaryPaymentsController.remove', 'SalaryPayment', 'SALARY_PAYMENT_DELETE'),
  createFixture(
    'SalesChannelsController.create',
    'SalesChannel',
    { channelType: literal('OTHER'), companyId: companyA, name: unique('CRUD sales channel') },
    'SALES_CHANNEL_CREATE',
    'SalesChannel',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SalesChannelsController.update',
    'SalesChannel',
    { name: unique('Updated sales channel') },
    'SALES_CHANNEL_UPDATE',
  ),
  softDeleteFixture('SalesChannelsController.remove', 'SalesChannel', 'SALES_CHANNEL_DELETE'),
  createFixture(
    'SalesCommissionsController.create',
    'SalesCommission',
    {
      amount: literal(25),
      basis: literal('FLAT'),
      companyId: companyA,
      employeeId: binding('salesCommissionCreateEmployee'),
      rate: literal(0),
      salesOrderId: idOf('SalesOrder'),
    },
    'CREATE',
    'SalesCommission',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SalesCommissionsController.update',
    'SalesCommission',
    { notes: unique('Updated sales commission evidence') },
    'UPDATE',
    'SalesCommission',
    { status: literal('DRAFT') },
  ),
  transitionFixture(
    'SalesCommissionsController.approve',
    'SalesCommission',
    { status: literal('APPROVED'), approvedAt: nowIso, approvedById: userA },
    'UPDATE',
    'SalesCommission',
    {
      preState: {
        status: literal('DRAFT'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'SalesCommissionsController.cancel',
    'SalesCommission',
    { status: literal('CANCELLED') },
    'UPDATE',
    'SalesCommission',
    { preState: { status: literal('DRAFT'), notes: literal(null) }, body: {} },
  ),
  softDeleteFixture(
    'SalesCommissionsController.remove',
    'SalesCommission',
    'DELETE',
    'SalesCommission',
    { status: literal('DRAFT') },
  ),
  updateFixture(
    'SalesOrdersController.update',
    'SalesOrder',
    { notes: unique('Updated sales order evidence') },
    'SALES_ORDER_UPDATE',
    'SalesOrder',
    {
      paymentMethod: literal('CREDIT'),
      salesType: literal('CASH_SALE'),
    },
    {
      // update() normalizes legacy CASH_SALE/CREDIT rows even when the PATCH
      // changes another field. Bind that production-owned delta explicitly;
      // it is evidence, not an allowed-field escape hatch.
      additionalExpectedFields: { paymentMethod: literal('CASH') },
      preStates: [
        {
          model: 'SalesOrderLine',
          id: idOf('SalesOrderLine'),
          fields: { unitPrice: literal(100) },
        },
      ],
    },
  ),
  transitionFixture(
    'SalesOrdersController.cancel',
    'SalesOrder',
    { status: literal('CANCELLED') },
    'SALES_ORDER_CANCEL',
    'SalesOrder',
    {
      preState: {
        status: literal('DRAFT'),
        journalEntryId: literal(null),
        paidAmount: literal(0),
        paymentStatus: literal('UNPAID'),
        receivableId: literal(null),
      },
    },
  ),
  softDeleteFixture(
    'SalesOrdersController.remove',
    'SalesOrder',
    'SALES_ORDER_DELETE',
    'SalesOrder',
    { status: literal('DRAFT') },
  ),
  createFixture(
    'SavedReportViewsController.create',
    'SavedReportView',
    {
      companyId: companyA,
      name: unique('CRUD saved report view'),
      reportDefinitionId: idOf('ReportDefinition'),
    },
    'CREATE',
    'SavedReportView',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SavedReportViewsController.update',
    'SavedReportView',
    { name: unique('Updated saved report view') },
    'UPDATE',
  ),
  transitionFixture(
    'SavedReportViewsController.share',
    'SavedReportView',
    { isShared: literal(true) },
    'UPDATE',
    'SavedReportView',
    { preState: { isShared: literal(false) } },
  ),
  transitionFixture(
    'SavedReportViewsController.setDefault',
    'SavedReportView',
    { isDefault: literal(true) },
    'UPDATE',
    'SavedReportView',
    {
      preState: { isDefault: literal(false) },
      // The disposable schema owns one live view in this actor/company scope.
      // The loopback delta reconciler still snapshots every model, so an
      // unexpected updateMany side effect on another row fails closed.
    },
  ),
  softDeleteFixture('SavedReportViewsController.remove', 'SavedReportView', 'DELETE'),
  createFixture(
    'ScheduledReportsController.create',
    'ScheduledReport',
    {
      companyId: companyA,
      exportFormat: literal('JSON'),
      frequency: literal('DAILY'),
      name: unique('CRUD scheduled report'),
      recipients: object({}),
      reportDefinitionId: idOf('ReportDefinition'),
      scheduleCode: unique('CE-SCHEDULE'),
    },
    'CREATE',
    'ScheduledReport',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ScheduledReportsController.update',
    'ScheduledReport',
    { description: unique('Updated scheduled report evidence') },
    'UPDATE',
  ),
  transitionFixture(
    'ScheduledReportsController.activate',
    'ScheduledReport',
    { isActive: literal(true) },
    'UPDATE',
    'ScheduledReport',
    {
      preState: {
        isActive: literal(false),
        nextRunAt: literal('2099-01-01T00:00:00.000Z'),
      },
    },
  ),
  transitionFixture(
    'ScheduledReportsController.deactivate',
    'ScheduledReport',
    { isActive: literal(false) },
    'UPDATE',
    'ScheduledReport',
    { preState: { isActive: literal(true) } },
  ),
  softDeleteFixture('ScheduledReportsController.remove', 'ScheduledReport', 'DELETE'),
  createFixture(
    'SecurityEventsController.create',
    'SecurityEvent',
    {
      companyId: companyA,
      description: unique('CRUD security event'),
      eventType: literal('OTHER'),
      severity: literal('LOW'),
    },
    'SECURITY_EVENT_CREATED',
    'SecurityEvent',
    { companyPath: ['companyId'] },
  ),
  transitionFixture(
    'SecurityEventsController.review',
    'SecurityEvent',
    { status: literal('REVIEWED'), reviewedAt: nowIso, reviewedById: userA },
    'SECURITY_EVENT_REVIEWED',
    'SecurityEvent',
    {
      preState: {
        status: literal('OPEN'),
        reviewedAt: literal(null),
        reviewedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'SecurityEventsController.resolve',
    'SecurityEvent',
    { status: literal('RESOLVED'), resolvedAt: nowIso, resolvedById: userA },
    'SECURITY_EVENT_RESOLVED',
    'SecurityEvent',
    {
      preState: {
        status: literal('OPEN'),
        resolvedAt: literal(null),
        resolvedById: literal(null),
      },
    },
  ),
  createFixture(
    'SecurityPoliciesController.create',
    'SecurityPolicy',
    {
      companyId: companyA,
      name: unique('CRUD security policy'),
      policyType: literal('GENERAL'),
    },
    'SECURITY_POLICY_CREATED',
    'SecurityPolicy',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SecurityPoliciesController.update',
    'SecurityPolicy',
    { name: unique('Updated security policy evidence') },
    'SECURITY_POLICY_UPDATED',
  ),
  softDeleteFixture(
    'SecurityPoliciesController.remove',
    'SecurityPolicy',
    'SECURITY_POLICY_DELETED',
  ),
  createFixture(
    'ShiftSchedulesController.create',
    'ShiftSchedule',
    {
      companyId: companyA,
      createdById: userA,
      employeeId: idOf('Employee'),
      scheduleDate: literal('2031-02-01T00:00:00.000Z'),
      scheduleNumber: unique('CE-SHIFT'),
      workShiftId: idOf('WorkShift'),
    },
    'CREATE',
    'ShiftSchedule',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'ShiftSchedulesController.update',
    'ShiftSchedule',
    { notes: unique('Updated shift schedule evidence') },
    'UPDATE',
  ),
  softDeleteFixture('ShiftSchedulesController.remove', 'ShiftSchedule', 'DELETE'),
  createFixture(
    'StatutoryDeductionRulesController.create',
    'StatutoryDeductionRule',
    {
      effectiveFrom: literal('2031-01-01T00:00:00.000Z'),
      name: unique('CRUD statutory rule'),
      ruleCode: unique('CE-STAT'),
    },
    'CREATE',
    'StatutoryDeductionRule',
    { executionPrincipal: 'group' },
  ),
  updateFixture(
    'StatutoryDeductionRulesController.update',
    'StatutoryDeductionRule',
    { notes: unique('Updated statutory rule evidence') },
    'UPDATE',
  ),
  softDeleteFixture('StatutoryDeductionRulesController.remove', 'StatutoryDeductionRule', 'DELETE'),
];

const stockAndSupplierDefinitions: readonly FixtureDefinition[] = [
  transitionFixture(
    'StockAdjustmentsController.submit',
    'StockAdjustment',
    { status: literal('PENDING_APPROVAL') },
    'STOCK_ADJUSTMENT_SUBMIT',
    'StockAdjustment',
    { preState: { status: literal('DRAFT') } },
  ),
  transitionFixture(
    'StockAdjustmentsController.approve',
    'StockAdjustment',
    { status: literal('APPROVED'), approvedAt: nowIso, approvedById: userA },
    'STOCK_ADJUSTMENT_APPROVE',
    'StockAdjustment',
    {
      preState: {
        status: literal('PENDING_APPROVAL'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'StockAdjustmentsController.reject',
    'StockAdjustment',
    {
      notes: literal('[Rejected] CRUD evidence rejected adjustment'),
      status: literal('REJECTED'),
    },
    'STOCK_ADJUSTMENT_REJECT',
    'StockAdjustment',
    {
      body: { reason: literal('CRUD evidence rejected adjustment') },
      preState: { notes: literal(null), status: literal('PENDING_APPROVAL') },
      forbiddenFields: ['approvedAt', 'approvedById', 'companyId'],
    },
  ),
  transitionFixture(
    'StockAdjustmentsController.revert',
    'StockAdjustment',
    {
      status: literal('DRAFT'),
      approvedAt: literal(null),
      approvedById: literal(null),
    },
    'STOCK_ADJUSTMENT_REVERT_APPROVAL',
    'StockAdjustment',
    {
      preState: {
        status: literal('APPROVED'),
        approvedAt: literal('2026-08-24T00:00:00.000Z'),
        approvedById: userA,
        postedAt: literal(null),
      },
    },
  ),
  softDeleteFixture(
    'StockAdjustmentsController.remove',
    'StockAdjustment',
    'STOCK_ADJUSTMENT_DELETE',
    'StockAdjustment',
    { status: literal('DRAFT') },
  ),
  createFixture(
    'StockDamageController.create',
    'StockDamage',
    {
      branchId: idOf('Branch'),
      companyId: companyA,
      damageType: literal('OTHER'),
      productId: idOf('Product'),
      quantity: literal(1),
      unitId: idOf('UnitOfMeasure'),
    },
    'STOCK_DAMAGE_CREATE',
    'StockDamage',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'StockDamageController.update',
    'StockDamage',
    { notes: unique('Updated stock damage evidence') },
    'STOCK_DAMAGE_UPDATE',
    'StockDamage',
    { status: literal('DRAFT') },
  ),
  transitionFixture(
    'StockDamageController.submit',
    'StockDamage',
    { status: literal('SUBMITTED') },
    'STOCK_DAMAGE_SUBMIT',
    'StockDamage',
    { preState: { status: literal('DRAFT') } },
  ),
  transitionFixture(
    'StockDamageController.approve',
    'StockDamage',
    { status: literal('APPROVED'), approvedAt: nowIso, approvedById: userA },
    'STOCK_DAMAGE_APPROVE',
    'StockDamage',
    {
      preState: {
        status: literal('SUBMITTED'),
        approvedAt: literal(null),
        approvedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'StockDamageController.reject',
    'StockDamage',
    { status: literal('REJECTED') },
    'STOCK_DAMAGE_REJECT',
    'StockDamage',
    { preState: { status: literal('SUBMITTED') } },
  ),
  softDeleteFixture(
    'StockDamageController.remove',
    'StockDamage',
    'STOCK_DAMAGE_DELETE',
    'StockDamage',
    { status: literal('DRAFT') },
  ),
  updateFixture(
    'SupplierInvoicesController.update',
    'SupplierInvoice',
    { notes: unique('Updated supplier invoice evidence') },
    'SUPPLIER_INVOICE_UPDATE',
    'SupplierInvoice',
    { status: literal('DRAFT') },
  ),
  {
    // Compound-effect fixture for the REACHABLE post-approve state (approve()
    // unconditionally writes payableId, so APPROVED + payableId null cannot
    // occur through application code). Seeds an approved invoice whose payable
    // is backed by its own POSTED approve-time journal (referenceType
    // 'SupplierInvoice', balanced DR expense / CR AP) and proves the real
    // branch-(a) unwind: original journal flipped to REVERSED, an exact
    // swapped-line mirror reversal posted and linked back, the payable
    // cancelled to zero outstanding, the supplier balance re-synced, and the
    // invoice cancelled with its payable trace retained.
    capabilityId: 'SupplierInvoicesController.void',
    operation: 'action',
    description:
      'Void an approved supplier invoice with an invoice-created payable and prove the original journal reversal claim, the exact swapped-line mirror posting, the payable cancellation, the supplier balance sync, and the cancelled invoice retaining its payable trace.',
    request: {
      path: pathId('SupplierInvoice'),
      body: { reason: literal('CRUD evidence supplier invoice void') },
    },
    target: { model: 'SupplierInvoice', id: idOf('SupplierInvoice') },
    preStates: [
      {
        model: 'Supplier',
        id: idOf('Supplier'),
        fields: {
          companyId: companyA,
          currentBalance: literal(125),
          status: literal('ACTIVE'),
          deletedAt: literal(null),
        },
      },
      {
        // The harness-seeded journal already carries the exact balanced pair
        // DR 125 debitChartOfAccountA / CR 125 creditChartOfAccountA. Pin it
        // to the approve-time shape: POSTED, referenced to this invoice.
        model: 'JournalEntry',
        id: idOf('JournalEntry'),
        fields: {
          companyId: companyA,
          accountingPeriodId: accountingPeriodA,
          divisionId: literal(null),
          branchId: literal(null),
          transactionDate: literal('2026-08-25T12:00:00.000Z'),
          referenceType: literal('SupplierInvoice'),
          referenceId: idOf('SupplierInvoice'),
          status: literal('POSTED'),
          totalDebit: literal(125),
          totalCredit: literal(125),
          postedById: userA,
          postedAt: literal('2026-08-25T12:00:01.000Z'),
          reversalOfId: literal(null),
          reversalReason: literal(null),
          reversedAt: literal(null),
          reversedById: literal(null),
          deletedAt: literal(null),
        },
      },
      {
        model: 'Payable',
        id: idOf('Payable'),
        fields: {
          companyId: companyA,
          supplierId: idOf('Supplier'),
          sourceType: literal('SupplierInvoice'),
          sourceId: idOf('SupplierInvoice'),
          amount: literal(125),
          paidAmount: literal(0),
          outstandingAmount: literal(125),
          currency: literal('TZS'),
          status: literal('OPEN'),
          journalEntryId: idOf('JournalEntry'),
          deletedAt: literal(null),
        },
      },
      {
        model: 'SupplierInvoice',
        id: idOf('SupplierInvoice'),
        fields: {
          supplierInvoiceNumber: literal('FIXTURE-SI-VOID'),
          companyId: companyA,
          divisionId: divisionA,
          branchId: branchA,
          supplierId: idOf('Supplier'),
          purchaseOrderId: literal(null),
          goodsReceivedNoteId: literal(null),
          subtotal: literal(125),
          taxAmount: literal(0),
          discountAmount: literal(0),
          totalAmount: literal(125),
          paidAmount: literal(0),
          outstandingAmount: literal(125),
          currency: literal('TZS'),
          status: literal('APPROVED'),
          payableId: idOf('Payable'),
          approvedById: userA,
          approvedAt: literal('2026-08-25T12:00:02.000Z'),
          deletedAt: literal(null),
        },
      },
    ],
    effect: {
      kind: 'compound',
      effects: [
        {
          effectId: 'reversalJournal',
          kind: 'scoped-row-create',
          model: 'JournalEntry',
          scope: {
            equals: { reversalOfId: idOf('JournalEntry') },
            identityFields: ['id'],
          },
          expectedFields: {
            companyId: companyA,
            divisionId: divisionA,
            branchId: branchA,
            accountingPeriodId: accountingPeriodA,
            transactionDate: nowIso,
            description: literal('Void of supplier invoice FIXTURE-SI-VOID'),
            referenceType: literal('SupplierInvoice'),
            referenceId: idOf('SupplierInvoice'),
            status: literal('POSTED'),
            totalDebit: literal(125),
            totalCredit: literal(125),
            createdById: userA,
            postedById: userA,
            postedAt: nowIso,
            reversalOfId: idOf('JournalEntry'),
            reversalReason: literal(null),
            reversedAt: literal(null),
            reversedById: literal(null),
            deletedAt: literal(null),
          },
          generatedFields: {
            journalNumber: {
              kind: 'timestamp-id',
              prefix: 'JE-SUPPLIER_INVOICES-',
              timestampEncoding: 'base36-upper',
            },
          },
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 20,
        },
        {
          // Mirror of the seeded CR 125 line: the credit becomes the debit.
          effectId: 'reversalDebitLine',
          kind: 'scoped-row-create',
          model: 'JournalEntryLine',
          scope: {
            equals: { accountId: creditAccountA, description: literal('Reversal:') },
            identityFields: ['id'],
          },
          expectedFields: {
            journalEntryId: effectRef('reversalJournal'),
            accountId: creditAccountA,
            description: literal('Reversal:'),
            debit: literal(125),
            credit: literal(0),
            companyId: companyA,
            divisionId: divisionA,
            branchId: branchA,
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 0,
        },
        {
          // Mirror of the seeded DR 125 line: the debit becomes the credit.
          effectId: 'reversalCreditLine',
          kind: 'scoped-row-create',
          model: 'JournalEntryLine',
          scope: {
            equals: { accountId: debitAccountA, description: literal('Reversal:') },
            identityFields: ['id'],
          },
          expectedFields: {
            journalEntryId: effectRef('reversalJournal'),
            accountId: debitAccountA,
            description: literal('Reversal:'),
            debit: literal(0),
            credit: literal(125),
            companyId: companyA,
            divisionId: divisionA,
            branchId: branchA,
          },
          generatedFields: {},
          allowedFields: ['id', 'createdAt', 'updatedAt'],
          recovery: 'restore-scope',
          recoveryOrder: 10,
        },
        {
          effectId: 'originalJournal',
          kind: 'row-update',
          model: 'JournalEntry',
          id: idOf('JournalEntry'),
          expectedFields: {
            status: literal('REVERSED'),
            reversalReason: literal('CRUD evidence supplier invoice void'),
            reversedAt: nowIso,
            reversedById: userA,
            updatedAt: nowIso,
          },
          forbiddenFields: [
            'accountingPeriodId',
            'companyId',
            'createdById',
            'deletedAt',
            'journalNumber',
            'postedAt',
            'postedById',
            'referenceId',
            'referenceType',
            'reversalOfId',
            'totalCredit',
            'totalDebit',
            'transactionDate',
          ],
          recovery: 'restore-row',
          recoveryOrder: 30,
        },
        {
          effectId: 'payable',
          kind: 'row-update',
          model: 'Payable',
          id: idOf('Payable'),
          expectedFields: {
            status: literal('CANCELLED'),
            outstandingAmount: literal(0),
            updatedAt: nowIso,
          },
          forbiddenFields: [
            'amount',
            'companyId',
            'deletedAt',
            'journalEntryId',
            'paidAmount',
            'sourceId',
            'sourceType',
            'supplierId',
          ],
          recovery: 'restore-row',
          recoveryOrder: 40,
        },
        {
          effectId: 'supplierBalance',
          kind: 'row-update',
          model: 'Supplier',
          id: idOf('Supplier'),
          expectedFields: { currentBalance: literal(0), updatedAt: nowIso },
          forbiddenFields: ['companyId', 'name', 'status', 'deletedAt'],
          recovery: 'restore-row',
          recoveryOrder: 50,
        },
        {
          effectId: 'invoice',
          kind: 'row-update',
          model: 'SupplierInvoice',
          id: idOf('SupplierInvoice'),
          expectedFields: {
            status: literal('CANCELLED'),
            outstandingAmount: literal(0),
            updatedAt: nowIso,
          },
          forbiddenFields: [
            'approvedAt',
            'approvedById',
            'companyId',
            'deletedAt',
            'paidAmount',
            'payableId',
            'supplierId',
            'supplierInvoiceNumber',
            'totalAmount',
          ],
          recovery: 'restore-row',
          recoveryOrder: 60,
        },
      ],
      auditEntityId: idOf('SupplierInvoice'),
    },
    audit: {
      required: true,
      action: 'SUPPLIER_INVOICE_VOID',
      entityType: 'SupplierInvoice',
      companyId: { kind: 'exact', value: companyA },
    },
  },
  transitionFixture(
    'SupplierOrderDraftsController.send',
    'SupplierOrderDraft',
    { status: literal('SENT'), sentAt: nowIso },
    'SUPPLIER_ORDER_DRAFT_STATUS_CHANGE',
    'SupplierOrderDraft',
    { preState: { status: literal('DRAFT'), sentAt: literal(null) } },
  ),
  transitionFixture(
    'SupplierOrderDraftsController.accept',
    'SupplierOrderDraft',
    { status: literal('ACCEPTED'), acceptedAt: nowIso },
    'SUPPLIER_ORDER_DRAFT_STATUS_CHANGE',
    'SupplierOrderDraft',
    { preState: { status: literal('SENT'), acceptedAt: literal(null) } },
  ),
  transitionFixture(
    'SupplierOrderDraftsController.decline',
    'SupplierOrderDraft',
    { status: literal('DECLINED'), declinedAt: nowIso },
    'SUPPLIER_ORDER_DRAFT_STATUS_CHANGE',
    'SupplierOrderDraft',
    { preState: { status: literal('SENT'), declinedAt: literal(null) } },
  ),
  transitionFixture(
    'SupplierOrderDraftsController.cancel',
    'SupplierOrderDraft',
    { status: literal('CANCELLED'), cancelledAt: nowIso },
    'SUPPLIER_ORDER_DRAFT_STATUS_CHANGE',
    'SupplierOrderDraft',
    { preState: { status: literal('DRAFT'), cancelledAt: literal(null) } },
  ),
  transitionFixture(
    'SupplierOrderDraftsController.reopen',
    'SupplierOrderDraft',
    {
      status: literal('DRAFT'),
      cancelledAt: literal(null),
    },
    'SUPPLIER_ORDER_DRAFT_STATUS_CHANGE',
    'SupplierOrderDraft',
    {
      preState: {
        status: literal('CANCELLED'),
        cancelledAt: literal('2026-08-24T00:00:00.000Z'),
      },
      forbiddenFields: ['acceptedAt', 'declinedAt', 'sentAt'],
    },
  ),
  softDeleteFixture(
    'SupplierOrderDraftsController.remove',
    'SupplierOrderDraft',
    'SUPPLIER_ORDER_DRAFT_DELETE',
    'SupplierOrderDraft',
    { status: literal('DRAFT') },
  ),
  createFixture(
    'SupplierPerformanceController.create',
    'SupplierPerformanceProfile',
    { companyId: companyA, supplierId: binding('supplierPerformanceCreateSupplier') },
    'SUPPLIER_PERFORMANCE_CREATE',
    'SupplierPerformanceProfile',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SupplierPerformanceController.update',
    'SupplierPerformanceProfile',
    {
      companyId: companyA,
      supplierId: idOf('Supplier'),
      notes: unique('Updated supplier performance evidence'),
    },
    'SUPPLIER_PERFORMANCE_UPDATE',
    'SupplierPerformanceProfile',
    undefined,
    {
      persistedFields: {
        lastReviewedAt: nowIso,
        notes: unique('Updated supplier performance evidence'),
        reviewedById: userA,
      },
    },
  ),
  createFixture(
    'SupplierQuotationsController.create',
    'SupplierQuotation',
    {
      companyId: companyA,
      supplierId: idOf('Supplier'),
      supplierQuotationNumber: unique('CE-SUP-QUOTE'),
    },
    'CREATE',
    'SupplierQuotation',
    { companyPath: ['companyId'] },
  ),
  updateFixture(
    'SupplierQuotationsController.update',
    'SupplierQuotation',
    { notes: unique('Updated supplier quotation evidence') },
    'UPDATE',
  ),
  transitionFixture(
    'SupplierQuotationsController.accept',
    'SupplierQuotation',
    { status: literal('ACCEPTED'), acceptedAt: nowIso, acceptedById: userA },
    'ACCEPT',
    'SupplierQuotation',
    {
      preState: {
        status: literal('DRAFT'),
        acceptedAt: literal(null),
        acceptedById: literal(null),
      },
    },
  ),
  transitionFixture(
    'SupplierQuotationsController.reject',
    'SupplierQuotation',
    { status: literal('REJECTED') },
    'REJECT',
    'SupplierQuotation',
    { preState: { status: literal('DRAFT') } },
  ),
  createFixture(
    'SupplierStatementsController.generate',
    'SupplierStatementRun',
    {
      companyId: companyA,
      periodEnd: literal('2026-08-25T23:59:59.000Z'),
      periodStart: literal('2026-08-01T00:00:00.000Z'),
      supplierId: idOf('Supplier'),
    },
    'SUPPLIER_STATEMENT_GENERATE',
    'SupplierStatementRun',
    {
      companyPath: ['companyId'],
      persistedFields: {
        companyId: companyA,
        periodEnd: literal('2026-08-25T23:59:59.000Z'),
        periodStart: literal('2026-08-01T00:00:00.000Z'),
      },
    },
  ),
  updateFixture(
    'SuppliersController.update',
    'Supplier',
    { notes: unique('Updated supplier evidence') },
    'SUPPLIER_UPDATE',
    'Supplier',
    undefined,
    { additionalExpectedFields: { updatedById: userA } },
  ),
  softDeleteFixture('SuppliersController.remove', 'Supplier', 'SUPPLIER_DELETE'),
];

function fixtureId(capabilityId: string): string {
  const slug = capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 78);
  return `mutation-ns-${slug}-${createHash('sha256').update(capabilityId).digest('hex').slice(0, 12)}`;
}

function collectSetupModels(value: unknown, target = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSetupModels(item, target));
    return target;
  }
  if (!value || typeof value !== 'object') return target;
  const record = value as Record<string, unknown>;
  if (typeof record.binding === 'string' && record.binding.startsWith('model:')) {
    target.add(record.binding.slice('model:'.length));
  }
  Object.values(record).forEach((item) => collectSetupModels(item, target));
  return target;
}

function pack(
  packId: string,
  definitions: readonly FixtureDefinition[],
): CrudMutationAnyFixturePack {
  const fixtures = definitions.map((definition): CrudMutationAnyFixtureRegistration => {
    const models = collectSetupModels(definition);
    definition.setupModels?.forEach((model) => models.add(model));
    if (definition.target) models.add(definition.target.model);
    const companyId =
      definition.audit.companyId ??
      REVIEWED_AUDIT_COMPANY[definition.capabilityId] ??
      ({ kind: 'effect-company' } as const);
    return Object.freeze({
      ...definition,
      fixtureId: fixtureId(definition.capabilityId),
      fixtureVersion: 1,
      controlKind: 'positive',
      description:
        definition.description ??
        `Execute ${definition.capabilityId} and verify its exact persisted ${definition.effect.kind} effect and attributed audit row.`,
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
      setupModels: Object.freeze([...models].sort()),
    });
  });
  return Object.freeze({ packId, packVersion: 1, fixtures: Object.freeze(fixtures) });
}

export const CRUD_MUTATION_NS_EVIDENCE_PACKS: readonly CrudMutationAnyFixturePack[] = Object.freeze(
  [
    pack('mutation-ns-operations', operationsDefinitions),
    pack('mutation-ns-products-procurement', productAndProcurementDefinitions),
    pack('mutation-ns-revenue-records', revenueAndRecordsDefinitions),
    pack('mutation-ns-workforce-sales', workforceAndSalesDefinitions),
    pack('mutation-ns-stock-suppliers', stockAndSupplierDefinitions),
  ],
);

function blockers(
  capabilityIds: readonly string[],
  reason: CrudMutationBlocker['reason'],
  explanation: string,
): readonly CrudMutationBlocker[] {
  return capabilityIds.map((capabilityId) =>
    Object.freeze({
      capabilityId,
      reason,
      detail: `${capabilityId}: ${explanation}`,
    }),
  );
}

const auditBlockers = blockers(
  [],
  'audit_attribution_not_persisted',
  'the current service path can mutate state but does not persist an AuditLog row attributable to the executing principal, so central reconciliation cannot be proven.',
);

const recoveryBlockers = blockers(
  [
    'NotificationsController.remove',
    'PermissionsController.remove',
    'PostingRulesController.remove',
    'PriceListsController.removeItem',
    'RolesController.remove',
    'SupplierOrderDraftsController.emailPdf',
  ],
  'irreversible_without_recovery_control',
  'the route performs a hard removal or an external side effect without an isolated quarantine, snapshot, or compensating recovery control available to this harness.',
);

const exactEffectBlockers = blockers(
  [
    'OfflineSyncController.createBatch',
    'PayablesController.create',
    'PayablesController.recordPayment',
    'PayablesController.writeOff',
    'PayrollRunsController.calculate',
    'PayrollRunsController.approve',
    'PayrollRunsController.pay',
    'ProductsController.removeImage',
    'ProfitController.backfillSales',
    'ProfitController.validateSaleLines',
    'ProformaInvoicesController.create',
    'ProformaInvoicesController.convertToSalesOrder',
    'PurchaseOrdersController.create',
    'PurchaseOrdersController.receive',
    'QuotationsController.create',
    'QuotationsController.convertToSalesOrder',
    'ReceivablesController.create',
    'ReceivablesController.recordPayment',
    'ReceivablesController.writeOff',
    'RecordBookController.auditExport',
    'RecordBookController.createDailySale',
    'RecordBookController.updateDailySale',
    'RefundsController.create',
    'RefundsController.pay',
    'SalaryAdvancesController.pay',
    'SalesOrdersController.create',
    'SalesOrdersController.quickSale',
    'SalesOrdersController.mobilePosQuickSale',
    'SalesOrdersController.confirm',
    'ScheduledReportsController.run',
    'StockAdjustmentsController.post',
    'StockDamageController.post',
    'SupplierInvoicesController.create',
    'SupplierInvoicesController.runMatch',
    'SupplierInvoicesController.approve',
    'SupplierOrderDraftsController.create',
    'SupplierOrderDraftsController.update',
    'SupplierOrderDraftsController.duplicate',
    'SupplierOrderDraftsController.auditExport',
    'SuppliersController.create',
  ],
  'exact_effect_not_represented',
  'the operation has compound, bulk, ledger, child-row, external materialization, or dynamically derived effects that cannot be fully asserted by the current single-target mutation evidence contract.',
);

/**
 * Explicit reviewed exclusions only. This list is deliberately not derived
 * from the manifest: a new route fails the partition test until it receives a
 * concrete executable fixture or a reviewed machine-readable blocker.
 */
export const CRUD_MUTATION_NS_BLOCKERS: readonly CrudMutationBlocker[] = Object.freeze([
  ...auditBlockers,
  ...recoveryBlockers,
  ...exactEffectBlockers,
]);
