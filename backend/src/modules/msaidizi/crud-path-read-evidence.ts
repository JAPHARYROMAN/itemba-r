import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import {
  CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE,
  CrudFixtureGovernanceContract,
} from './crud-evidence-governance';

/**
 * A value owned by the disposable CRUD harness. `model:*` bindings are rows
 * created in the isolated schema; the remaining names refer to the original
 * core seed. A binding is never replaced with a random UUID at execution time.
 */
export type CrudPathReadBinding =
  | `model:${string}`
  | 'companyA'
  | 'companyB'
  | 'userA'
  | 'permissionA'
  | 'roleA'
  | 'customerA'
  | 'createdCustomerA'
  | 'cashAccountA'
  | 'chartOfAccountA'
  | 'productA'
  | 'entityTypeCustomer';

export interface CrudPathReadValue {
  binding?: CrudPathReadBinding;
  literal?: string | number | boolean;
}

export interface CrudPathReadArgumentBinding extends CrudPathReadValue {
  name: string;
}

export type CrudPathReadScopeAssertion =
  | {
      kind: 'company';
      /** Path in the unwrapped response record. */
      responsePath: readonly string[];
      binding: 'companyA';
    }
  | {
      kind: 'actor';
      /** Self-scoped records use their actor key rather than a company key. */
      responsePath: readonly string[];
      binding: 'userA';
    }
  | {
      /** The underlying domain is intentionally group/global, not tenant-owned. */
      kind: 'global';
    }
  | {
      /**
       * The response is a child/aggregate that omits companyId. Scope is proven
       * against the exact seeded parent used in the path, after the HTTP guard
       * has accepted that parent.
       */
      kind: 'seeded-company';
      seedModel: string;
      seedCompanyPath: readonly string[];
      binding: 'companyA';
    };

export interface CrudPathReadResponseContract {
  kind: 'record' | 'collection' | 'payload';
  /**
   * Exact identity for a record response, or an identity that must occur in a
   * collection. Omit only when the route is an aggregate/sub-resource whose
   * payload has no record identity of its own.
   */
  identity?: {
    responsePath: readonly string[];
    binding: CrudPathReadBinding;
  };
  scope: CrudPathReadScopeAssertion;
}

export interface CrudPathReadFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: 'positive';
  description: string;
  governance: CrudFixtureGovernanceContract;
  packId: string;
  expectedPath: string;
  pathBindings: readonly CrudPathReadArgumentBinding[];
  queryBindings: readonly CrudPathReadArgumentBinding[];
  response: CrudPathReadResponseContract;
  /** Reviewed execution identity needed by the route guard; permissions remain unchanged. */
  executionPrincipal?: 'company' | 'group';
  /** Prisma model the isolated harness must seed before invoking this route. */
  seedModel?: string;
}

export interface CrudPathReadFixturePack {
  packId: string;
  packVersion: number;
  fixtures: readonly CrudPathReadFixtureRegistration[];
}

interface CrudPathReadDefinition extends Omit<
  CrudPathReadFixtureRegistration,
  'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> {
  capabilityId: string;
}

interface CrudPathReadDefinitionPack {
  packId: string;
  definitions: readonly CrudPathReadDefinition[];
}

const id = (model: string): CrudPathReadBinding => `model:${model}`;
const pathId = (model: string): readonly CrudPathReadArgumentBinding[] => [
  { name: 'id', binding: id(model) },
];

function companyRecord(
  capabilityId: string,
  expectedPath: string,
  model: string,
  responseCompanyPath: readonly string[] = ['companyId'],
): CrudPathReadDefinition {
  return {
    capabilityId,
    expectedPath,
    pathBindings: pathId(model),
    queryBindings: [],
    response: {
      kind: 'record',
      identity: { responsePath: ['id'], binding: id(model) },
      scope: { kind: 'company', responsePath: responseCompanyPath, binding: 'companyA' },
    },
    seedModel: model,
  };
}

function actorRecord(
  capabilityId: string,
  expectedPath: string,
  model: string,
  actorPath: readonly string[] = ['userId'],
): CrudPathReadDefinition {
  return {
    capabilityId,
    expectedPath,
    pathBindings: pathId(model),
    queryBindings: [],
    response: {
      kind: 'record',
      identity: { responsePath: ['id'], binding: id(model) },
      scope: { kind: 'actor', responsePath: actorPath, binding: 'userA' },
    },
    seedModel: model,
  };
}

function globalRecord(
  capabilityId: string,
  expectedPath: string,
  model: string,
): CrudPathReadDefinition {
  return {
    capabilityId,
    expectedPath,
    pathBindings: pathId(model),
    queryBindings: [],
    response: {
      kind: 'record',
      identity: { responsePath: ['id'], binding: id(model) },
      scope: { kind: 'global' },
    },
    seedModel: model,
  };
}

const platformDefinitions = Object.freeze([
  companyRecord('ActiveSessionsController.findOne', 'active-sessions/:id', 'ActiveSession'),
  companyRecord('AlertEventsController.findOne', 'alert-events/:id', 'AlertEvent'),
  companyRecord('AlertRulesController.findOne', 'alert-rules/:id', 'AlertRule'),
  companyRecord('ApiClientsController.findOne', 'api-clients/:id', 'ApiClient'),
  companyRecord('ApiKeysController.findOne', 'api-keys/:id', 'ApiKey', ['apiClient', 'companyId']),
  companyRecord('AutomationRulesController.findOne', 'automation-rules/:id', 'AutomationRule'),
  companyRecord('AutomationRunsController.findOne', 'automation-runs/:id', 'AutomationRun'),
  companyRecord('BackgroundJobsController.findOne', 'background-jobs/:id', 'BackgroundJob'),
  globalRecord('BackupJobsController.findOne', 'backup-jobs/:id', 'BackupJob'),
  globalRecord('BackupRunsController.findOne', 'backup-runs/:id', 'BackupRun'),
  companyRecord('CacheManagementController.findOne', 'cache/:id', 'CacheEntry'),
  companyRecord('DataExportsController.findOne', 'data-exports/:id', 'DataExportLog'),
  {
    ...globalRecord(
      'DataIsolationIssuesController.findOne',
      'data-isolation-issues/:id',
      'DataIsolationTestIssue',
    ),
    executionPrincipal: 'group',
  },
  {
    ...globalRecord(
      'DataIsolationTestsController.findOne',
      'data-isolation-tests/:id',
      'DataIsolationTestRun',
    ),
    executionPrincipal: 'group',
  },
  companyRecord(
    'DocumentTemplatesController.findOne',
    'document-templates/:id',
    'DocumentTemplate',
  ),
  companyRecord(
    'DocumentNumberSequencesController.findOne',
    'document-number-sequences/:id',
    'DocumentNumberSequence',
  ),
  companyRecord('ExternalMessagesController.findOne', 'external-messages/:id', 'ExternalMessage'),
  companyRecord('ExternalPaymentsController.findOne', 'external-payments/:id', 'ExternalPayment'),
  companyRecord(
    'GeneratedDocumentsController.findOne',
    'generated-documents/:id',
    'GeneratedDocument',
  ),
  companyRecord(
    'IntegrationConnectionsController.findOne',
    'integration-connections/:id',
    'IntegrationConnection',
  ),
  companyRecord(
    'IntegrationEventsController.findOne',
    'integration-events/:id',
    'IntegrationEvent',
  ),
  companyRecord(
    'IntegrationMappingsController.findOne',
    'integration-mappings/:id',
    'IntegrationMapping',
  ),
  globalRecord(
    'IntegrationProvidersController.findOne',
    'integration-providers/:id',
    'IntegrationProvider',
  ),
  globalRecord('JobQueueConfigsController.findOne', 'job-queue-configs/:id', 'JobQueueConfig'),
  companyRecord('MessageTemplatesController.findOne', 'message-templates/:id', 'MessageTemplate'),
  companyRecord('MobileSessionsController.findOne', 'mobile-sessions/:id', 'MobileSession'),
  companyRecord('NotificationsController.findOne', 'notifications/:id', 'Notification'),
  companyRecord(
    'OfflineSyncController.findOneBatch',
    'offline-sync/batches/:id',
    'OfflineSyncBatch',
  ),
  companyRecord(
    'SavedReportViewsController.findOne',
    'bi/saved-report-views/:id',
    'SavedReportView',
  ),
  companyRecord(
    'ScheduledReportsController.findOne',
    'bi/scheduled-reports/:id',
    'ScheduledReport',
  ),
  companyRecord('SecurityEventsController.findOne', 'security-events/:id', 'SecurityEvent'),
  companyRecord('SecurityPoliciesController.findOne', 'security-policies/:id', 'SecurityPolicy'),
  companyRecord('TasksController.findOne', 'tasks/:id', 'Task'),
  globalRecord('PermissionsController.findOne', 'permissions/:id', 'Permission'),
  globalRecord('RolesController.findOne', 'roles/:id', 'Role'),
  actorRecord(
    'UserSecurityProfilesController.findOne',
    'user-security-profiles/:id',
    'UserSecurityProfile',
  ),
  companyRecord('WebhookEndpointsController.findOne', 'webhook-endpoints/:id', 'WebhookEndpoint'),
  companyRecord('WebhookEventsController.findOne', 'webhook-events/:id', 'WebhookEvent'),
] satisfies readonly CrudPathReadDefinition[]);

const governanceDefinitions = Object.freeze([
  companyRecord(
    'ApprovalDelegationsController.findOne',
    'approvals/delegations/:id',
    'ApprovalDelegation',
  ),
  companyRecord('ApprovalRequestsController.findOne', 'approvals/requests/:id', 'ApprovalRequest'),
  companyRecord(
    'ApprovalWorkflowsController.findOne',
    'approvals/workflows/:id',
    'ApprovalWorkflow',
  ),
  companyRecord('AuditAdjustmentsController.findOne', 'audit-adjustments/:id', 'AuditAdjustment'),
  companyRecord(
    'AuditEvidencePacksController.findOne',
    'audit-evidence-packs/:id',
    'AuditEvidencePack',
  ),
  companyRecord(
    'ComplianceDocumentRequirementsController.findOne',
    'compliance/document-requirements/:id',
    'ComplianceDocumentRequirement',
  ),
  companyRecord(
    'ComplianceDocumentStatusController.findOne',
    'compliance/document-status/:id',
    'ComplianceDocumentStatus',
  ),
  companyRecord('ComplianceEventsController.findOne', 'compliance/events/:id', 'ComplianceEvent'),
  companyRecord(
    'ComplianceObligationsController.findOne',
    'compliance/obligations/:id',
    'ComplianceObligation',
  ),
  companyRecord(
    'InternalControlsController.findOne',
    'internal-controls/:id',
    'InternalControlRule',
  ),
  globalRecord(
    'StatutoryDeductionRulesController.findOne',
    'compliance/statutory-rules/:id',
    'StatutoryDeductionRule',
  ),
] satisfies readonly CrudPathReadDefinition[]);

const financeDefinitions = Object.freeze([
  companyRecord(
    'BankReconciliationsController.findOne',
    'bank-reconciliations/:id',
    'BankReconciliation',
  ),
  companyRecord('CreditNotesController.findOne', 'credit-notes/:id', 'CreditNote'),
  companyRecord(
    'CustomerCreditProfilesController.findOne',
    'customer-credit-profiles/:id',
    'CustomerCreditProfile',
  ),
  companyRecord('CustomerPaymentsController.findOne', 'customer-payments/:id', 'CustomerPayment'),
  companyRecord(
    'CustomerPriceAgreementsController.findOne',
    'westsides/customer-price-agreements/:id',
    'CustomerPriceAgreement',
  ),
  companyRecord(
    'CustomerStatementsController.findOne',
    'customer-statements/:id',
    'CustomerStatementRun',
  ),
  companyRecord('DepreciationController.findOne', 'depreciation/:id', 'DepreciationSchedule'),
  companyRecord('ExpenseCategoriesController.findOne', 'expense-categories/:id', 'ExpenseCategory'),
  companyRecord('ExpensesController.findOne', 'expenses/:id', 'Expense'),
  companyRecord(
    'FinancialStatementsController.findOne',
    'financial-statements/:id',
    'FinancialStatementRun',
  ),
  {
    ...companyRecord(
      'IntercompanyTransactionsController.findOne',
      'intercompany-transactions/:id',
      'InterCompanyTransaction',
      ['fromCompanyId'],
    ),
  },
  companyRecord(
    'LoanRepaymentSchedulesController.findOne',
    'loan-repayment-schedules/:id',
    'LoanRepaymentSchedule',
  ),
  companyRecord('PayablesController.findOne', 'payables/:id', 'Payable'),
  companyRecord('PeriodCloseController.findOne', 'period-close/:id', 'AccountingPeriodClose'),
  companyRecord('PostingRulesController.findOne', 'posting-rules/:id', 'AccountingPostingRule'),
  companyRecord('PostingRunsController.findOne', 'posting-runs/:id', 'PostingRun'),
  companyRecord('ReceivablesController.findOne', 'receivables/:id', 'Receivable'),
  companyRecord('RefundsController.findOne', 'refunds/:id', 'Refund'),
  companyRecord(
    'RecordBookController.findCategory',
    'record-book/expense-categories/:id',
    'RecordBookExpenseCategory',
  ),
  companyRecord(
    'RecordBookController.findDailySale',
    'record-book/daily-sales/:id',
    'RecordBookDailySale',
  ),
  companyRecord(
    'RecordBookController.findExpense',
    'record-book/expenses/:id',
    'RecordBookExpense',
  ),
  companyRecord(
    'CompanyTaxRegistrationsController.findOne',
    'tax/registrations/:id',
    'CompanyTaxRegistration',
  ),
  globalRecord('TaxAuthoritiesController.findOne', 'tax/authorities/:id', 'TaxAuthority'),
  companyRecord('TaxCodesController.findOne', 'tax/codes/:id', 'TaxCode'),
  companyRecord('TaxFilingPeriodsController.findOne', 'tax/filing-periods/:id', 'TaxFilingPeriod'),
  companyRecord('TaxRatesController.findOne', 'tax/rates/:id', 'TaxRate'),
  companyRecord('TaxReturnsController.findOne', 'tax/returns/:id', 'TaxReturn'),
  companyRecord('TaxTransactionsController.findOne', 'tax/transactions/:id', 'TaxTransaction'),
  globalRecord('TaxTypesController.findOne', 'tax/types/:id', 'TaxType'),
] satisfies readonly CrudPathReadDefinition[]);

const operationsDefinitions = Object.freeze([
  companyRecord('BidComparisonsController.findOne', 'bid-comparisons/:id', 'BidComparison'),
  companyRecord('BusinessLicensesController.findOne', 'business-licenses/:id', 'BusinessLicense'),
  companyRecord(
    'CommunicationLogsController.findOne',
    'communication-logs/:id',
    'CommunicationLog',
  ),
  companyRecord('ContactPersonsController.findOne', 'contact-persons/:id', 'ContactPerson'),
  companyRecord('DeliveryNotesController.findOne', 'westsides/delivery-notes/:id', 'DeliveryNote'),
  companyRecord(
    'GoodsReceivedNotesController.findOne',
    'goods-received-notes/:id',
    'GoodsReceivedNote',
  ),
  companyRecord(
    'PackageMovementsController.findOne',
    'westsides/package-movements/:id',
    'PackageMovement',
  ),
  companyRecord('PriceListsController.findOne', 'westsides/price-lists/:id', 'PriceList'),
  companyRecord('ProcurementPlansController.findOne', 'procurement-plans/:id', 'ProcurementPlan'),
  companyRecord(
    'ProductBatchesController.findOne',
    'westsides/product-batches/:id',
    'ProductBatch',
  ),
  companyRecord(
    'ProformaInvoicesController.findOne',
    'westsides/proforma-invoices/:id',
    'ProformaInvoice',
  ),
  companyRecord('PurchaseOrdersController.findOne', 'purchase-orders/:id', 'PurchaseOrder'),
  companyRecord(
    'PurchaseRequisitionsController.findOne',
    'purchase-requisitions/:id',
    'PurchaseRequisition',
  ),
  companyRecord('QuotationsController.findOne', 'westsides/quotations/:id', 'Quotation'),
  companyRecord(
    'ReturnablePackagesController.findOne',
    'westsides/returnable-packages/:id',
    'ReturnablePackage',
  ),
  companyRecord('RfqsController.findOne', 'rfqs/:id', 'RequestForQuotation'),
  companyRecord('SalesChannelsController.findOne', 'westsides/sales-channels/:id', 'SalesChannel'),
  companyRecord('SalesCommissionsController.findOne', 'sales-commissions/:id', 'SalesCommission'),
  companyRecord('SalesOrdersController.findOne', 'sales-orders/:id', 'SalesOrder'),
  companyRecord('StockAdjustmentsController.findOne', 'stock-adjustments/:id', 'StockAdjustment'),
  companyRecord('StockDamageController.findOne', 'westsides/stock-damage/:id', 'StockDamage'),
  companyRecord('SupplierInvoicesController.findOne', 'supplier-invoices/:id', 'SupplierInvoice'),
  companyRecord(
    'SupplierOrderDraftsController.findOne',
    'supplier-order-drafts/:id',
    'SupplierOrderDraft',
  ),
  companyRecord(
    'SupplierPerformanceController.findOne',
    'supplier-performance/:id',
    'SupplierPerformanceProfile',
  ),
  companyRecord(
    'SupplierQuotationsController.findOne',
    'supplier-quotations/:id',
    'SupplierQuotation',
  ),
  companyRecord(
    'SupplierStatementsController.findOne',
    'supplier-statements/:id',
    'SupplierStatementRun',
  ),
  companyRecord('ThreeWayMatchingController.findOne', 'three-way-matching/:id', 'ThreeWayMatch'),
] satisfies readonly CrudPathReadDefinition[]);

const hrDefinitions = Object.freeze([
  companyRecord('AttendanceController.findOne', 'hr/attendance/:id', 'AttendanceRecord'),
  companyRecord(
    'DisciplinaryActionsController.findOne',
    'hr/disciplinary-actions/:id',
    'DisciplinaryAction',
  ),
  companyRecord(
    'EmployeeAllowancesController.findOne',
    'hr/employee-allowances/:id',
    'EmployeeAllowance',
  ),
  companyRecord(
    'EmployeeAssignmentsController.findOne',
    'hr/employee-assignments/:id',
    'EmployeeAssignment',
  ),
  companyRecord(
    'EmployeeDeductionsController.findOne',
    'hr/employee-deductions/:id',
    'EmployeeDeduction',
  ),
  companyRecord('EmployeesController.findOne', 'hr/employees/:id', 'Employee'),
  companyRecord(
    'EmploymentContractsController.findOne',
    'hr/employment-contracts/:id',
    'EmploymentContract',
  ),
  companyRecord(
    'EmploymentDisputesController.findOne',
    'hr/employment-disputes/:id',
    'EmploymentDispute',
  ),
  companyRecord('HrDocumentsController.findOne', 'hr/documents/:id', 'HRDocument'),
  companyRecord('LeaveBalancesController.findOne', 'hr/leave-balances/:id', 'LeaveBalance'),
  companyRecord('LeaveRequestsController.findOne', 'hr/leave-requests/:id', 'LeaveRequest'),
  companyRecord(
    'MedicalExamRecordsController.findOne',
    'hr/medical-exam-records/:id',
    'MedicalExamRecord',
  ),
  companyRecord(
    'OshaRegistrationsController.findOne',
    'hr/osha-registrations/:id',
    'OshaRegistration',
  ),
  companyRecord('PayrollEntriesController.findOne', 'hr/payroll-entries/:id', 'PayrollEntry'),
  companyRecord('PayrollRunsController.findOne', 'hr/payroll-runs/:id', 'PayrollRun'),
  companyRecord('PerformanceController.findOne', 'hr/performance/:id', 'PerformanceRecord'),
  companyRecord('SalaryAdvancesController.findOne', 'hr/salary-advances/:id', 'SalaryAdvance'),
  companyRecord('SalaryPaymentsController.findOne', 'hr/salary-payments/:id', 'SalaryPayment'),
  companyRecord('ShiftSchedulesController.findOne', 'hr/shift-schedules/:id', 'ShiftSchedule'),
] satisfies readonly CrudPathReadDefinition[]);

const companyScope = (
  responsePath: readonly string[] = ['companyId'],
): CrudPathReadScopeAssertion => ({
  kind: 'company',
  responsePath,
  binding: 'companyA',
});

const seededCompanyScope = (
  seedModel: string,
  seedCompanyPath: readonly string[] = ['companyId'],
): CrudPathReadScopeAssertion => ({
  kind: 'seeded-company',
  seedModel,
  seedCompanyPath,
  binding: 'companyA',
});

function collectionRead(
  capabilityId: string,
  expectedPath: string,
  pathBindings: readonly CrudPathReadArgumentBinding[],
  seedModel: string | undefined,
  identityBinding: CrudPathReadBinding | undefined,
  identityPath: readonly string[],
  scope: CrudPathReadScopeAssertion,
  queryBindings: readonly CrudPathReadArgumentBinding[] = [],
): CrudPathReadDefinition {
  return {
    capabilityId,
    expectedPath,
    pathBindings,
    queryBindings,
    response: {
      kind: 'collection',
      ...(identityBinding
        ? { identity: { responsePath: identityPath, binding: identityBinding } }
        : {}),
      scope,
    },
    ...(seedModel ? { seedModel } : {}),
  };
}

function payloadRead(
  capabilityId: string,
  expectedPath: string,
  pathBindings: readonly CrudPathReadArgumentBinding[],
  identity: CrudPathReadResponseContract['identity'],
  scope: CrudPathReadScopeAssertion,
  seedModel?: string,
  queryBindings: readonly CrudPathReadArgumentBinding[] = [],
): CrudPathReadDefinition {
  return {
    capabilityId,
    expectedPath,
    pathBindings,
    queryBindings,
    response: { kind: 'payload', ...(identity ? { identity } : {}), scope },
    ...(seedModel ? { seedModel } : {}),
  };
}

const derivedPathDefinitions = Object.freeze([
  collectionRead(
    'ApprovalStepsController.findByWorkflow',
    'approvals/workflows/:workflowId/steps',
    [{ name: 'workflowId', binding: id('ApprovalWorkflow') }],
    'ApprovalStep',
    id('ApprovalStep'),
    ['id'],
    seededCompanyScope('ApprovalWorkflow'),
  ),
  collectionRead(
    'AuditEvidencePacksController.listItems',
    'audit-evidence-packs/:id/items',
    [{ name: 'id', binding: id('AuditEvidencePack') }],
    'AuditEvidencePackItem',
    id('AuditEvidencePackItem'),
    ['id'],
    seededCompanyScope('AuditEvidencePack'),
  ),
  collectionRead(
    'AuditLogsController.findByEntity',
    'audit-logs/entity/:entityType/:entityId',
    [
      { name: 'entityType', binding: 'entityTypeCustomer' },
      { name: 'entityId', binding: 'createdCustomerA' },
    ],
    undefined,
    id('AuditLog'),
    ['id'],
    companyScope(),
  ),
  collectionRead(
    'AuditLogsController.findByUser',
    'audit-logs/user/:userId',
    [{ name: 'userId', binding: 'userA' }],
    undefined,
    id('AuditLog'),
    ['id'],
    companyScope(),
    [
      { name: 'page', literal: 1 },
      { name: 'limit', literal: 20 },
    ],
  ),
  collectionRead(
    'AutomationRunsController.getItems',
    'automation-runs/:id/items',
    [{ name: 'id', binding: id('AutomationRun') }],
    'AutomationRunItem',
    id('AutomationRunItem'),
    ['id'],
    seededCompanyScope('AutomationRun'),
  ),
  collectionRead(
    'BankReconciliationsController.getLines',
    'bank-reconciliations/:id/lines',
    [{ name: 'id', binding: id('BankReconciliation') }],
    'BankStatementLine',
    id('BankStatementLine'),
    ['id'],
    seededCompanyScope('BankReconciliation'),
  ),
  collectionRead(
    'CashAccountsController.findByCompany',
    'cash-accounts/company/:companyId',
    [{ name: 'companyId', binding: 'companyA' }],
    'CashAccount',
    id('CashAccount'),
    ['id'],
    companyScope(),
  ),
  collectionRead(
    'ChartOfAccountsController.findByCompany',
    'chart-of-accounts/company/:companyId',
    [{ name: 'companyId', binding: 'companyA' }],
    'ChartOfAccount',
    id('ChartOfAccount'),
    ['id'],
    companyScope(),
  ),
  {
    capabilityId: 'CompaniesController.getProfile',
    expectedPath: 'companies/:id/profile',
    pathBindings: [{ name: 'id', binding: 'companyA' }],
    queryBindings: [],
    response: {
      kind: 'record',
      identity: { responsePath: ['id'], binding: id('CompanyProfile') },
      scope: companyScope(),
    },
    seedModel: 'CompanyProfile',
  },
  collectionRead(
    'CompanyTaxRegistrationsController.findByCompany',
    'tax/registrations/company/:companyId',
    [{ name: 'companyId', binding: 'companyA' }],
    'CompanyTaxRegistration',
    id('CompanyTaxRegistration'),
    ['id'],
    companyScope(),
  ),
  payloadRead(
    'CustomersController.ledger',
    'customers/:id/ledger',
    [{ name: 'id', binding: 'customerA' }],
    { responsePath: ['customerId'], binding: 'customerA' },
    companyScope(),
  ),
  collectionRead(
    'CustomersController.productHistory',
    'customers/:id/product-history',
    [{ name: 'id', binding: 'customerA' }],
    'SalesOrderLine',
    'productA',
    ['product', 'id'],
    seededCompanyScope('Customer'),
  ),
  payloadRead(
    'CustomersController.profile',
    'customers/:id/profile',
    [{ name: 'id', binding: 'customerA' }],
    { responsePath: ['customer', 'id'], binding: 'customerA' },
    companyScope(['customer', 'companyId']),
  ),
  payloadRead(
    'CustomersController.receivablesSummary',
    'customers/:id/receivables-summary',
    [{ name: 'id', binding: 'customerA' }],
    { responsePath: ['customerId'], binding: 'customerA' },
    companyScope(),
  ),
  payloadRead(
    'CustomersController.salesSummary',
    'customers/:id/sales-summary',
    [{ name: 'id', binding: 'customerA' }],
    { responsePath: ['customerId'], binding: 'customerA' },
    companyScope(),
  ),
  {
    ...collectionRead(
      'DataIsolationTestsController.getIssues',
      'data-isolation-tests/:id/issues',
      [{ name: 'id', binding: id('DataIsolationTestRun') }],
      'DataIsolationTestIssue',
      id('DataIsolationTestIssue'),
      ['id'],
      { kind: 'global' },
    ),
    executionPrincipal: 'group',
  },
  collectionRead(
    'DepreciationController.getEntries',
    'depreciation/:scheduleId/entries',
    [{ name: 'scheduleId', binding: id('DepreciationSchedule') }],
    'DepreciationEntry',
    id('DepreciationEntry'),
    ['id'],
    companyScope(),
  ),
  collectionRead(
    'ExpensesController.paymentOptions',
    'expenses/:id/payment-options',
    [{ name: 'id', binding: id('Expense') }],
    'Expense',
    id('CashAccount'),
    ['id'],
    seededCompanyScope('Expense'),
  ),
  ...[
    ['FinancialReportsController.getBalanceSheet', 'financial-reports/balance-sheet/:companyId'],
    ['FinancialReportsController.getCashFlow', 'financial-reports/cash-flow/:companyId'],
    [
      'FinancialReportsController.getCompanySummary',
      'financial-reports/company-summary/:companyId',
    ],
    ['FinancialReportsController.getCustomerAging', 'financial-reports/customer-aging/:companyId'],
    ['FinancialReportsController.getPayablesAging', 'financial-reports/payables-aging/:companyId'],
    ['FinancialReportsController.getProfitAndLoss', 'financial-reports/profit-and-loss/:companyId'],
    [
      'FinancialReportsController.getReceivablesAging',
      'financial-reports/receivables-aging/:companyId',
    ],
    ['FinancialReportsController.getScopeRollup', 'financial-reports/scope-rollup/:companyId'],
    ['FinancialReportsController.getSupplierAging', 'financial-reports/supplier-aging/:companyId'],
    ['FinancialReportsController.getTrialBalance', 'financial-reports/trial-balance/:companyId'],
  ].map(([capabilityId, expectedPath]) =>
    payloadRead(
      capabilityId,
      expectedPath,
      [{ name: 'companyId', binding: 'companyA' }],
      { responsePath: ['companyId'], binding: 'companyA' },
      companyScope(),
    ),
  ),
  payloadRead(
    'FinancialReportsController.getCustomerAgingDetail',
    'financial-reports/customer-aging-detail/:companyId/:customerId',
    [
      { name: 'companyId', binding: 'companyA' },
      { name: 'customerId', binding: 'customerA' },
    ],
    { responsePath: ['customerId'], binding: 'customerA' },
    companyScope(),
  ),
  collectionRead(
    'LoanRepaymentSchedulesController.getPayments',
    'loan-repayment-schedules/:id/payments',
    [{ name: 'id', binding: id('LoanRepaymentSchedule') }],
    'LoanRepaymentPayment',
    id('LoanRepaymentPayment'),
    ['id'],
    companyScope(),
  ),
  collectionRead(
    'PackageMovementsController.findBalancesByCustomer',
    'westsides/package-movements/balances/customer/:customerId',
    [{ name: 'customerId', binding: 'customerA' }],
    'CustomerPackageBalance',
    id('CustomerPackageBalance'),
    ['id'],
    companyScope(),
  ),
  collectionRead(
    'PackageMovementsController.findByCustomer',
    'westsides/package-movements/customer/:customerId',
    [{ name: 'customerId', binding: 'customerA' }],
    'PackageMovement',
    id('PackageMovement'),
    ['id'],
    companyScope(),
  ),
  collectionRead(
    'PayslipsController.getForRun',
    'hr/payslips/run/:payrollRunId',
    [{ name: 'payrollRunId', binding: id('PayrollRun') }],
    'PayrollEntry',
    id('PayrollEntry'),
    ['entry', 'id'],
    companyScope(['company', 'id']),
  ),
  payloadRead(
    'PayslipsController.getOne',
    'hr/payslips/:id',
    [{ name: 'id', binding: id('PayrollEntry') }],
    { responsePath: ['entry', 'id'], binding: id('PayrollEntry') },
    companyScope(['company', 'id']),
    'PayrollEntry',
  ),
  collectionRead(
    'PostingRulesController.getLines',
    'posting-rules/:id/lines',
    [{ name: 'id', binding: id('AccountingPostingRule') }],
    'AccountingPostingRuleLine',
    id('AccountingPostingRuleLine'),
    ['id'],
    seededCompanyScope('AccountingPostingRule'),
  ),
  collectionRead(
    'PriceListsController.findItems',
    'westsides/price-lists/:id/items',
    [{ name: 'id', binding: id('PriceList') }],
    'PriceListItem',
    id('PriceListItem'),
    ['id'],
    seededCompanyScope('PriceList'),
  ),
  collectionRead(
    'ProductBatchesController.findByProduct',
    'westsides/product-batches/product/:productId',
    [{ name: 'productId', binding: 'productA' }],
    'ProductBatch',
    id('ProductBatch'),
    ['id'],
    companyScope(),
  ),
  payloadRead(
    'SalesOrdersController.controlCenter',
    'sales-orders/:id/control-center',
    [{ name: 'id', binding: id('SalesOrder') }],
    { responsePath: ['order', 'id'], binding: id('SalesOrder') },
    companyScope(['order', 'companyId']),
    'SalesOrder',
  ),
  payloadRead(
    'SalesOrdersController.fulfillment',
    'sales-orders/:id/fulfillment',
    [{ name: 'id', binding: id('SalesOrder') }],
    { responsePath: ['orderId'], binding: id('SalesOrder') },
    seededCompanyScope('SalesOrder'),
    'SalesOrder',
  ),
  payloadRead(
    'SalesOrdersController.ledger',
    'sales-orders/:id/ledger',
    [{ name: 'id', binding: id('SalesOrder') }],
    { responsePath: ['orderId'], binding: id('SalesOrder') },
    companyScope(),
    'SalesOrder',
  ),
  payloadRead(
    'SalesOrdersController.profit',
    'sales-orders/:id/profit',
    [{ name: 'id', binding: id('SalesOrder') }],
    { responsePath: ['orderId'], binding: id('SalesOrder') },
    seededCompanyScope('SalesOrder'),
    'SalesOrder',
  ),
  payloadRead(
    'SuppliersController.ledger',
    'suppliers/:id/ledger',
    [{ name: 'id', binding: id('Supplier') }],
    { responsePath: ['supplierId'], binding: id('Supplier') },
    companyScope(),
    'Supplier',
  ),
  payloadRead(
    'SuppliersController.payablesSummary',
    'suppliers/:id/payables-summary',
    [{ name: 'id', binding: id('Supplier') }],
    { responsePath: ['supplierId'], binding: id('Supplier') },
    companyScope(),
    'Supplier',
  ),
  payloadRead(
    'SuppliersController.purchaseSummary',
    'suppliers/:id/purchase-summary',
    [{ name: 'id', binding: id('Supplier') }],
    { responsePath: ['supplierId'], binding: id('Supplier') },
    companyScope(),
    'Supplier',
  ),
  payloadRead(
    'TaxFilingEngineController.preview',
    'tax-filing-engine/preview/:periodId',
    [{ name: 'periodId', binding: id('TaxFilingPeriod') }],
    undefined,
    companyScope(),
    'TaxFilingPeriod',
  ),
  {
    capabilityId: 'UserDashboardPreferencesController.get',
    expectedPath: 'bi/my-dashboards/:dashboardId/preferences',
    pathBindings: [{ name: 'dashboardId', binding: id('DashboardDefinition') }],
    queryBindings: [],
    response: {
      kind: 'record',
      identity: { responsePath: ['id'], binding: id('UserDashboardPreference') },
      scope: { kind: 'actor', responsePath: ['userId'], binding: 'userA' },
    },
    seedModel: 'UserDashboardPreference',
  },
] satisfies readonly CrudPathReadDefinition[]);

const definitionPacks: readonly CrudPathReadDefinitionPack[] = Object.freeze([
  { packId: 'path-record-platform', definitions: platformDefinitions },
  { packId: 'path-record-governance', definitions: governanceDefinitions },
  { packId: 'path-record-finance', definitions: financeDefinitions },
  { packId: 'path-record-operations', definitions: operationsDefinitions },
  { packId: 'path-record-hr', definitions: hrDefinitions },
  { packId: 'path-record-derived', definitions: derivedPathDefinitions },
]);

// These company-owned routes do not pass the authenticated actor into their
// service read and therefore cannot prove company isolation. They remain in the
// reviewed inventory, but are not registrable positive controls until the
// production route itself enforces scope. The evidence harness must not paper
// over an authorization defect by choosing an in-company seed.
const companyScopeUnenforcedCapabilities = new Set([
  'AutomationRulesController.findOne',
  'BidComparisonsController.findOne',
  'BusinessLicensesController.findOne',
  'CacheManagementController.findOne',
  'CommunicationLogsController.findOne',
  'CustomerPriceAgreementsController.findOne',
  'ExpenseCategoriesController.findOne',
  'LoanRepaymentSchedulesController.findOne',
  'LoanRepaymentSchedulesController.getPayments',
  'MedicalExamRecordsController.findOne',
  'MessageTemplatesController.findOne',
  'OshaRegistrationsController.findOne',
  'PackageMovementsController.findBalancesByCustomer',
  'PackageMovementsController.findByCustomer',
  'PackageMovementsController.findOne',
  'PostingRulesController.findOne',
  'PostingRulesController.getLines',
  'PriceListsController.findItems',
  'PriceListsController.findOne',
  'ProcurementPlansController.findOne',
  'ReturnablePackagesController.findOne',
  'SalesChannelsController.findOne',
  'SecurityPoliciesController.findOne',
]);

export type CrudPathReadBlockerReason =
  | 'company_scope_not_enforced'
  | 'read_writes_audit_ledger'
  | 'device_headers_not_represented'
  | 'binary_result_not_represented'
  | 'query_schema_not_strict'
  | 'persistent_file_fixture_required';

export interface CrudPathReadBlocker {
  capabilityId: string;
  reason: CrudPathReadBlockerReason;
  detail: string;
}

const scopeBlockers: readonly CrudPathReadBlocker[] = [
  ...[
    ...companyScopeUnenforcedCapabilities,
    'CcmNoticesController.cmaReferral',
    'CcmNoticesController.termination',
  ]
    .sort()
    .map((capabilityId) => ({
      capabilityId,
      reason: 'company_scope_not_enforced' as const,
      detail:
        'The company-owned path read does not carry the authenticated actor into a company-scope check.',
    })),
];

const auditMutationBlockers: readonly CrudPathReadBlocker[] = [
  'BankAccountsController.findOne',
  'ContractsController.findOne',
  'ContractsController.getAuditHistory',
  'CustomersController.controlCenter',
  'DebtsController.findOne',
  'DebtsController.getAuditHistory',
  'DocumentsController.findOne',
  'DocumentsController.download',
  'DocumentsController.getAuditHistory',
  'FixedAssetsController.findOne',
  'FixedAssetsController.getAuditHistory',
  'LoansController.findOne',
  'LoansController.getAuditHistory',
  'GeneratedDocumentsController.download',
  'RecordBookController.exportReport',
  'RecordBookController.findCategory',
  'RecordBookController.findDailySale',
  'RecordBookController.findExpense',
  'RecordBookController.runReport',
  'SuppliersController.controlCenter',
  'SuppliersController.findOne',
  'ScheduledReportsController.downloadRun',
].map((capabilityId) => ({
  capabilityId,
  reason: 'read_writes_audit_ledger' as const,
  detail:
    'The GET intentionally appends an audit row, so it cannot satisfy the tranche-wide no-mutation contract.',
}));

export const CRUD_PATH_READ_REMAINING_BLOCKERS: readonly CrudPathReadBlocker[] = Object.freeze(
  [
    ...scopeBlockers,
    ...auditMutationBlockers,
    ...['MobilePosLiteController.dayReportPdf', 'MobilePosLiteController.saleReceipt'].map(
      (capabilityId) => ({
        capabilityId,
        reason: 'device_headers_not_represented' as const,
        detail:
          'The terminal/device header contract is not represented by the explicit { path, query, body } agent envelope.',
      }),
    ),
    ...[
      'ProfitController.customerSummary',
      'ProfitController.productLedger',
      'ScheduledReportsController.listRuns',
    ].map((capabilityId) => ({
      capabilityId,
      reason: 'query_schema_not_strict' as const,
      detail: 'The route exposes a free-form query without a strict DTO-derived schema.',
    })),
    ...['ProductsController.getImage'].map((capabilityId) => ({
      capabilityId,
      reason: 'binary_result_not_represented' as const,
      detail:
        'The route returns binary bytes, but the production invoker has no governed artifact result representation.',
    })),
  ].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
);

const pathReadBlockerCapabilityIds = new Set(
  CRUD_PATH_READ_REMAINING_BLOCKERS.map((blocker) => blocker.capabilityId),
);

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function strictQueryMatches(
  capability: Capability,
  queryBindings: readonly CrudPathReadArgumentBinding[],
): boolean {
  const supplied = queryBindings.map((binding) => binding.name);
  if (!capability.params.freeFormQuery) {
    return sameNames(capability.params.query, supplied);
  }

  const querySchema = capability.params.querySchema;
  if (!querySchema || querySchema.quality !== 'strict') return false;
  const required = querySchema.schema.required ?? [];
  const properties = Object.keys(querySchema.schema.properties);
  return (
    required.every((name) => supplied.includes(name)) &&
    supplied.every((name) => properties.includes(name))
  );
}

/**
 * Returns reviewed path-record packs that still match the exact live route.
 * Missing or drifted definitions are deliberately absent rather than coerced
 * into status-smoke evidence.
 */
export function pathRecordReadEvidencePacks(
  manifest: readonly Capability[],
): readonly CrudPathReadFixturePack[] {
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const seenCapabilities = new Set<string>();

  return Object.freeze(
    definitionPacks.map((pack) => {
      const fixtures = pack.definitions
        .flatMap((definition): CrudPathReadFixtureRegistration[] => {
          if (seenCapabilities.has(definition.capabilityId)) {
            throw new Error(`Duplicate path-read definition for ${definition.capabilityId}.`);
          }
          seenCapabilities.add(definition.capabilityId);

          const capability = byId.get(definition.capabilityId);
          if (!capability) return [];
          if (capability.agentExcluded || capability.verb !== 'GET') return [];
          if (pathReadBlockerCapabilityIds.has(capability.id)) return [];
          if (capability.permissions.length === 0 && capability.anyPermissions.length === 0) {
            return [];
          }
          if (capability.path !== definition.expectedPath) return [];
          if (
            !sameNames(
              capability.params.path,
              definition.pathBindings.map((item) => item.name),
            )
          ) {
            return [];
          }
          if (!strictQueryMatches(capability, definition.queryBindings)) return [];

          const digest = createHash('sha256').update(capability.id).digest('hex').slice(0, 12);
          const slug = capability.id
            .replace(/Controller\./g, '-')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
          return [
            Object.freeze({
              fixtureId: `path-record-read-${slug}-${digest}`,
              fixtureVersion: 1,
              capabilityId: definition.capabilityId,
              controlKind: 'positive' as const,
              description: `Read the exact isolated ${definition.seedModel ?? 'domain'} record through ${definition.expectedPath}.`,
              governance: {
                scope: definition.response.scope.kind,
                audit: capabilityRequiresSensitiveAccessAudit(capability)
                  ? ('required' as const)
                  : ('not_applicable' as const),
                ...(capabilityRequiresSensitiveAccessAudit(capability)
                  ? { auditScope: CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE }
                  : {}),
              },
              packId: pack.packId,
              expectedPath: definition.expectedPath,
              pathBindings: definition.pathBindings,
              queryBindings: definition.queryBindings,
              response: definition.response,
              ...(definition.executionPrincipal
                ? { executionPrincipal: definition.executionPrincipal }
                : {}),
              ...(definition.seedModel ? { seedModel: definition.seedModel } : {}),
            }),
          ];
        })
        .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));

      return Object.freeze({
        packId: pack.packId,
        packVersion: 1,
        fixtures: Object.freeze(fixtures),
      });
    }),
  );
}

export const CRUD_PATH_READ_REVIEWED_DEFINITION_COUNT = definitionPacks.reduce(
  (sum, pack) => sum + pack.definitions.length,
  0,
);
