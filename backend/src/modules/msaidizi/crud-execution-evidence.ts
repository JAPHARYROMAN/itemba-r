import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Capability } from '../../common/capabilities/capability-manifest';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import { derivedReportReadEvidencePacks } from './crud-derived-report-read-evidence';
import { domainHeaderEvidencePacks } from './crud-domain-header-evidence';
import { globalAdminReadEvidencePack } from './crud-global-admin-read-evidence';
import { mutationEvidencePacksForManifest } from './crud-mutation-evidence-registry';
import {
  CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE,
  CrudFixtureGovernanceContract,
  CrudFixtureGovernanceScope,
} from './crud-evidence-governance';
import { pathRecordReadEvidencePacks } from './crud-path-read-evidence';
import { remainingReadEvidencePack } from './crud-remaining-read-evidence';
import { westsidesReportReadEvidencePack } from './crud-westsides-report-read-evidence';
import type { CrudEvidenceMetadataSeedFields } from './crud-evidence-fixture-isolation';

export type {
  CrudDerivedReportArgumentBinding,
  CrudDerivedReportBinding,
  CrudDerivedReportOracle,
  CrudDerivedReportReadFixturePack,
  CrudDerivedReportReadFixtureRegistration,
  CrudDerivedReportRowExpectation,
  CrudDerivedReportScopeProbe,
  CrudDerivedReportValueExpectation,
} from './crud-derived-report-read-evidence';

export type {
  CrudGlobalAdminReadArgumentBinding,
  CrudGlobalAdminReadBinding,
  CrudGlobalAdminReadFixturePack,
  CrudGlobalAdminReadFixtureRegistration,
  CrudGlobalAdminReadScopeProbe,
} from './crud-global-admin-read-evidence';

export type {
  CrudDomainHeaderArgumentBinding,
  CrudDomainHeaderBinding,
  CrudDomainHeaderFixturePack,
  CrudDomainHeaderFixtureRegistration,
  CrudDomainHeaderMutationContract,
} from './crud-domain-header-evidence';

export type {
  CrudPathReadArgumentBinding,
  CrudPathReadBinding,
  CrudPathReadFixtureRegistration,
  CrudPathReadFixturePack,
  CrudPathReadResponseContract,
} from './crud-path-read-evidence';

export type {
  CrudRemainingReadArgumentBinding,
  CrudRemainingReadBinding,
  CrudRemainingReadFixturePack,
  CrudRemainingReadFixtureRegistration,
  CrudRemainingReadMarkerClaim,
  CrudRemainingReadRowClaim,
  CrudRemainingReadScopeProbe,
  CrudRemainingReadValueClaim,
} from './crud-remaining-read-evidence';

export type {
  CrudWestsidesReportReadFixturePack,
  CrudWestsidesReportReadFixtureRegistration,
  CrudWestsidesReportRequestKind,
  CrudWestsidesReportRowOracle,
  CrudWestsidesReportValueClaim,
} from './crud-westsides-report-read-evidence';

export const CRUD_EVIDENCE_CONTRACT = 'msaidizi-crud-execution-evidence/v2' as const;
export const CRUD_EVIDENCE_HARNESS_VERSION = '2.1.0' as const;
/**
 * Bounds one fixture's signed proof without forcing complex, exactly reconciled
 * mutations to collapse independent checks into an opaque aggregate assertion.
 */
export const CRUD_EVIDENCE_MAX_CASE_ASSERTIONS = 64;

export type CrudEvidenceControlKind =
  | 'positive'
  | 'permission_denial'
  | 'company_isolation'
  | 'audit_attribution'
  | 'service_principal_task_scope';

export type CrudEvidenceOutcome = 'passed' | 'failed' | 'skipped';

export interface CrudPositiveFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: 'positive';
  description: string;
  /** Signed, reviewed security semantics derived only from this fixture's passed assertions. */
  governance: CrudFixtureGovernanceContract;
}

export interface CrudMetadataReadFixtureRegistration extends CrudPositiveFixtureRegistration {
  /** Reviewed principal used by the isolated HTTP invocation. */
  executionPrincipal: 'actor' | 'company' | 'group';
  /** Exact, ordered query bytes for reads whose inclusion predicate is not the DTO default. */
  request?: {
    queryBindings: readonly CrudMetadataReadQueryBinding[];
  };
  /**
   * Signed A/B oracle for metadata-derived reads. Company-scoped fixtures use
   * the two isolated companies, while actor-scoped fixtures use the two
   * isolated users. The harness must observe the in-scope marker and prove the
   * out-of-scope marker is absent; a 2xx empty collection or arbitrary
   * non-null summary can never satisfy it.
   */
  observable: {
    kind: 'seeded-company-marker';
    /** Prisma model deliberately seeded in company A before this route executes. */
    seedModel: string;
    /** Exact semantic fields required for the route to include that seed. */
    seedFields?: CrudEvidenceMetadataSeedFields;
    present: { binding: 'companyA' | 'userA' };
    absent: { binding: 'companyB' | 'userB' };
    /** Same-company actor-B row that makes an actor exclusion assertion causal. */
    negativeControl?: {
      seedModel: string;
      actorField: 'assignedToId' | 'requestedById' | 'recipientUserId' | 'userId';
      actorBinding: 'userB';
      companyBinding: 'companyA';
    };
    /**
     * A fixture-private A/B seed that is created immediately before this read
     * and removed immediately afterwards. Generated IDs are resolved through
     * the signed bindings below, so both record inclusion and exclusion remain
     * causal without re-shaping a seed shared by mutation evidence.
     */
    causalRecordControl?: {
      seedScenario: CrudMetadataReadDedicatedSeedScenario;
      lifecycle: 'fixture_isolated';
      responseMarkerField: 'id';
      present: { binding: 'scenarioA'; companyBinding: 'companyA' };
      absent: { binding: 'scenarioB'; companyBinding: 'companyB' };
    };
  };
}

export type CrudMetadataReadQueryValueBinding = 'companyA' | 'divisionA' | 'branchA';

export type CrudMetadataReadQueryBinding =
  | {
      name: string;
      binding: CrudMetadataReadQueryValueBinding;
      literal?: never;
    }
  | {
      name: string;
      binding?: never;
      literal: string | number | boolean;
    };

export type CrudMetadataReadDedicatedSeedScenario =
  | 'receipt-account-company-pair-v1'
  | 'profit-cost-gap-product-company-pair-v1';

export interface CrudMetadataReadEvidenceBlocker {
  capabilityId: string;
  reason: 'no_deterministic_seeded_positive_control';
  detail: string;
}

export interface CrudMetadataReadFixturePack extends Omit<CrudEvidenceFixturePack, 'fixtures'> {
  fixtures: readonly CrudMetadataReadFixtureRegistration[];
}

export function evaluateMetadataReadCompanyMarkers(
  response: unknown,
  present: string,
  absent: string,
): { present: boolean; absent: boolean; observed: readonly string[] } {
  const observed = collectResponseStrings(response);
  return {
    present: observed.includes(present),
    absent: !observed.includes(absent),
    observed,
  };
}

export interface CrudSecurityFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: Exclude<CrudEvidenceControlKind, 'positive'>;
  description: string;
}

export type CrudFixtureRegistration =
  | CrudPositiveFixtureRegistration
  | CrudSecurityFixtureRegistration;

export interface CrudEvidenceFixturePack {
  packId: string;
  packVersion: number;
  fixtures: readonly CrudFixtureRegistration[];
}

export type CrudExactRecordBinding =
  | 'accountingLockA'
  | 'accountingPeriodA'
  | 'auditLogA'
  | 'branchA'
  | 'cashAccountA'
  | 'chartOfAccountA'
  | 'companyA'
  | 'customerSegmentA'
  | 'departmentA'
  | 'divisionA'
  | 'fiscalYearA'
  | 'inventoryBalanceA'
  | 'inventoryMovementA'
  | 'journalEntryA'
  | 'productA'
  | 'productCategoryA'
  | 'unitA'
  | 'userA'
  | 'allowanceTypeA'
  | 'deductionTypeA'
  | 'leaveTypeA'
  | 'payrollPeriodA'
  | 'positionA'
  | 'workShiftA';

export interface CrudExactRecordReadFixtureRegistration extends CrudPositiveFixtureRegistration {
  /** Logical harness record whose real UUID supplies the route's exact `:id`. */
  recordBinding: CrudExactRecordBinding;
  /** Path through the returned payload that must resolve to the seeded company. */
  responseCompanyPath: readonly string[];
}

/**
 * The deliberately small first fixture set. It is shared by the verifier and
 * the disposable-database harness, so a signed artifact cannot invent a case
 * for an operation the harness has no implementation for.
 *
 * Every other included capability remains explicitly unverified in the report.
 */
export const CRUD_EVIDENCE_FIXTURES: readonly CrudFixtureRegistration[] = Object.freeze([
  {
    fixtureId: 'customer-list-positive',
    fixtureVersion: 1,
    capabilityId: 'CustomersController.findAll',
    controlKind: 'positive',
    description: 'List a seeded company customer through the guarded loopback API.',
    governance: { scope: 'company', audit: 'not_applicable' },
  },
  {
    fixtureId: 'customer-create-permission-denial',
    fixtureVersion: 1,
    capabilityId: 'CustomersController.create',
    controlKind: 'permission_denial',
    description: 'A user with customers.view but not customers.create receives HTTP 403.',
  },
  {
    fixtureId: 'contracts-list-sensitive-permission-denial',
    fixtureVersion: 1,
    capabilityId: 'ContractsController.findAll',
    controlKind: 'permission_denial',
    description:
      'An authenticated user without contracts.view receives HTTP 403 and one strict sensitive-denial audit event.',
  },
  {
    fixtureId: 'fixed-assets-dispose-group-scope-denial',
    fixtureVersion: 1,
    capabilityId: 'FixedAssetsController.dispose',
    controlKind: 'permission_denial',
    description:
      'A COMPANY-scoped principal deliberately carrying fixed-assets.update receives HTTP 403 before disposal and emits one strict GROUP-scoped sensitive-denial audit event.',
  },
  {
    fixtureId: 'customer-company-isolation',
    fixtureVersion: 1,
    capabilityId: 'CustomersController.findOne',
    controlKind: 'company_isolation',
    description: 'A company-scoped user cannot read a customer from another company.',
  },
  {
    fixtureId: 'customer-agent-audit-attribution',
    fixtureVersion: 1,
    capabilityId: 'CustomersController.create',
    controlKind: 'audit_attribution',
    description: 'The loopback session is persisted as AGENT audit attribution.',
  },
  {
    fixtureId: 'customer-create-service-principal-task-scope',
    fixtureVersion: 1,
    capabilityId: 'CustomersController.create',
    controlKind: 'service_principal_task_scope',
    description:
      'A Collaborative task-issued SERVICE credential proves the live human, principal, and deployment grant intersection; exact capability and action-envelope scope; one-shot denial bookkeeping; full task audit attribution; and isolated recovery.',
  },
  {
    fixtureId: 'user-dashboard-list-autopilot-mandate-scope',
    fixtureVersion: 1,
    capabilityId: 'UserDashboardPreferencesController.list',
    controlKind: 'service_principal_task_scope',
    description:
      'An Autopilot GROUP-scoped SERVICE credential crosses both global and controller-local JWT guards exactly once, reads the actor dashboard list under an active exact mandate, consumes replay and live mandate-narrowing denials, and persists complete task audit attribution.',
  },
] satisfies readonly CrudFixtureRegistration[]);

export const CRUD_EVIDENCE_BASE_FIXTURE_PACK: CrudEvidenceFixturePack = Object.freeze({
  packId: 'base-governed-crud',
  packVersion: 1,
  fixtures: CRUD_EVIDENCE_FIXTURES,
});

/**
 * Exact record reads for which the disposable harness owns a real, company-A
 * seed. Keeping the execution binding beside the registration prevents a
 * manifest-derived `:id` fixture from silently falling back to a random UUID or
 * treating a 404 as evidence. Only endpoints with an explicit company scope in
 * their response are admitted to this pack.
 */
const exactRecordReadDefinitions: ReadonlyArray<
  Pick<
    CrudExactRecordReadFixtureRegistration,
    'capabilityId' | 'recordBinding' | 'responseCompanyPath'
  >
> = Object.freeze([
  {
    capabilityId: 'AccountingLocksController.findOne',
    recordBinding: 'accountingLockA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'AccountingPeriodsController.findOne',
    recordBinding: 'accountingPeriodA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'AuditLogsController.findOne',
    recordBinding: 'auditLogA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'BranchesController.findOne',
    recordBinding: 'branchA',
    responseCompanyPath: ['division', 'companyId'],
  },
  {
    capabilityId: 'CashAccountsController.findOne',
    recordBinding: 'cashAccountA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'ChartOfAccountsController.findOne',
    recordBinding: 'chartOfAccountA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'CompaniesController.findOne',
    recordBinding: 'companyA',
    responseCompanyPath: ['id'],
  },
  {
    capabilityId: 'CustomerSegmentsController.findOne',
    recordBinding: 'customerSegmentA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'DepartmentsController.findOne',
    recordBinding: 'departmentA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'DivisionsController.findOne',
    recordBinding: 'divisionA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'FiscalYearsController.findOne',
    recordBinding: 'fiscalYearA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'InventoryBalancesController.findOne',
    recordBinding: 'inventoryBalanceA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'InventoryMovementsController.findOne',
    recordBinding: 'inventoryMovementA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'JournalEntriesController.findOne',
    recordBinding: 'journalEntryA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'ProductCategoriesController.findOne',
    recordBinding: 'productCategoryA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'ProductsController.findOne',
    recordBinding: 'productA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'UnitsController.findOneUnit',
    recordBinding: 'unitA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'UsersController.findOne',
    recordBinding: 'userA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'AllowanceTypesController.findOne',
    recordBinding: 'allowanceTypeA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'DeductionTypesController.findOne',
    recordBinding: 'deductionTypeA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'LeaveTypesController.findOne',
    recordBinding: 'leaveTypeA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'PayrollPeriodsController.findOne',
    recordBinding: 'payrollPeriodA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'PositionsController.findOne',
    recordBinding: 'positionA',
    responseCompanyPath: ['companyId'],
  },
  {
    capabilityId: 'WorkShiftsController.findOne',
    recordBinding: 'workShiftA',
    responseCompanyPath: ['companyId'],
  },
]);

/**
 * Query values the disposable harness can derive from its own seeded company
 * without guessing an arbitrary business record or weakening DTO validation.
 * Optional DTO fields are omitted; named @Query parameters are supplied because
 * route metadata cannot tell whether the service treats them as optional.
 */
export const CRUD_EVIDENCE_METADATA_READ_QUERY_KEYS = Object.freeze([
  'companyId',
  'branchId',
  'divisionId',
  'fiscalYearId',
  'accountingPeriodId',
  'customerId',
  'startDate',
  'endDate',
  'date',
  'fromDate',
  'toDate',
  'asOfDate',
  'periodStart',
  'periodEnd',
  'month',
  'year',
  'page',
  'limit',
  'pageSize',
] as const);

const metadataReadQueryKeys = new Set<string>(CRUD_EVIDENCE_METADATA_READ_QUERY_KEYS);

// These reads require terminal/device headers that are intentionally absent
// from the agent's explicit { path, query, body } invocation envelope. They
// cannot become positive evidence until the route contract is represented
// without smuggling ambient headers into the model-addressable surface.
const metadataReadUnrepresentedHeaderCapabilities = new Set([
  'MobilePosLiteController.catalog',
  'MobilePosLiteController.customers',
  'MobilePosLiteController.mySalesToday',
  'MobilePosLiteController.products',
  'MobilePosLiteController.purchaseHistory',
  'MobilePosLiteController.salesHistory',
  'MobilePosLiteController.session',
  'MobilePosLiteController.stock',
  'MobilePosLiteController.suppliers',
]);

export const CRUD_QUERY_READ_REMAINING_BLOCKERS = Object.freeze([
  {
    capabilityId: 'DocumentsController.findByEntity',
    reason: 'read_writes_audit_ledger' as const,
    detail:
      'The GET entity listing appends DOCUMENT_ENTITY_LIST to AuditLog; it cannot satisfy a no-mutation read control.',
  },
  {
    capabilityId: 'FinanceController.getDashboard',
    reason: 'read_writes_audit_ledger' as const,
    detail:
      'The GET dashboard handler appends FINANCE_DASHBOARD_VIEW to AuditLog; it cannot satisfy a no-mutation read control.',
  },
  {
    capabilityId: 'ProfitController.exportReport',
    reason: 'read_writes_audit_ledger' as const,
    detail:
      'The GET export handler appends PROFIT_REPORT_EXPORT to AuditLog; it cannot satisfy a no-mutation read control.',
  },
  {
    capabilityId: 'RecordBookController.export',
    reason: 'read_writes_audit_ledger' as const,
    detail:
      'The GET export handler appends RECORD_BOOK_EXPORT to AuditLog; it cannot satisfy a no-mutation read control.',
  },
]);

const metadataReadMutationCapabilities = new Set(
  CRUD_QUERY_READ_REMAINING_BLOCKERS.map((blocker) => blocker.capabilityId),
);

/**
 * Live-response-reviewed routes whose seeded company-A model is serialized all
 * the way through the controller response. Anything outside this map remains
 * a machine-readable blocker; it cannot earn evidence from response shape.
 */
const metadataReadCompanyMarkerSeeds: Readonly<Record<string, string>> = Object.freeze({
  'AccountingLocksController.findAll': 'AccountingLock',
  'AccountingPeriodsController.findAll': 'AccountingPeriod',
  'ActiveSessionsController.findAll': 'ActiveSession',
  'AlertEventsController.findAll': 'AlertEvent',
  'AlertRulesController.findAll': 'AlertRule',
  'AllowanceTypesController.findAll': 'AllowanceType',
  'ApiClientsController.findAll': 'ApiClient',
  'ApiKeysController.findAll': 'ApiKey',
  'ApiRequestLogsController.findAll': 'ApiRequestLog',
  'ApprovalDelegationsController.findAll': 'ApprovalDelegation',
  'ApprovalRequestsController.findAll': 'ApprovalRequest',
  'ApprovalRequestsController.pendingForMe': 'ApprovalRequest',
  'ApprovalRequestsController.submittedByMe': 'ApprovalRequest',
  'ApprovalWorkflowsController.findAll': 'ApprovalWorkflow',
  'AttendanceController.findAll': 'AttendanceRecord',
  'AuditAdjustmentsController.findAll': 'AuditAdjustment',
  'AuditEvidencePacksController.findAll': 'AuditEvidencePack',
  'AuditLogsController.findSensitive': 'AuditLog',
  'AutomationRulesController.findAll': 'AutomationRule',
  'AutomationRunsController.findAll': 'AutomationRun',
  'BackgroundJobsController.findAll': 'BackgroundJob',
  'BankAccountsController.findAll': 'BankAccount',
  'BankAccountsController.getSummary': 'BankAccount',
  'BankReconciliationsController.findAll': 'BankReconciliation',
  'BidComparisonsController.findAll': 'BidComparison',
  'CacheManagementController.findAll': 'CacheEntry',
  'CashAccountsController.findAll': 'CashAccount',
  'ChartOfAccountsController.findAll': 'ChartOfAccount',
  'CommunicationLogsController.findAll': 'CommunicationLog',
  'CompaniesController.findAll': 'Company',
  'CompanyTaxRegistrationsController.findAll': 'CompanyTaxRegistration',
  'ComplianceCalendarController.findAll': 'ComplianceObligation',
  'ComplianceCalendarController.findOverdue': 'ComplianceObligation',
  'ComplianceDashboardController.getSummary': 'ComplianceDocumentStatus',
  'ComplianceDocumentRequirementsController.findAll': 'ComplianceDocumentRequirement',
  'ComplianceDocumentStatusController.findAll': 'ComplianceDocumentStatus',
  'ComplianceEventsController.findAll': 'ComplianceEvent',
  'ComplianceObligationsController.findAll': 'ComplianceObligation',
  'ComplianceReportsController.getDocumentStatusSummary': 'ComplianceDocumentStatus',
  'ContactPersonsController.findAll': 'ContactPerson',
  'ContractsController.findAll': 'Contract',
  'CreditNotesController.findAll': 'CreditNote',
  'CustomerCreditProfilesController.findAll': 'CustomerCreditProfile',
  'CustomerPaymentsController.findAll': 'CustomerPayment',
  'CustomerPriceAgreementsController.findAll': 'CustomerPriceAgreement',
  'CustomerSegmentsController.findAll': 'CustomerSegment',
  'CustomerStatementsController.findAll': 'CustomerStatementRun',
  'DashboardController.getExecutiveSummary': 'Company',
  'DataExportsController.findAll': 'DataExportLog',
  'DebtsController.findAll': 'Debt',
  'DebtsController.getOverdue': 'Debt',
  'DeductionTypesController.findAll': 'DeductionType',
  'DeliveryNotesController.findAll': 'DeliveryNote',
  'DepartmentsController.findAll': 'Department',
  'DepreciationController.findAll': 'DepreciationSchedule',
  'DisciplinaryActionsController.findAll': 'DisciplinaryAction',
  'DivisionsController.findAll': 'Division',
  'DocumentNumberSequencesController.findAll': 'DocumentNumberSequence',
  'DocumentsController.findAll': 'Document',
  'DocumentTemplatesController.findAll': 'DocumentTemplate',
  'EmployeeAllowancesController.findAll': 'EmployeeAllowance',
  'EmployeeAssignmentsController.findAll': 'EmployeeAssignment',
  'EmployeeDeductionsController.findAll': 'EmployeeDeduction',
  'EmployeesController.findAll': 'Employee',
  'EmploymentContractsController.findAll': 'EmploymentContract',
  'EmploymentDisputesController.findAll': 'EmploymentDispute',
  'ExpenseCategoriesController.findAll': 'ExpenseCategory',
  'ExpensesController.findAll': 'Expense',
  'ExternalMessagesController.findAll': 'ExternalMessage',
  'ExternalPaymentsController.findAll': 'ExternalPayment',
  'FinancialStatementsController.findAll': 'FinancialStatementRun',
  'FiscalYearsController.findAll': 'FiscalYear',
  'FixedAssetsController.findAll': 'FixedAsset',
  'FixedAssetsController.getSummary': 'FixedAsset',
  'GeneratedDocumentsController.findAll': 'GeneratedDocument',
  'GoodsReceivedNotesController.findAll': 'GoodsReceivedNote',
  'HrDocumentsController.findAll': 'HRDocument',
  'HrDashboardController.getDashboard': 'Employee',
  'HrReportsController.attendanceReport': 'AttendanceRecord',
  'HrReportsController.employeeReport': 'Employee',
  'HrReportsController.leaveReport': 'LeaveRequest',
  'HrReportsController.payrollReport': 'PayrollRun',
  'IntegrationConnectionsController.findAll': 'IntegrationConnection',
  'IntegrationEventsController.findAll': 'IntegrationEvent',
  'IntegrationMappingsController.findAll': 'IntegrationMapping',
  'InternalControlsController.findAll': 'InternalControlRule',
  'InventoryBalancesController.findAll': 'InventoryBalance',
  'InventoryMovementsController.findAll': 'InventoryMovement',
  'JournalEntriesController.findAll': 'JournalEntry',
  'LeaveBalancesController.findAll': 'LeaveBalance',
  'LeaveRequestsController.findAll': 'LeaveRequest',
  'LeaveTypesController.findAll': 'LeaveType',
  'LoanRepaymentSchedulesController.findAll': 'LoanRepaymentSchedule',
  'LoansController.findAll': 'Loan',
  'LoansController.getOverdue': 'Loan',
  'LoansController.getSummary': 'Loan',
  'MedicalExamRecordsController.findAll': 'MedicalExamRecord',
  'MessageTemplatesController.findAll': 'MessageTemplate',
  'MobilePosLiteController.findTerminals': 'MobilePosTerminal',
  'MobileSessionsController.findAll': 'MobileSession',
  'NotificationsController.findAll': 'Notification',
  'NotificationsController.findMy': 'Notification',
  'OfflineSyncController.findAllBatches': 'OfflineSyncBatch',
  'OfflineSyncController.findConflicts': 'OfflineSyncRecord',
  'OshaRegistrationsController.findAll': 'OshaRegistration',
  'PackageMovementsController.findAll': 'PackageMovement',
  'PayablesController.findAccounts': 'Payable',
  'PayablesController.findAll': 'Payable',
  'PayrollEntriesController.findAll': 'PayrollEntry',
  'PayrollPeriodsController.findAll': 'PayrollPeriod',
  'PayrollRunsController.findAll': 'PayrollRun',
  'PerformanceController.findAll': 'PerformanceRecord',
  'PeriodCloseController.findAll': 'AccountingPeriodClose',
  'PositionsController.findAll': 'Position',
  'PostingRulesController.findAll': 'AccountingPostingRule',
  'PostingRunsController.findAll': 'PostingRun',
  'PriceListsController.findAll': 'PriceList',
  'ProcurementPlansController.findAll': 'ProcurementPlan',
  'ProfitController.costGaps': 'Product',
  'ProductBatchesController.findAll': 'ProductBatch',
  'ProductBatchesController.findExpired': 'ProductBatch',
  'ProductCategoriesController.findAll': 'ProductCategory',
  'ProductsController.findFamilies': 'ProductFamily',
  'ProformaInvoicesController.findAll': 'ProformaInvoice',
  'PurchaseOrdersController.findAll': 'PurchaseOrder',
  'PurchaseRequisitionsController.findAll': 'PurchaseRequisition',
  'QuotationsController.findAll': 'Quotation',
  'ReceivablesController.findAccounts': 'Receivable',
  'ReceivablesController.findAll': 'Receivable',
  'RecordBookController.scopeOptions': 'Company',
  'RecordBookController.findCategories': 'RecordBookExpenseCategory',
  'RecordBookController.findDailySales': 'RecordBookDailySale',
  'RecordBookController.findExpenses': 'RecordBookExpense',
  'RefundsController.findAll': 'Refund',
  'ReturnablePackagesController.findAll': 'ReturnablePackage',
  'RfqsController.findAll': 'RequestForQuotation',
  'SalaryAdvancesController.findAll': 'SalaryAdvance',
  'SalaryPaymentsController.findAll': 'SalaryPayment',
  'SalesChannelsController.findAll': 'SalesChannel',
  'SalesCommissionsController.findAll': 'SalesCommission',
  'SalesOrdersController.customerDaySummary': 'SalesOrder',
  'SalesOrdersController.findAll': 'SalesOrder',
  'SalesOrdersController.findReceiptAccounts': 'CashAccount',
  'SalesOrdersController.mobilePosBootstrap': 'SalesOrder',
  'SavedReportViewsController.findAll': 'SavedReportView',
  'ScheduledReportsController.findAll': 'ScheduledReport',
  'SecurityEventsController.findAll': 'SecurityEvent',
  'SecurityPoliciesController.findAll': 'SecurityPolicy',
  'ShiftSchedulesController.findAll': 'ShiftSchedule',
  'StatutoryDeductionRulesController.findAll': 'StatutoryDeductionRule',
  'StatutoryReturnsController.all': 'Company',
  'StatutoryReturnsController.heslb': 'Company',
  'StatutoryReturnsController.nhif': 'Company',
  'StatutoryReturnsController.nssf': 'Company',
  'StatutoryReturnsController.paye': 'Company',
  'StatutoryReturnsController.psssf': 'Company',
  'StatutoryReturnsController.sdl': 'Company',
  'StatutoryReturnsController.wcf': 'Company',
  'StockAdjustmentsController.findAll': 'StockAdjustment',
  'StockDamageController.findAll': 'StockDamage',
  'SupplierInvoicesController.findAll': 'SupplierInvoice',
  'SupplierOrderDraftsController.findAll': 'SupplierOrderDraft',
  'SupplierPerformanceController.findAll': 'SupplierPerformanceProfile',
  'SupplierQuotationsController.findAll': 'SupplierQuotation',
  'SupplierStatementsController.findAll': 'SupplierStatementRun',
  'SuppliersController.findAll': 'Supplier',
  'TasksController.findAll': 'Task',
  'TasksController.myTasks': 'Task',
  'TaxCodesController.findAll': 'TaxCode',
  'TaxFilingPeriodsController.findAll': 'TaxFilingPeriod',
  'TaxRatesController.findAll': 'TaxRate',
  'TaxRatesController.findCurrent': 'TaxRate',
  'TaxReturnsController.findAll': 'TaxReturn',
  'TaxTransactionsController.findAll': 'TaxTransaction',
  'ThreeWayMatchingController.findAll': 'ThreeWayMatch',
  'UnitsController.findAllConversions': 'UnitConversion',
  'UnitsController.findAllUnits': 'UnitOfMeasure',
  'UserDashboardPreferencesController.list': 'UserDashboardPreference',
  'UsersController.findAll': 'User',
  'WebhookEndpointsController.findAll': 'WebhookEndpoint',
  'WebhookEventsController.findAll': 'WebhookEvent',
  'WestsidesDashboardController.cockpit': 'Product',
  'WestsidesDashboardController.getSummary': 'Product',
  'WorkShiftsController.findAll': 'WorkShift',
});

/**
 * These collection routes are owned by the authenticated actor rather than
 * by a tenant row. Every other reviewed marker route above is company-scoped:
 * its positive control observes company A and rejects company B.
 */
const metadataReadActorScopeControls: Readonly<
  Record<
    string,
    Readonly<{
      actorField: 'assignedToId' | 'requestedById' | 'recipientUserId' | 'userId';
    }>
  >
> = Object.freeze({
  'ApprovalRequestsController.submittedByMe': Object.freeze({
    actorField: 'requestedById',
  }),
  'NotificationsController.findAll': Object.freeze({ actorField: 'recipientUserId' }),
  'NotificationsController.findMy': Object.freeze({ actorField: 'recipientUserId' }),
  'SavedReportViewsController.findAll': Object.freeze({ actorField: 'userId' }),
  'TasksController.myTasks': Object.freeze({ actorField: 'assignedToId' }),
  'UserDashboardPreferencesController.list': Object.freeze({ actorField: 'userId' }),
});

const metadataReadSeedFields: Readonly<Record<string, CrudEvidenceMetadataSeedFields>> =
  Object.freeze({
    // findSensitive deliberately returns only HIGH and CRITICAL rows.
    'AuditLogsController.findSensitive': Object.freeze({ severity: 'HIGH' }),
    'ComplianceCalendarController.findOverdue': Object.freeze({
      dueDate: Object.freeze({ dateIso: '2000-01-01T00:00:00.000Z' }),
      status: 'UPCOMING',
    }),
    'ComplianceDashboardController.getSummary': Object.freeze({ status: 'EXPIRING_SOON' }),
    'ComplianceReportsController.getDocumentStatusSummary': Object.freeze({
      status: 'EXPIRING_SOON',
    }),
    'DebtsController.getOverdue': Object.freeze({
      dueDate: Object.freeze({ dateIso: '2000-01-01T00:00:00.000Z' }),
      status: 'OUTSTANDING',
    }),
    'LoansController.getOverdue': Object.freeze({
      maturityDate: Object.freeze({ dateIso: '2000-01-01T00:00:00.000Z' }),
      status: 'ACTIVE',
    }),
    // findConflicts deliberately returns only unresolved conflict rows.
    'OfflineSyncController.findConflicts': Object.freeze({ status: 'CONFLICT' }),
    'ProductBatchesController.findExpired': Object.freeze({
      expiryDate: Object.freeze({ dateIso: '2000-01-01T00:00:00.000Z' }),
      status: 'ACTIVE',
    }),
  });

const metadataReadDedicatedControls: Readonly<
  Record<
    string,
    Readonly<{
      seedScenario: CrudMetadataReadDedicatedSeedScenario;
      queryBindings: readonly CrudMetadataReadQueryBinding[];
    }>
  >
> = Object.freeze({
  'ProfitController.costGaps': Object.freeze({
    seedScenario: 'profit-cost-gap-product-company-pair-v1',
    queryBindings: Object.freeze([{ name: 'companyId', binding: 'companyA' as const }]),
  }),
  'SalesOrdersController.findReceiptAccounts': Object.freeze({
    seedScenario: 'receipt-account-company-pair-v1',
    queryBindings: Object.freeze([
      { name: 'companyId', binding: 'companyA' as const },
      { name: 'divisionId', binding: 'divisionA' as const },
      { name: 'branchId', binding: 'branchA' as const },
      { name: 'paymentMethod', literal: 'CASH' },
      { name: 'limit', literal: 20 },
    ]),
  }),
});

/**
 * Adds deterministic, manifest-derived positive controls only for collection
 * reads that the isolated harness can execute without inventing a path ID or a
 * domain-specific query value. The exact capability contract remains signed,
 * so a route or DTO change invalidates the artifact and recomputes this set.
 */
export function metadataReadEvidenceFixtures(
  manifest: readonly Capability[],
): readonly CrudMetadataReadFixtureRegistration[] {
  return metadataReadCandidateCapabilities(manifest)
    .filter((capability) => metadataReadCompanyMarkerSeeds[capability.id] !== undefined)
    .map((capability) => {
      const slug = capabilitySlug(capability.id);
      const seedFields = metadataReadSeedFields[capability.id];
      const actorScopeControl = metadataReadActorScopeControls[capability.id];
      const dedicatedControl = metadataReadDedicatedControls[capability.id];
      const scope = actorScopeControl ? ('actor' as const) : ('company' as const);
      const acceptsCompanyFilter = Boolean(
        capability.params.querySchema?.schema.properties.companyId,
      );
      return {
        fixtureId: `metadata-read-${slug}-${sha256Hex(capability.id).slice(0, 12)}`,
        fixtureVersion: dedicatedControl
          ? 6
          : seedFields
            ? Object.values(seedFields).some((value) => value !== null && typeof value === 'object')
              ? 5
              : 4
            : 3,
        capabilityId: capability.id,
        controlKind: 'positive' as const,
        description:
          scope === 'actor'
            ? `Execute the DTO-safe collection read ${capability.id} against the isolated actor.`
            : `Execute the DTO-safe collection read ${capability.id} against the isolated company.`,
        executionPrincipal:
          scope === 'actor'
            ? ('actor' as const)
            : acceptsCompanyFilter
              ? ('group' as const)
              : ('company' as const),
        ...(dedicatedControl ? { request: { queryBindings: dedicatedControl.queryBindings } } : {}),
        governance: {
          scope,
          audit: capabilityRequiresSensitiveAccessAudit(capability)
            ? ('required' as const)
            : ('not_applicable' as const),
          ...(capabilityRequiresSensitiveAccessAudit(capability)
            ? { auditScope: CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE }
            : {}),
        },
        observable: {
          kind: 'seeded-company-marker' as const,
          seedModel: metadataReadCompanyMarkerSeeds[capability.id]!,
          ...(seedFields ? { seedFields } : {}),
          present: { binding: scope === 'actor' ? ('userA' as const) : ('companyA' as const) },
          absent: { binding: scope === 'actor' ? ('userB' as const) : ('companyB' as const) },
          ...(actorScopeControl
            ? {
                negativeControl: {
                  seedModel: metadataReadCompanyMarkerSeeds[capability.id]!,
                  actorField: actorScopeControl.actorField,
                  actorBinding: 'userB' as const,
                  companyBinding: 'companyA' as const,
                },
              }
            : {}),
          ...(dedicatedControl
            ? {
                causalRecordControl: {
                  seedScenario: dedicatedControl.seedScenario,
                  lifecycle: 'fixture_isolated' as const,
                  responseMarkerField: 'id' as const,
                  present: {
                    binding: 'scenarioA' as const,
                    companyBinding: 'companyA' as const,
                  },
                  absent: {
                    binding: 'scenarioB' as const,
                    companyBinding: 'companyB' as const,
                  },
                },
              }
            : {}),
        },
      };
    });
}

export function metadataReadEvidenceBlockers(
  manifest: readonly Capability[],
): readonly CrudMetadataReadEvidenceBlocker[] {
  return metadataReadCandidateCapabilities(manifest)
    .filter((capability) => metadataReadCompanyMarkerSeeds[capability.id] === undefined)
    .map((capability) => ({
      capabilityId: capability.id,
      reason: 'no_deterministic_seeded_positive_control' as const,
      detail: `${capability.id} does not serialize a reviewed seeded company-A marker with a corresponding company-B exclusion oracle.`,
    }));
}

function metadataReadCandidateCapabilities(manifest: readonly Capability[]): readonly Capability[] {
  const explicitlyRegistered = new Set(
    CRUD_EVIDENCE_FIXTURES.filter((fixture) => fixture.controlKind === 'positive').map(
      (fixture) => fixture.capabilityId,
    ),
  );
  for (const fixture of domainHeaderEvidencePacks(manifest).flatMap((pack) => pack.fixtures)) {
    explicitlyRegistered.add(fixture.capabilityId);
  }
  for (const fixture of derivedReportReadEvidencePacks(manifest).flatMap((pack) => pack.fixtures)) {
    explicitlyRegistered.add(fixture.capabilityId);
  }
  for (const fixture of globalAdminReadEvidencePack(manifest).fixtures) {
    explicitlyRegistered.add(fixture.capabilityId);
  }
  for (const fixture of remainingReadEvidencePack(manifest).fixtures) {
    explicitlyRegistered.add(fixture.capabilityId);
  }
  for (const fixture of westsidesReportReadEvidencePack(manifest).fixtures) {
    explicitlyRegistered.add(fixture.capabilityId);
  }

  return manifest
    .filter((capability) => {
      if (explicitlyRegistered.has(capability.id)) return false;
      if (capability.agentExcluded || capability.verb !== 'GET') return false;
      if (metadataReadUnrepresentedHeaderCapabilities.has(capability.id)) return false;
      if (metadataReadMutationCapabilities.has(capability.id)) return false;
      if (capability.permissions.length === 0 && capability.anyPermissions.length === 0) {
        return false;
      }
      if (capability.params.path.length > 0) return false;

      const querySchema = capability.params.querySchema;
      if (capability.params.freeFormQuery && querySchema?.quality !== 'strict') return false;
      if (querySchema && querySchema.quality !== 'strict') return false;

      const requiredQuery = querySchema?.schema.required ?? [];
      return [...requiredQuery, ...capability.params.query].every((name) =>
        metadataReadQueryKeys.has(name),
      );
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

const metadataReadPackOrder = [
  'metadata-collection-reads-platform',
  'metadata-collection-reads-governance',
  'metadata-collection-reads-finance',
  'metadata-collection-reads-operations',
  'metadata-collection-reads-hr',
] as const;

/** Domain-isolated packs retain the stable fixture IDs while bounding failures. */
export function metadataReadEvidencePacks(
  manifest: readonly Capability[],
): readonly CrudMetadataReadFixturePack[] {
  const capabilitiesById = new Map(manifest.map((capability) => [capability.id, capability]));
  const grouped = new Map<string, CrudMetadataReadFixtureRegistration[]>(
    metadataReadPackOrder.map((packId) => [packId, []]),
  );

  for (const fixture of metadataReadEvidenceFixtures(manifest)) {
    const capability = capabilitiesById.get(fixture.capabilityId);
    if (!capability) continue;
    grouped.get(metadataReadPackId(capability))?.push(fixture);
  }

  return Object.freeze(
    metadataReadPackOrder.map((packId) =>
      Object.freeze({
        packId,
        packVersion: 4,
        fixtures: Object.freeze(grouped.get(packId) ?? []),
      }),
    ),
  );
}

function metadataReadPackId(capability: Capability): (typeof metadataReadPackOrder)[number] {
  if (capability.path.startsWith('hr/')) return 'metadata-collection-reads-hr';
  if (
    capability.path.startsWith('tax/') ||
    /^(account|bank|cash|depreciation|finance|financial|fiscal|journal|loan|posting|profit)/.test(
      capability.path,
    )
  ) {
    return 'metadata-collection-reads-finance';
  }
  if (
    /^(approval|audit|compliance|internal-controls|security|user-security|active-sessions)/.test(
      capability.path,
    )
  ) {
    return 'metadata-collection-reads-governance';
  }
  if (
    /^(crm|customer|inventory|operations|procurement|purchase|rfq|sales|supplier)/.test(
      capability.path,
    )
  ) {
    return 'metadata-collection-reads-operations';
  }
  return 'metadata-collection-reads-platform';
}

/**
 * Selects only the explicitly seeded exact-record definitions whose live
 * route is still a permission-governed GET with exactly one `:id` parameter.
 * Any controller/route drift drops the registration until the pack is
 * deliberately reviewed, while the full capability contract remains bound to
 * every signed result.
 */
export function exactRecordReadEvidenceFixtures(
  manifest: readonly Capability[],
): readonly CrudExactRecordReadFixtureRegistration[] {
  const capabilitiesById = new Map(manifest.map((capability) => [capability.id, capability]));

  return exactRecordReadDefinitions
    .flatMap((definition) => {
      const capability = capabilitiesById.get(definition.capabilityId);
      if (!capability) return [];
      if (capability.agentExcluded || capability.verb !== 'GET') return [];
      if (capability.permissions.length === 0 && capability.anyPermissions.length === 0) return [];
      if (
        capability.params.path.length !== 1 ||
        capability.params.path[0] !== 'id' ||
        capability.params.query.length > 0 ||
        capability.params.freeFormQuery
      ) {
        return [];
      }

      const slug = capabilitySlug(capability.id);
      return [
        {
          fixtureId: `exact-record-read-${slug}-${sha256Hex(capability.id).slice(0, 12)}`,
          fixtureVersion: 1,
          capabilityId: capability.id,
          controlKind: 'positive' as const,
          description: `Read the exact seeded company record for ${capability.id}.`,
          governance: {
            scope: 'company' as const,
            audit: capabilityRequiresSensitiveAccessAudit(capability)
              ? ('required' as const)
              : ('not_applicable' as const),
            ...(capabilityRequiresSensitiveAccessAudit(capability)
              ? { auditScope: CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE }
              : {}),
          },
          recordBinding: definition.recordBinding,
          responseCompanyPath: definition.responseCompanyPath,
        },
      ];
    })
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

/** Ordered additive packs for one exact live manifest. */
export function crudEvidenceFixturePacksForManifest(
  manifest: readonly Capability[],
): readonly CrudEvidenceFixturePack[] {
  const manifestCapabilityIds = new Set(manifest.map((capability) => capability.id));
  return Object.freeze([
    Object.freeze({
      ...CRUD_EVIDENCE_BASE_FIXTURE_PACK,
      fixtures: Object.freeze(
        CRUD_EVIDENCE_BASE_FIXTURE_PACK.fixtures.filter((fixture) =>
          manifestCapabilityIds.has(fixture.capabilityId),
        ),
      ),
    }),
    ...metadataReadEvidencePacks(manifest),
    globalAdminReadEvidencePack(manifest),
    remainingReadEvidencePack(manifest),
    ...derivedReportReadEvidencePacks(manifest),
    westsidesReportReadEvidencePack(manifest),
    Object.freeze({
      packId: 'exact-record-reads',
      packVersion: 1,
      fixtures: exactRecordReadEvidenceFixtures(manifest),
    }),
    ...domainHeaderEvidencePacks(manifest),
    ...pathRecordReadEvidencePacks(manifest),
    ...mutationEvidencePacksForManifest(manifest),
  ]);
}

/** The complete verifier registry for one exact live manifest. */
export function crudEvidenceFixturesForManifest(
  manifest: readonly Capability[],
): readonly CrudFixtureRegistration[] {
  const fixtures = crudEvidenceFixturePacksForManifest(manifest).flatMap((pack) => pack.fixtures);
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.fixtureId));
  if (fixtureIds.size !== fixtures.length) {
    throw new Error('CRUD evidence fixture packs contain duplicate fixture IDs.');
  }
  return Object.freeze(fixtures);
}

export interface CrudEvidenceAssertion {
  name: string;
  passed: boolean;
  /** A bounded, non-secret diagnostic such as "expected 403, received 401". */
  detail?: string;
}

export interface CrudEvidenceCase {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  capabilityContractDigest: string;
  /** Digest of the complete registered fixture, including its request and assertions contract. */
  fixtureContractDigest: string;
  controlKind: CrudEvidenceControlKind;
  outcome: CrudEvidenceOutcome;
  httpStatus?: number;
  assertions: CrudEvidenceAssertion[];
  finishedAt: string;
}

export interface CrudEvidencePayload {
  contract: typeof CRUD_EVIDENCE_CONTRACT;
  harnessVersion: typeof CRUD_EVIDENCE_HARNESS_VERSION;
  runId: string;
  generatedAt: string;
  expiresAt: string;
  manifestDigest: string;
  provenance: {
    /** Runner-computed digest of the exact application source and harness tree under test. */
    applicationBuildDigest: string;
    /** Harness-computed digest of schema.prisma plus the complete migrations directory. */
    prismaSchemaMigrationDigest: string;
  };
  database: {
    disposable: true;
    /** Provenance for the random disposable schema name; not a database-schema attestation. */
    isolatedSchemaNameDigest: string;
  };
  cases: CrudEvidenceCase[];
}

export interface SignedCrudEvidenceArtifact extends CrudEvidencePayload {
  payloadDigest: string;
  signature: {
    algorithm: 'ES256';
    keyId: string;
    value: string;
  };
}

export type CrudEvidenceArtifactRejection =
  | 'artifact_not_configured'
  | 'artifact_unreadable'
  | 'artifact_digest_mismatch'
  | 'artifact_invalid_json'
  | 'artifact_shape_invalid'
  | 'artifact_contract_mismatch'
  | 'harness_version_mismatch'
  | 'application_build_digest_mismatch'
  | 'prisma_schema_migration_digest_mismatch'
  | 'runtime_prisma_attestation_unavailable'
  | 'manifest_digest_mismatch'
  | 'payload_digest_mismatch'
  | 'signature_key_mismatch'
  | 'signature_invalid'
  | 'artifact_not_yet_valid'
  | 'artifact_expired'
  | 'artifact_stale'
  | 'fixture_registration_mismatch'
  | 'fixture_contract_mismatch'
  | 'capability_contract_mismatch'
  | 'fabricated_positive_result';

export interface AcceptedCrudEvidence {
  status: 'accepted';
  artifact: SignedCrudEvidenceArtifact;
  positiveEvidence: Readonly<
    Record<
      string,
      {
        cases: string[];
        lastVerifiedAt: string;
      }
    >
  >;
  failedPositiveFixtures: Readonly<Record<string, string[]>>;
  executedPositiveFixtures: readonly string[];
  securityControls: Readonly<
    Record<Exclude<CrudEvidenceControlKind, 'positive'>, { passed: boolean; cases: string[] }>
  >;
  governanceEvidence: Readonly<Record<string, CrudCapabilityGovernanceEvidence>>;
}

export interface CrudCapabilityGovernanceEvidence {
  authorizationContract: { passed: boolean };
  scope: {
    classification: CrudFixtureGovernanceScope | 'mixed' | 'not_registered';
    required: boolean;
    passed: boolean;
    cases: string[];
  };
  auditAttribution: {
    required: boolean;
    passed: boolean;
    cases: string[];
  };
}

export interface RejectedCrudEvidence {
  status: 'rejected';
  reason: CrudEvidenceArtifactRejection;
  detail: string;
}

export type CrudEvidenceVerification = AcceptedCrudEvidence | RejectedCrudEvidence;

// Process-local provenance mark. Coverage code accepts an `accepted` object
// only when this verifier created that exact object after cryptographic checks;
// a caller cannot promote a hand-built map by casting it to the interface.
const verifierAcceptedResults = new WeakSet<object>();

export function isVerifierAcceptedCrudEvidence(
  value: CrudEvidenceVerification,
): value is AcceptedCrudEvidence {
  return value.status === 'accepted' && verifierAcceptedResults.has(value);
}

export interface VerifyCrudEvidenceOptions {
  publicKeyPem: string | Buffer;
  expectedKeyId: string;
  expectedApplicationBuildDigest: string;
  expectedPrismaSchemaMigrationDigest: string;
  now?: Date;
  maxAgeMs: number;
  clockSkewMs?: number;
  fixtures?: readonly CrudFixtureRegistration[];
}

export function manifestContractDigest(manifest: readonly Capability[]): string {
  return sha256Hex(
    canonicalJson(
      [...manifest]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(normalizedCapabilityContract),
    ),
  );
}

export function capabilityContractDigest(capability: Capability): string {
  return sha256Hex(canonicalJson(normalizedCapabilityContract(capability)));
}

/**
 * Binds evidence to the full executable fixture definition, rather than only
 * its ID/version. This makes weakening a request, effect, recovery, audit, or
 * seed assertion invalidate already-issued evidence even if a version bump is
 * accidentally omitted.
 */
export function fixtureContractDigest(fixture: CrudFixtureRegistration): string {
  return sha256Hex(canonicalJson(fixture));
}

/**
 * Computes a deterministic attestation of the Prisma schema and migration set.
 * Symlinks are rejected so the digest cannot silently depend on content outside
 * the declared release tree.
 */
export function prismaSchemaMigrationDigest(prismaRoot: string): string {
  const root = resolve(prismaRoot);
  const schemaPath = join(root, 'schema.prisma');
  const migrationsPath = join(root, 'migrations');
  const files: string[] = [schemaPath];

  const rootStat = lstatSync(root);
  const schemaStat = lstatSync(schemaPath);
  const migrationsStat = lstatSync(migrationsPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Prisma evidence root must be a real directory, not a symlink.');
  }
  if (schemaStat.isSymbolicLink() || !schemaStat.isFile()) {
    throw new Error('Prisma schema.prisma must be a real file, not a symlink.');
  }
  if (migrationsStat.isSymbolicLink() || !migrationsStat.isDirectory()) {
    throw new Error('Prisma migrations root must be a real directory, not a symlink.');
  }

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Prisma evidence input must not contain symlinks: ${absolute}`);
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(migrationsPath);

  const entries = files
    .map((absolute) => {
      const content = readFileSync(absolute);
      return {
        path: relative(root, absolute).replace(/\\/g, '/'),
        bytes: content.length,
        sha256: sha256Hex(content),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256Hex(canonicalJson(entries));
}

export function signCrudEvidenceArtifact(
  payload: CrudEvidencePayload,
  privateKeyPem: string | Buffer,
  keyId: string,
): SignedCrudEvidenceArtifact {
  const canonicalPayload = canonicalJson(payload);
  const privateKey = createPrivateKey(privateKeyPem);
  assertP256Key(privateKey, 'CRUD evidence private signing key');
  const signature = cryptoSign('sha256', Buffer.from(canonicalPayload, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  if (signature.length !== 64) {
    throw new Error('CRUD evidence ES256 signature must be a 64-byte IEEE-P1363 value.');
  }
  return {
    ...payload,
    payloadDigest: sha256Hex(canonicalPayload),
    signature: {
      algorithm: 'ES256',
      keyId,
      value: signature.toString('base64'),
    },
  };
}

/**
 * Validates an artifact as a single trust unit. Structurally fabricated cases,
 * stale runs and any manifest/fixture drift reject the whole artifact. A real
 * fixture that executed and failed remains accepted as *failure evidence* and
 * never becomes positive coverage.
 */
export function verifyCrudEvidenceArtifact(
  input: unknown,
  manifest: readonly Capability[],
  options: VerifyCrudEvidenceOptions,
): CrudEvidenceVerification {
  const artifact = parseArtifact(input);
  if (!artifact.ok) return artifact.rejection;

  const value = artifact.value;
  if (value.contract !== CRUD_EVIDENCE_CONTRACT) {
    return rejected('artifact_contract_mismatch', `Expected ${CRUD_EVIDENCE_CONTRACT}.`);
  }
  if (value.harnessVersion !== CRUD_EVIDENCE_HARNESS_VERSION) {
    return rejected(
      'harness_version_mismatch',
      `Expected harness ${CRUD_EVIDENCE_HARNESS_VERSION}.`,
    );
  }
  if (value.manifestDigest !== manifestContractDigest(manifest)) {
    return rejected('manifest_digest_mismatch', 'The artifact was produced for another manifest.');
  }
  if (
    !safeHexEqual(value.provenance.applicationBuildDigest, options.expectedApplicationBuildDigest)
  ) {
    return rejected(
      'application_build_digest_mismatch',
      'The artifact was produced by another application build.',
    );
  }
  if (
    !safeHexEqual(
      value.provenance.prismaSchemaMigrationDigest,
      options.expectedPrismaSchemaMigrationDigest,
    )
  ) {
    return rejected(
      'prisma_schema_migration_digest_mismatch',
      'The artifact was produced for another Prisma schema or migration set.',
    );
  }

  const { payloadDigest: suppliedDigest, signature, ...payload } = value;
  const canonicalPayload = canonicalJson(payload);
  const computedDigest = sha256Hex(canonicalPayload);
  if (!safeHexEqual(suppliedDigest, computedDigest)) {
    return rejected('payload_digest_mismatch', 'The artifact payload digest does not match.');
  }
  if (signature.keyId !== options.expectedKeyId) {
    return rejected('signature_key_mismatch', 'The artifact key id is not trusted.');
  }
  if (signature.algorithm !== 'ES256') {
    return rejected('signature_invalid', 'Only ES256 evidence signatures are accepted.');
  }
  const signatureBytes = decodeP1363Signature(signature.value);
  if (!signatureBytes) {
    return rejected(
      'signature_invalid',
      'ES256 evidence signatures must be canonical 64-byte P1363.',
    );
  }
  let signatureValid = false;
  try {
    const publicKey = createPublicKey(options.publicKeyPem);
    assertP256Key(publicKey, 'CRUD evidence public verification key');
    signatureValid = cryptoVerify(
      'sha256',
      Buffer.from(canonicalPayload, 'utf8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signatureBytes,
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return rejected('signature_invalid', 'The artifact signature did not verify.');
  }

  const now = (options.now ?? new Date()).getTime();
  const generatedAt = Date.parse(value.generatedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const skew = options.clockSkewMs ?? 60_000;
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)) {
    return rejected('artifact_shape_invalid', 'Artifact timestamps must be ISO date strings.');
  }
  if (generatedAt > now + skew) {
    return rejected('artifact_not_yet_valid', 'Artifact generation time is in the future.');
  }
  if (expiresAt < now - skew) {
    return rejected('artifact_expired', 'Artifact expiry has passed.');
  }
  if (now - generatedAt > options.maxAgeMs) {
    return rejected('artifact_stale', 'Artifact exceeds the configured maximum age.');
  }
  if (expiresAt <= generatedAt) {
    return rejected('artifact_shape_invalid', 'Artifact expiry must follow generation time.');
  }

  const fixtures = options.fixtures ?? crudEvidenceFixturesForManifest(manifest);
  if (value.cases.length !== fixtures.length) {
    return rejected(
      'fixture_registration_mismatch',
      'Artifact must contain exactly one result for every registered fixture.',
    );
  }
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture]));
  const capabilitiesById = new Map(manifest.map((capability) => [capability.id, capability]));
  const seenCases = new Set<string>();

  for (const evidenceCase of value.cases) {
    const finishedAt = Date.parse(evidenceCase.finishedAt);
    if (
      finishedAt > generatedAt + skew ||
      finishedAt < generatedAt - Math.min(options.maxAgeMs, 2 * 60 * 60 * 1000)
    ) {
      return rejected(
        'artifact_shape_invalid',
        `Fixture ${evidenceCase.fixtureId} did not finish within the signed run window.`,
      );
    }
    if (seenCases.has(evidenceCase.fixtureId)) {
      return rejected(
        'fixture_registration_mismatch',
        `Duplicate fixture result ${evidenceCase.fixtureId}.`,
      );
    }
    seenCases.add(evidenceCase.fixtureId);
    const fixture = fixturesById.get(evidenceCase.fixtureId);
    if (
      !fixture ||
      fixture.fixtureVersion !== evidenceCase.fixtureVersion ||
      fixture.capabilityId !== evidenceCase.capabilityId ||
      fixture.controlKind !== evidenceCase.controlKind
    ) {
      return rejected(
        'fixture_registration_mismatch',
        `Fixture ${evidenceCase.fixtureId} is not registered at this version and capability.`,
      );
    }
    if (fixtureContractDigest(fixture) !== evidenceCase.fixtureContractDigest) {
      return rejected(
        'fixture_contract_mismatch',
        `Fixture ${evidenceCase.fixtureId} does not match the complete registered fixture contract.`,
      );
    }
    const capability = capabilitiesById.get(evidenceCase.capabilityId);
    if (
      !capability ||
      capabilityContractDigest(capability) !== evidenceCase.capabilityContractDigest
    ) {
      return rejected(
        'capability_contract_mismatch',
        `Fixture ${evidenceCase.fixtureId} does not match the current capability contract.`,
      );
    }
    if (!isSemanticallyHonestCase(evidenceCase)) {
      return rejected(
        'fabricated_positive_result',
        `Fixture ${evidenceCase.fixtureId} claims success without a successful exact assertion set.`,
      );
    }
  }

  const positiveEvidence: Record<string, { cases: string[]; lastVerifiedAt: string }> = {};
  const failedPositiveFixtures: Record<string, string[]> = {};
  const executedPositiveFixtures: string[] = [];
  const securityControls: AcceptedCrudEvidence['securityControls'] = {
    permission_denial: { passed: true, cases: [] },
    company_isolation: { passed: true, cases: [] },
    audit_attribution: { passed: true, cases: [] },
    service_principal_task_scope: { passed: true, cases: [] },
  };

  for (const evidenceCase of value.cases) {
    if (evidenceCase.controlKind === 'positive') {
      executedPositiveFixtures.push(evidenceCase.fixtureId);
      if (evidenceCase.outcome === 'passed') {
        const current = positiveEvidence[evidenceCase.capabilityId] ?? {
          cases: [],
          lastVerifiedAt: evidenceCase.finishedAt,
        };
        current.cases.push(evidenceCase.fixtureId);
        if (Date.parse(evidenceCase.finishedAt) > Date.parse(current.lastVerifiedAt)) {
          current.lastVerifiedAt = evidenceCase.finishedAt;
        }
        positiveEvidence[evidenceCase.capabilityId] = current;
      } else {
        (failedPositiveFixtures[evidenceCase.capabilityId] ??= []).push(evidenceCase.fixtureId);
      }
      continue;
    }

    const control = securityControls[evidenceCase.controlKind];
    control.cases.push(evidenceCase.fixtureId);
    if (evidenceCase.outcome !== 'passed') control.passed = false;
  }

  for (const entry of Object.values(positiveEvidence)) entry.cases.sort();
  for (const entry of Object.values(failedPositiveFixtures)) entry.sort();
  executedPositiveFixtures.sort();
  for (const control of Object.values(securityControls)) {
    control.cases.sort();
    control.passed = control.cases.length > 0 && control.passed;
  }
  const governanceEvidence = deriveCapabilityGovernanceEvidence(manifest, fixtures, value.cases);

  const acceptedResult: AcceptedCrudEvidence = {
    status: 'accepted',
    artifact: value,
    positiveEvidence,
    failedPositiveFixtures,
    executedPositiveFixtures,
    securityControls,
    governanceEvidence,
  };
  verifierAcceptedResults.add(acceptedResult);
  return acceptedResult;
}

function deriveCapabilityGovernanceEvidence(
  manifest: readonly Capability[],
  fixtures: readonly CrudFixtureRegistration[],
  cases: readonly CrudEvidenceCase[],
): Readonly<Record<string, CrudCapabilityGovernanceEvidence>> {
  const passedPositiveFixtureIds = new Set(
    cases
      .filter((item) => item.controlKind === 'positive' && item.outcome === 'passed')
      .map((item) => item.fixtureId),
  );
  const positiveByCapability = new Map<string, CrudPositiveFixtureRegistration[]>();
  for (const fixture of fixtures) {
    if (fixture.controlKind !== 'positive') continue;
    const current = positiveByCapability.get(fixture.capabilityId) ?? [];
    current.push(fixture);
    positiveByCapability.set(fixture.capabilityId, current);
  }

  return Object.freeze(
    Object.fromEntries(
      manifest.map((capability) => {
        const capabilityFixtures = positiveByCapability.get(capability.id) ?? [];
        const classifications = [
          ...new Set(capabilityFixtures.map((fixture) => fixture.governance.scope)),
        ].sort();
        const classification: CrudCapabilityGovernanceEvidence['scope']['classification'] =
          classifications.length === 0
            ? 'not_registered'
            : classifications.length === 1
              ? classifications[0]
              : 'mixed';
        const scopedFixtures = capabilityFixtures.filter((fixture) =>
          ['company', 'actor', 'seeded-company'].includes(fixture.governance.scope),
        );
        const scopedCases = scopedFixtures
          .filter((fixture) => passedPositiveFixtureIds.has(fixture.fixtureId))
          .map((fixture) => fixture.fixtureId)
          .sort();
        const auditFixtures = capabilityFixtures.filter(
          (fixture) => fixture.governance.audit === 'required',
        );
        const auditCases = auditFixtures
          .filter((fixture) => passedPositiveFixtureIds.has(fixture.fixtureId))
          .map((fixture) => fixture.fixtureId)
          .sort();
        const authorizationPassed =
          (capability.guard === 'permission' && capability.permissions.length > 0) ||
          (capability.guard === 'permission-any' && capability.anyPermissions.length > 0);
        return [
          capability.id,
          Object.freeze({
            authorizationContract: { passed: authorizationPassed },
            scope: {
              classification,
              required: scopedFixtures.length > 0,
              passed: scopedFixtures.length === 0 || scopedCases.length === scopedFixtures.length,
              cases: scopedCases,
            },
            auditAttribution: {
              required: auditFixtures.length > 0,
              passed: auditFixtures.length === 0 || auditCases.length === auditFixtures.length,
              cases: auditCases,
            },
          } satisfies CrudCapabilityGovernanceEvidence),
        ];
      }),
    ),
  );
}

function isSemanticallyHonestCase(evidenceCase: CrudEvidenceCase): boolean {
  if (evidenceCase.outcome !== 'passed') return true;
  if (evidenceCase.assertions.length === 0) return false;
  if (!evidenceCase.assertions.every((assertion) => assertion.passed)) return false;
  if (!Number.isInteger(evidenceCase.httpStatus)) return false;

  if (evidenceCase.controlKind === 'permission_denial') {
    return evidenceCase.httpStatus === 403;
  }
  if (evidenceCase.controlKind === 'company_isolation') {
    return evidenceCase.httpStatus === 403 || evidenceCase.httpStatus === 404;
  }
  // Positive CRUD and audit-attribution controls must complete successfully.
  // In particular, the legacy smoke condition "status < 500" is never enough.
  return evidenceCase.httpStatus! >= 200 && evidenceCase.httpStatus! < 300;
}

function parseArtifact(
  input: unknown,
):
  | { ok: true; value: SignedCrudEvidenceArtifact }
  | { ok: false; rejection: RejectedCrudEvidence } {
  if (!isRecord(input)) {
    return {
      ok: false,
      rejection: rejected('artifact_shape_invalid', 'Artifact must be an object.'),
    };
  }
  const signature = input.signature;
  const database = input.database;
  const provenance = input.provenance;
  if (
    typeof input.contract !== 'string' ||
    typeof input.harnessVersion !== 'string' ||
    typeof input.runId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.runId) ||
    typeof input.generatedAt !== 'string' ||
    typeof input.expiresAt !== 'string' ||
    typeof input.manifestDigest !== 'string' ||
    typeof input.payloadDigest !== 'string' ||
    !Array.isArray(input.cases) ||
    !isRecord(provenance) ||
    typeof provenance.applicationBuildDigest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(provenance.applicationBuildDigest) ||
    typeof provenance.prismaSchemaMigrationDigest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(provenance.prismaSchemaMigrationDigest) ||
    !isRecord(database) ||
    database.disposable !== true ||
    typeof database.isolatedSchemaNameDigest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(database.isolatedSchemaNameDigest) ||
    !isRecord(signature) ||
    signature.algorithm !== 'ES256' ||
    typeof signature.keyId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(signature.keyId) ||
    typeof signature.value !== 'string'
  ) {
    return {
      ok: false,
      rejection: rejected('artifact_shape_invalid', 'Artifact is missing required signed fields.'),
    };
  }

  const cases: CrudEvidenceCase[] = [];
  for (const rawCase of input.cases) {
    const parsed = parseEvidenceCase(rawCase);
    if (!parsed) {
      return {
        ok: false,
        rejection: rejected('artifact_shape_invalid', 'Artifact contains a malformed case.'),
      };
    }
    cases.push(parsed);
  }

  return {
    ok: true,
    value: {
      contract: input.contract as typeof CRUD_EVIDENCE_CONTRACT,
      harnessVersion: input.harnessVersion as typeof CRUD_EVIDENCE_HARNESS_VERSION,
      runId: input.runId,
      generatedAt: input.generatedAt,
      expiresAt: input.expiresAt,
      manifestDigest: input.manifestDigest,
      provenance: {
        applicationBuildDigest: provenance.applicationBuildDigest,
        prismaSchemaMigrationDigest: provenance.prismaSchemaMigrationDigest,
      },
      database: {
        disposable: true,
        isolatedSchemaNameDigest: database.isolatedSchemaNameDigest,
      },
      cases,
      payloadDigest: input.payloadDigest,
      signature: {
        algorithm: 'ES256',
        keyId: signature.keyId,
        value: signature.value,
      },
    },
  };
}

function parseEvidenceCase(input: unknown): CrudEvidenceCase | undefined {
  if (
    !isRecord(input) ||
    !Array.isArray(input.assertions) ||
    input.assertions.length > CRUD_EVIDENCE_MAX_CASE_ASSERTIONS
  ) {
    return undefined;
  }
  if (
    typeof input.fixtureId !== 'string' ||
    input.fixtureId.length < 1 ||
    input.fixtureId.length > 128 ||
    !Number.isInteger(input.fixtureVersion) ||
    typeof input.capabilityId !== 'string' ||
    input.capabilityId.length < 1 ||
    input.capabilityId.length > 256 ||
    typeof input.capabilityContractDigest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(input.capabilityContractDigest) ||
    typeof input.fixtureContractDigest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(input.fixtureContractDigest) ||
    ![
      'positive',
      'permission_denial',
      'company_isolation',
      'audit_attribution',
      'service_principal_task_scope',
    ].includes(String(input.controlKind)) ||
    !['passed', 'failed', 'skipped'].includes(String(input.outcome)) ||
    (input.httpStatus !== undefined && !Number.isInteger(input.httpStatus)) ||
    typeof input.finishedAt !== 'string' ||
    !Number.isFinite(Date.parse(input.finishedAt))
  ) {
    return undefined;
  }
  const assertions: CrudEvidenceAssertion[] = [];
  for (const assertion of input.assertions) {
    if (
      !isRecord(assertion) ||
      typeof assertion.name !== 'string' ||
      assertion.name.length < 1 ||
      assertion.name.length > 256 ||
      typeof assertion.passed !== 'boolean' ||
      (assertion.detail !== undefined && typeof assertion.detail !== 'string')
    ) {
      return undefined;
    }
    assertions.push({
      name: assertion.name,
      passed: assertion.passed,
      ...(assertion.detail === undefined ? {} : { detail: assertion.detail.slice(0, 512) }),
    });
  }
  return {
    fixtureId: input.fixtureId,
    fixtureVersion: input.fixtureVersion as number,
    capabilityId: input.capabilityId,
    capabilityContractDigest: input.capabilityContractDigest,
    fixtureContractDigest: input.fixtureContractDigest,
    controlKind: input.controlKind as CrudEvidenceControlKind,
    outcome: input.outcome as CrudEvidenceOutcome,
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus as number }),
    assertions,
    finishedAt: input.finishedAt,
  };
}

function normalizedCapabilityContract(capability: Capability): unknown {
  return {
    id: capability.id,
    controller: capability.controller,
    handler: capability.handler,
    verb: capability.verb,
    path: capability.path,
    permissions: [...capability.permissions].sort(),
    anyPermissions: [...capability.anyPermissions].sort(),
    roles: [...capability.roles].sort(),
    apiScopes: [...capability.apiScopes].sort(),
    guard: capability.guard,
    tier: capability.tier,
    tierReason: capability.tierReason,
    agentExcluded: capability.agentExcluded,
    agentExclusionReason: capability.agentExclusionReason ?? null,
    params: {
      path: [...capability.params.path].sort(),
      query: [...capability.params.query].sort(),
      headers: [...(capability.params.headers ?? [])].sort(),
      freeFormQuery: capability.params.freeFormQuery,
      hasBody: capability.params.hasBody,
      querySchema: capability.params.querySchema ?? null,
      bodySchema: capability.params.bodySchema ?? null,
    },
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Evidence cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`Evidence contains unsupported value type ${typeof value}.`);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function capabilitySlug(capabilityId: string): string {
  return capabilityId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function assertP256Key(
  key: ReturnType<typeof createPrivateKey> | ReturnType<typeof createPublicKey>,
  label: string,
): void {
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (key.asymmetricKeyType !== 'ec' || (curve !== 'prime256v1' && curve !== 'P-256')) {
    throw new Error(`${label} must be an EC P-256 key.`);
  }
}

function decodeP1363Signature(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 64 && decoded.toString('base64') === value ? decoded : null;
}

function rejected(reason: CrudEvidenceArtifactRejection, detail: string): RejectedCrudEvidence {
  return { status: 'rejected', reason, detail };
}

function collectResponseStrings(value: unknown, depth = 0): string[] {
  if (depth > 12 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectResponseStrings(item, depth + 1));
  }
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((nested) => collectResponseStrings(nested, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
