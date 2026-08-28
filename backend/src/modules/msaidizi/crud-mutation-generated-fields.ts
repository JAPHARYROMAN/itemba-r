import { Prisma } from '@prisma/client';
import { CrudMutationGeneratedField, CrudMutationValue } from './crud-mutation-evidence';

type GeneratedFieldMap = Readonly<Record<string, CrudMutationGeneratedField>>;

const literal = (value: string | number | boolean | null): CrudMutationValue => ({
  literal: value,
});
const binding = (name: string, path?: readonly string[]): CrudMutationValue => ({
  binding: name,
  ...(path ? { path } : {}),
});
const exact = (value: CrudMutationValue): CrudMutationGeneratedField => ({ kind: 'exact', value });
const actor = exact(binding('userA'));
const model = (name: string, path?: readonly string[]) => exact(binding(`model:${name}`, path));
const timestampId = (
  prefix: string,
  timestampEncoding: 'decimal' | 'base36-upper' = 'decimal',
  randomSuffix?: { alphabet: 'base36-upper'; length: number; separator: string },
): CrudMutationGeneratedField => ({
  kind: 'timestamp-id',
  prefix,
  timestampEncoding,
  ...(randomSuffix ? { randomSuffix } : {}),
});
const entityCode = (
  entityType: string,
  companyId?: CrudMutationValue,
): CrudMutationGeneratedField => ({
  kind: 'entity-code',
  entityType,
  ...(companyId ? { companyId } : {}),
});

const companyA = binding('companyA');
const nowIso: CrudMutationValue = { now: 'iso' };

const entries: [string, string, CrudMutationGeneratedField][] = [];
const add = (capabilityId: string, field: string, validator: CrudMutationGeneratedField) =>
  entries.push([capabilityId, field, validator]);

for (const [capabilityId, field] of [
  ['AccountingLocksController.create', 'createdById'],
  ['AlertRulesController.create', 'createdById'],
  ['ApiClientsController.create', 'createdById'],
  ['ApprovalDelegationsController.create', 'createdById'],
  ['ApprovalWorkflowsController.create', 'createdById'],
  ['AuditAdjustmentsController.create', 'createdById'],
  ['BackupJobsController.create', 'createdById'],
  ['AutomationRulesController.create', 'createdById'],
  ['CommunicationLogsController.create', 'createdById'],
  ['ContractsController.create', 'createdById'],
  ['DebtsController.create', 'createdById'],
  ['DepreciationController.create', 'createdById'],
  ['DocumentTemplatesController.create', 'createdById'],
  ['ExpensesController.create', 'createdById'],
  ['FixedAssetsController.create', 'createdById'],
  ['IntegrationConnectionsController.create', 'createdById'],
  ['IntercompanyTransactionsController.create', 'createdById'],
  ['InternalControlsController.create', 'createdById'],
  ['LoansController.create', 'createdById'],
  ['MessageTemplatesController.create', 'createdById'],
  ['PackageMovementsController.create', 'createdById'],
  ['PeriodCloseController.create', 'createdById'],
  ['PostingRulesController.create', 'createdById'],
  ['PriceListsController.create', 'createdById'],
  ['ProcurementPlansController.create', 'createdById'],
  ['RfqsController.create', 'createdById'],
  ['RecordBookController.createExpense', 'createdById'],
  ['SalesCommissionsController.create', 'createdById'],
  ['ScheduledReportsController.create', 'createdById'],
  ['SecurityPoliciesController.create', 'createdById'],
  ['SupplierQuotationsController.create', 'createdById'],
  ['WebhookEndpointsController.create', 'createdById'],
  ['ApprovalRequestsController.create', 'requestedById'],
  ['PurchaseRequisitionsController.create', 'requestedById'],
  ['ApprovalRequestsController.addComment', 'actionById'],
  ['BankReconciliationsController.create', 'preparedById'],
  ['BidComparisonsController.create', 'preparedById'],
  ['CustomerStatementsController.generate', 'generatedById'],
  ['FinancialStatementsController.generate', 'generatedById'],
  ['PrintEngineController.render', 'generatedById'],
  ['SupplierStatementsController.generate', 'generatedById'],
  ['DataIsolationTestsController.create', 'startedById'],
  ['DisciplinaryActionsController.create', 'issuedById'],
  ['EmploymentDisputesController.create', 'raisedById'],
  ['EmploymentDisputesController.createDirectGrievance', 'raisedById'],
  ['GoodsReceivedNotesController.create', 'receivedById'],
  ['OfflineSyncController.upsertCheckpoint', 'userId'],
  ['SavedReportViewsController.create', 'userId'],
  ['StockDamageController.create', 'reportedById'],
  ['SupplierPerformanceController.create', 'reviewedById'],
] as const) {
  add(capabilityId, field, actor);
}

for (const [capabilityId, field, prefix, encoding, suffix] of [
  ['AlertRulesController.create', 'alertRuleCode', 'RULE-', 'decimal', undefined],
  ['ApprovalRequestsController.create', 'approvalRequestNumber', 'REQ-', 'decimal', undefined],
  ['ApprovalWorkflowsController.create', 'workflowCode', 'WF-', 'decimal', undefined],
  ['BackupJobsController.create', 'backupJobCode', 'BJ-', 'decimal', undefined],
  ['ActiveSessionsController.create', 'sessionCode', 'SS-', 'decimal', undefined],
  [
    'AutomationRunsController.trigger',
    'automationRunNumber',
    'RUN-',
    'decimal',
    { alphabet: 'base36-upper', length: 4, separator: '-' },
  ],
  ['BackgroundJobsController.enqueue', 'jobNumber', 'JOB-', 'decimal', undefined],
  ['CustomerStatementsController.generate', 'statementRunNumber', 'CSTAT-', 'decimal', undefined],
  ['DataIsolationTestsController.create', 'testRunNumber', 'ISO-', 'decimal', undefined],
  ['FinancialStatementsController.generate', 'statementRunNumber', 'FSR-', 'decimal', undefined],
  ['ExternalMessagesController.create', 'messageNumber', 'MSG-', 'base36-upper', undefined],
  ['ExternalPaymentsController.create', 'paymentNumber', 'PAY-', 'base36-upper', undefined],
  ['InternalControlsController.create', 'controlCode', 'CTRL-', 'decimal', undefined],
  ['PrintEngineController.render', 'generatedDocumentNumber', 'DOC-', 'decimal', undefined],
  [
    'ProductsController.create',
    'productCode',
    'PRD-',
    'base36-upper',
    {
      alphabet: 'base36-upper',
      length: 4,
      separator: '',
    },
  ],
  ['SecurityEventsController.create', 'eventNumber', 'SE-', 'decimal', undefined],
  ['SecurityPoliciesController.create', 'policyCode', 'SP-', 'decimal', undefined],
  ['SupplierStatementsController.generate', 'statementRunNumber', 'SSTAT-', 'decimal', undefined],
  ['TasksController.create', 'taskNumber', 'TASK-', 'decimal', undefined],
] as const) {
  add(capabilityId, field, timestampId(prefix, encoding as 'decimal' | 'base36-upper', suffix));
}

for (const [capabilityId, field, entityType, companyId] of [
  ['AuditAdjustmentsController.create', 'adjustmentNumber', 'AuditAdjustment', companyA],
  ['AttendanceController.create', 'attendanceNumber', 'AttendanceRecord', companyA],
  ['CommunicationLogsController.create', 'communicationNumber', 'CommunicationLog', undefined],
  ['CustomerSegmentsController.create', 'segmentCode', 'CustomerSegment', undefined],
  ['DisciplinaryActionsController.create', 'actionNumber', 'DisciplinaryAction', companyA],
  ['EmploymentContractsController.create', 'contractCode', 'EmploymentContract', companyA],
  ['EmploymentDisputesController.create', 'disputeNumber', 'EmploymentDispute', companyA],
  [
    'EmploymentDisputesController.createDirectGrievance',
    'disputeNumber',
    'EmploymentDispute',
    companyA,
  ],
  ['ExpensesController.create', 'expenseNumber', 'Expense', companyA],
  [
    'IntercompanyTransactionsController.create',
    'transactionNumber',
    'IntercompanyTransaction',
    companyA,
  ],
  ['LeaveRequestsController.create', 'leaveRequestNumber', 'LeaveRequest', companyA],
  ['PackageMovementsController.create', 'movementNumber', 'PackageMovement', companyA],
  ['PayrollPeriodsController.create', 'payrollPeriodCode', 'PayrollPeriod', companyA],
  ['PayrollRunsController.create', 'payrollRunNumber', 'PayrollRun', companyA],
  ['SalaryAdvancesController.create', 'advanceNumber', 'SalaryAdvance', companyA],
  ['SalaryPaymentsController.create', 'salaryPaymentNumber', 'SalaryPayment', companyA],
] as const) {
  add(capabilityId, field, entityCode(entityType, companyId));
}

const companyPrefix = (segment: 'DEPT' | 'POS', strategy: 'first-unused-prefix') =>
  ({
    kind: 'scoped-sequence-id',
    separator: '-',
    prefixParts: [
      {
        kind: 'company-code',
        companyId: companyA,
        preferredField: 'employeeCodePrefix',
        fallbackField: 'code',
        fallbackLength: 4,
      },
      { kind: 'literal', value: segment },
    ],
    scope: { companyId: companyA },
    counter: { strategy, padding: 3 },
  }) as const satisfies CrudMutationGeneratedField;

add('DepartmentsController.create', 'departmentCode', companyPrefix('DEPT', 'first-unused-prefix'));
add('PositionsController.create', 'positionCode', companyPrefix('POS', 'first-unused-prefix'));
add('EmployeesController.create', 'employeeCode', {
  kind: 'scoped-sequence-id',
  separator: '-',
  prefixParts: [
    {
      kind: 'company-code',
      companyId: companyA,
      preferredField: 'employeeCodePrefix',
      fallbackField: 'code',
      fallbackLength: 4,
    },
    { kind: 'literal', value: 'EMP' },
  ],
  scope: { companyId: companyA },
  counter: { strategy: 'count-scope', padding: 4 },
});
add('ProductBatchesController.create', 'batchNumber', {
  kind: 'scoped-sequence-id',
  separator: '-',
  prefixParts: [{ kind: 'literal', value: 'BATCH' }, { kind: 'action-year' }],
  scope: { companyId: companyA },
  counter: { strategy: 'count-prefix', padding: 5 },
});
add('ReturnablePackagesController.create', 'packageCode', {
  kind: 'scoped-sequence-id',
  separator: '-',
  prefixParts: [
    { kind: 'literal', value: 'PKG' },
    { kind: 'company-id-fragment', companyId: companyA, length: 8 },
    { kind: 'action-year' },
  ],
  scope: { companyId: companyA },
  counter: { strategy: 'count-prefix', padding: 5 },
});
add('StockDamageController.create', 'damageNumber', {
  kind: 'scoped-sequence-id',
  separator: '-',
  prefixParts: [{ kind: 'literal', value: 'DMG' }, { kind: 'action-year' }],
  scope: { companyId: companyA },
  counter: { strategy: 'count-prefix', padding: 5 },
});

for (const [capabilityId, field, validator] of [
  ['ApprovalRequestsController.addComment', 'approvalRequestId', model('ApprovalRequest')],
  ['AuditEvidencePacksController.addItem', 'evidencePackId', model('AuditEvidencePack')],
  ['BankReconciliationsController.addLine', 'bankReconciliationId', model('BankReconciliation')],
  ['CustomerSegmentsController.addMember', 'customerSegmentId', model('CustomerSegment')],
  ['CustomerStatementsController.generate', 'customerId', model('Customer')],
  ['DepreciationController.addEntry', 'depreciationScheduleId', model('DepreciationSchedule')],
  ['DataIsolationTestsController.addIssue', 'testRunId', model('DataIsolationTestRun')],
  ['PostingRulesController.addLine', 'postingRuleId', model('AccountingPostingRule')],
  ['PriceListsController.addItem', 'priceListId', model('PriceList')],
  ['PrintEngineController.render', 'entityId', model('Customer')],
  ['SupplierStatementsController.generate', 'supplierId', model('Supplier')],
] as const) {
  add(capabilityId, field, validator);
}

add('EmploymentDisputesController.createDirectGrievance', 'raisedAt', exact(nowIso));
add('PayrollRunsController.create', 'runDate', exact(nowIso));
add('AutomationRunsController.trigger', 'automationRuleId', model('AutomationRule'));

add('AlertRulesController.create', 'condition', exact({ object: {} }));
add(
  'ApprovalRequestsController.addComment',
  'stepOrder',
  model('ApprovalRequest', ['currentStepOrder']),
);
add('EmploymentDisputesController.createDirectGrievance', 'type', exact(literal('GRIEVANCE')));
add('PrintEngineController.render', 'entityType', exact(literal('Customer')));
add('PrintEngineController.render', 'title', {
  kind: 'value-with-action-iso-suffix',
  value: binding('model:DocumentTemplate', ['name']),
  separator: ' - ',
});
add('PrintEngineController.render', 'renderedContent', model('DocumentTemplate', ['content']));
add('ProductBatchesController.create', 'remainingQuantity', exact(literal(8)));
add('SecurityPoliciesController.create', 'settings', exact({ object: {} }));
add('WebhookEndpointsController.create', 'secretHash', {
  kind: 'response-secret-digest',
  responsePath: ['rawSecret'],
  algorithm: 'sha256',
  encoding: 'hex',
});

// Service-owned optional/default scalars that are deliberately overwritten on create.
add('ActiveSessionsController.create', 'startedAt', { kind: 'action-time' });
add('ActiveSessionsController.create', 'lastActivityAt', { kind: 'action-time' });
add('ActiveSessionsController.create', 'expiresAt', { kind: 'action-time', offsetMs: 86_400_000 });
add('ActiveSessionsController.create', 'sessionType', exact(literal('WEB')));
add('ActiveSessionsController.create', 'status', exact(literal('ACTIVE')));
add('AutomationRunsController.trigger', 'status', exact(literal('RUNNING')));
add('AutomationRunsController.trigger', 'startedById', actor);
add('AutomationRunsController.trigger', 'startedAt', { kind: 'action-time' });
add('BackupJobsController.create', 'scheduleConfig', exact({ object: {} }));
add('BackupJobsController.create', 'retentionDays', exact(literal(30)));
add('BackupJobsController.create', 'nextRunAt', exact(literal(null)));
add('BackgroundJobsController.enqueue', 'requestedById', actor);
add('BackgroundJobsController.enqueue', 'scheduledAt', exact(literal(null)));
add('BackgroundJobsController.enqueue', 'correlationId', exact(literal(null)));
add('BackgroundJobsController.enqueue', 'idempotencyKey', exact(literal(null)));
add('DocumentNumberSequencesController.create', 'currentNumber', exact(literal(1)));
add('AttendanceController.create', 'divisionId', model('Employee', ['divisionId']));
add('AttendanceController.create', 'branchId', model('Branch'));
add('AttendanceController.create', 'attendanceStatus', exact(literal('UNPAID_ABSENT')));
for (const capabilityId of [
  'CustomerStatementsController.generate',
  'SupplierStatementsController.generate',
] as const) {
  const source =
    capabilityId === 'CustomerStatementsController.generate'
      ? 'customer-statement'
      : 'supplier-statement';
  for (const field of [
    'openingBalance',
    'totalDebits',
    'totalCredits',
    'closingBalance',
  ] as const) {
    add(capabilityId, field, { kind: 'independent-domain-aggregate', source });
  }
  add(capabilityId, 'currency', exact(literal('TZS')));
  add(capabilityId, 'status', exact(literal('GENERATED')));
}
add('FinancialStatementsController.generate', 'resultSummary', {
  kind: 'independent-domain-aggregate',
  source: 'financial-trial-balance',
});
add('FinancialStatementsController.generate', 'generatedAt', { kind: 'action-time' });
add('SupplierPerformanceController.create', 'lastReviewedAt', { kind: 'action-time' });
add('FinancialStatementsController.generate', 'status', exact(literal('GENERATED')));
for (const capabilityId of [
  'EmploymentDisputesController.create',
  'EmploymentDisputesController.createDirectGrievance',
] as const) {
  add(capabilityId, 'divisionId', model('Employee', ['divisionId']));
  add(capabilityId, 'branchId', model('Branch'));
}
add('EmploymentDisputesController.createDirectGrievance', 'directToGroupHr', exact(literal(true)));
add('LeaveRequestsController.create', 'divisionId', model('Employee', ['divisionId']));
add('LeaveRequestsController.create', 'branchId', model('Branch'));
add('PositionsController.create', 'currency', exact(literal('TZS')));
add('ExternalMessagesController.create', 'createdById', actor);
add('ExternalPaymentsController.create', 'initiatedById', actor);
add('PrintEngineController.render', 'companyId', model('DocumentTemplate', ['companyId']));
add(
  'PrintEngineController.render',
  'metadata',
  exact({ object: { mimeType: literal('text/plain') } }),
);
add('SecurityEventsController.create', 'metadata', exact({ object: {} }));
add('TasksController.create', 'assignedById', actor);
add('ApprovalRequestsController.addComment', 'action', exact(literal('COMMENTED')));
add('CustomersController.create', 'divisionId', model('Branch', ['divisionId']));
add('CustomersController.create', 'createdById', actor);
add('CustomersController.create', 'updatedById', actor);
add('CustomersController.create', 'creditLimit', exact(literal(0)));
add('CustomersController.create', 'status', exact(literal('ACTIVE')));
add('ApprovalRequestsController.create', 'status', exact(literal('DRAFT')));
add('DocumentTemplatesController.create', 'status', exact(literal('ACTIVE')));
add('CustomerSegmentsController.addMember', 'assignedById', actor);
add('ScheduledReportsController.create', 'nextRunAt', {
  kind: 'action-local-calendar-days',
  offsetDays: 1,
});
add('SalesCommissionsController.create', 'currency', model('SalesOrder', ['currency']));
add('PerformanceController.create', 'divisionId', model('Employee', ['divisionId']));
add('PerformanceController.create', 'branchId', model('Employee', ['branchId']));

const mutableByCapability: Record<string, Record<string, CrudMutationGeneratedField>> = {};
for (const [capabilityId, field, validator] of entries) {
  const fields = (mutableByCapability[capabilityId] ??= {});
  if (fields[field]) {
    throw new Error(`Duplicate generated mutation field ${capabilityId}.${field}.`);
  }
  fields[field] = validator;
}

export const CRUD_MUTATION_GENERATED_FIELDS: Readonly<Record<string, GeneratedFieldMap>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(mutableByCapability).map(([capabilityId, fields]) => [
        capabilityId,
        Object.freeze(fields),
      ]),
    ),
  );

const EMPTY_GENERATED_FIELDS: GeneratedFieldMap = Object.freeze({});

export function generatedFieldsForCapability(capabilityId: string): GeneratedFieldMap {
  return CRUD_MUTATION_GENERATED_FIELDS[capabilityId] ?? EMPTY_GENERATED_FIELDS;
}

export function createFrameworkFieldsForModel(modelName: string): readonly string[] {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  if (!model) throw new Error(`Unknown create evidence model ${modelName}.`);
  return Object.freeze(
    ['id', 'createdAt', 'updatedAt'].filter((name) =>
      model.fields.some((field) => field.kind !== 'object' && field.name === name),
    ),
  );
}
