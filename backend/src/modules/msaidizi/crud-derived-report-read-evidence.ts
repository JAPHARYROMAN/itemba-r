import { createHash } from 'node:crypto';
import { Capability } from '../../common/capabilities/capability-manifest';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import {
  CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE,
  CrudFixtureGovernanceContract,
} from './crud-evidence-governance';

export type CrudDerivedReportBinding =
  | 'companyA'
  | 'companyB'
  | 'financeJournalA'
  | 'financeJournalB'
  | 'financeIntercompanyJournalA'
  | 'financeIntercompanyJournalB'
  | 'financeCashAccountA'
  | 'financeCashAccountB'
  | 'financeGroupSummaryDebitA'
  | 'financeGroupSummaryDebitB'
  | 'financeReceivableTotalA'
  | 'financeReceivableTotalB'
  | 'financePayableTotalA'
  | 'financePayableTotalB'
  | 'financeIntercompanyTotal'
  | 'operationsSalesOrderA'
  | 'operationsSalesOrderB'
  | 'operationsCustomerA'
  | 'operationsCustomerB'
  | 'operationsProductA'
  | 'operationsProductB'
  | 'operationsSupplierA'
  | 'operationsSupplierB'
  | 'operationsPurchaseOrderA'
  | 'operationsPurchaseOrderB'
  | 'operationsInventoryMovementA'
  | 'operationsInventoryMovementB'
  | 'operationsStockAdjustmentA'
  | 'operationsStockAdjustmentB'
  | 'operationsBranchA'
  | 'operationsBranchB'
  | 'operationsSalesTotalA'
  | 'operationsPurchaseTotalA'
  | 'operationsProductNameA'
  | 'operationsProductNameB'
  | 'companySummaryAccountingLocksA'
  | 'companySummaryApprovalPendingA'
  | 'companySummaryBackgroundQueuedA'
  | 'companySummaryContractTotalA'
  | 'companySummaryCustomerTotalA'
  | 'companySummaryDocumentTotalA'
  | 'companySummaryInventoryCountA'
  | 'companySummaryMovementCountA'
  | 'companySummaryObligationStatusA'
  | 'companySummaryObligationCountA'
  | 'companySummaryOperationsActiveProductsA'
  | 'companySummaryProcurementActiveSuppliersA'
  | 'companySummaryPurchaseTotalA'
  | 'companySummarySalesRevenueA'
  | 'companySummarySupplierTotalA'
  | 'companySummaryTaxAmountA'
  | 'companySummaryTaxAmountB'
  | 'companySummaryUpcomingObligationA'
  | 'companySummaryUpcomingObligationB'
  | 'companySummaryExpiringBatchA'
  | 'companySummaryExpiringBatchB'
  | 'companySummaryBelowCostAttemptA'
  | 'companySummaryBelowCostAttemptB';

export interface CrudDerivedReportArgumentBinding {
  name: string;
  binding?: 'companyA';
  literal?: string | number | boolean;
}

export interface CrudDerivedReportValueExpectation {
  responsePath: readonly string[];
  binding: CrudDerivedReportBinding;
}

export interface CrudDerivedReportRowExpectation {
  /** Empty means the unwrapped response itself is the row collection. */
  collectionPath: readonly string[];
  matchResponsePath: readonly string[];
  matchBinding: CrudDerivedReportBinding;
  values: readonly CrudDerivedReportValueExpectation[];
}

export interface CrudDerivedReportPathMarkerExpectation {
  responsePath: readonly string[];
  presentBindings: readonly CrudDerivedReportBinding[];
  absentBindings: readonly CrudDerivedReportBinding[];
}

export type CrudDerivedReportScopeProbe =
  | {
      kind: 'foreign_company_denied';
      deniedCompanyBinding: 'companyB';
      expectedStatus: 403;
    }
  | {
      kind: 'company_principal_denied_group_report';
      expectedStatus: 403;
    };

export interface CrudDerivedReportOracle {
  /** Causal values that must be serialized somewhere in the successful payload. */
  presentBindings: readonly CrudDerivedReportBinding[];
  /** Causal company-B values that must not leak through a company-A report. */
  absentBindings: readonly CrudDerivedReportBinding[];
  rootValues?: readonly CrudDerivedReportValueExpectation[];
  rows?: readonly CrudDerivedReportRowExpectation[];
  pathMarkers?: readonly CrudDerivedReportPathMarkerExpectation[];
  scopeProbe: CrudDerivedReportScopeProbe;
}

export interface CrudDerivedReportReadFixtureRegistration {
  fixtureId: string;
  fixtureVersion: number;
  capabilityId: string;
  controlKind: 'positive';
  description: string;
  governance: CrudFixtureGovernanceContract;
  packId:
    | 'derived-financial-report-reads'
    | 'derived-operations-report-reads'
    | 'derived-company-summary-reads';
  expectedPath: string;
  expectedQueryParameters: readonly string[];
  queryBindings: readonly CrudDerivedReportArgumentBinding[];
  executionPrincipal: 'company' | 'group';
  seedScenario:
    | 'financial-company-pair-v1'
    | 'operations-company-pair-v1'
    | 'company-summary-pair-v1';
  oracle: CrudDerivedReportOracle;
}

export interface CrudDerivedReportReadFixturePack {
  packId: CrudDerivedReportReadFixtureRegistration['packId'];
  packVersion: number;
  fixtures: readonly CrudDerivedReportReadFixtureRegistration[];
}

interface CrudDerivedReportDefinition extends Omit<
  CrudDerivedReportReadFixtureRegistration,
  'fixtureId' | 'fixtureVersion' | 'controlKind' | 'description' | 'governance' | 'packId'
> {
  capabilityId: string;
  scope: 'company' | 'global';
}

const REPORT_QUERY_PARAMETERS = Object.freeze([
  'periodId',
  'dateFrom',
  'dateTo',
  'periodStart',
  'periodEnd',
  'year',
  'month',
  'fromMonth',
  'toMonth',
  'asOf',
  'divisionId',
  'branchId',
] as const);

const OPERATIONS_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'divisionId',
  'branchId',
  'locationId',
  'productId',
  'customerId',
  'supplierId',
  'status',
  'paymentStatus',
  'dateFrom',
  'dateTo',
  'pageSize',
  'limit',
] as const);

const INVENTORY_MOVEMENT_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'divisionId',
  'productId',
  'branchId',
  'locationId',
  'status',
  'dateFrom',
  'dateTo',
  'page',
  'pageSize',
] as const);

const STOCK_VALUATION_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'divisionId',
  'locationId',
  'branchId',
  'productId',
] as const);

const SALES_SUMMARY_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'divisionId',
  'branchId',
  'locationId',
  'customerId',
  'productId',
  'status',
  'paymentStatus',
  'dateFrom',
  'dateTo',
  'pageSize',
] as const);

const PURCHASE_SUMMARY_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'divisionId',
  'branchId',
  'locationId',
  'supplierId',
  'productId',
  'status',
  'paymentStatus',
  'dateFrom',
  'dateTo',
  'pageSize',
] as const);

const COMPANY_QUERY_PARAMETERS = Object.freeze(['companyId'] as const);
const COMPLIANCE_CALENDAR_QUERY_PARAMETERS = Object.freeze(['companyId', 'limit', 'page'] as const);
const COMPLIANCE_REPORT_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'endDate',
  'startDate',
] as const);
const CUSTOMER_WORKBENCH_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'companyId',
  'customerType',
  'divisionId',
  'limit',
  'page',
  'search',
  'status',
] as const);
const INVENTORY_BALANCE_SUMMARY_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'categoryId',
  'companyId',
  'costStatus',
  'divisionId',
  'limit',
  'locationId',
  'lowStock',
  'page',
  'productFamilyId',
  'productId',
  'search',
  'staleDays',
  'stockStatus',
] as const);
const INVENTORY_MOVEMENT_SUMMARY_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'companyId',
  'dateFrom',
  'dateTo',
  'divisionId',
  'limit',
  'locationId',
  'movementType',
  'page',
  'productId',
  'referenceId',
  'referenceType',
] as const);
const PROFIT_ATTEMPT_QUERY_PARAMETERS = Object.freeze([
  'companyId',
  'dateFrom',
  'dateTo',
  'limit',
  'page',
] as const);
const PROFIT_PRODUCT_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'companyId',
  'dateFrom',
  'dateTo',
  'divisionId',
  'productId',
] as const);
const PURCHASE_ORDER_SUMMARY_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'companyId',
  'dateFrom',
  'dateTo',
  'divisionId',
  'invoiceNumber',
  'invoiceStatus',
  'limit',
  'page',
  'paymentStatus',
  'purchaseType',
  'search',
  'status',
  'supplierId',
] as const);
const SALES_ORDER_WORKBENCH_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'companyId',
  'customerId',
  'dateFrom',
  'dateTo',
  'divisionId',
  'limit',
  'page',
  'paymentMethod',
  'paymentStatus',
  'salesType',
  'salespersonId',
  'search',
  'status',
] as const);
const SUPPLIER_WORKBENCH_QUERY_PARAMETERS = Object.freeze([
  'branchId',
  'companyId',
  'divisionId',
  'limit',
  'page',
  'productCategoryId',
  'search',
  'status',
  'supplierType',
] as const);

const literal = (
  name: string,
  value: string | number | boolean,
): CrudDerivedReportArgumentBinding => ({ name, literal: value });
const companyA = (): CrudDerivedReportArgumentBinding => ({
  name: 'companyId',
  binding: 'companyA',
});

const financialScopeProbe = Object.freeze({
  kind: 'company_principal_denied_group_report' as const,
  expectedStatus: 403 as const,
});
const operationsScopeProbe = Object.freeze({
  kind: 'foreign_company_denied' as const,
  deniedCompanyBinding: 'companyB' as const,
  expectedStatus: 403 as const,
});

const financial = (
  capabilityId: string,
  expectedPath: string,
  input: {
    queryBindings?: readonly CrudDerivedReportArgumentBinding[];
    presentBindings: readonly CrudDerivedReportBinding[];
    rootValues?: readonly CrudDerivedReportValueExpectation[];
    rows?: readonly CrudDerivedReportRowExpectation[];
    pathMarkers?: readonly CrudDerivedReportPathMarkerExpectation[];
  },
): CrudDerivedReportDefinition => ({
  capabilityId,
  expectedPath,
  expectedQueryParameters:
    input.queryBindings && input.queryBindings.length > 0 ? REPORT_QUERY_PARAMETERS : [],
  queryBindings: input.queryBindings ?? [],
  executionPrincipal: 'group',
  seedScenario: 'financial-company-pair-v1',
  scope: 'global',
  oracle: {
    presentBindings: input.presentBindings,
    absentBindings: [],
    ...(input.rootValues ? { rootValues: input.rootValues } : {}),
    ...(input.rows ? { rows: input.rows } : {}),
    ...(input.pathMarkers ? { pathMarkers: input.pathMarkers } : {}),
    scopeProbe: financialScopeProbe,
  },
});

const operations = (
  capabilityId: string,
  expectedPath: string,
  input: {
    expectedQueryParameters?: readonly string[];
    presentBindings: readonly CrudDerivedReportBinding[];
    absentBindings: readonly CrudDerivedReportBinding[];
    rootValues?: readonly CrudDerivedReportValueExpectation[];
    queryBindings?: readonly CrudDerivedReportArgumentBinding[];
  },
): CrudDerivedReportDefinition => ({
  capabilityId,
  expectedPath,
  expectedQueryParameters: input.expectedQueryParameters ?? OPERATIONS_QUERY_PARAMETERS,
  queryBindings: input.queryBindings ?? [
    companyA(),
    literal('dateFrom', '2026-01-01'),
    literal('dateTo', '2026-12-31'),
    literal('pageSize', 100),
  ],
  executionPrincipal: 'company',
  seedScenario: 'operations-company-pair-v1',
  scope: 'company',
  oracle: {
    presentBindings: input.presentBindings,
    absentBindings: input.absentBindings,
    ...(input.rootValues ? { rootValues: input.rootValues } : {}),
    scopeProbe: operationsScopeProbe,
  },
});

const companySummary = (
  capabilityId: string,
  expectedPath: string,
  input: {
    expectedQueryParameters: readonly string[];
    presentBindings?: readonly CrudDerivedReportBinding[];
    absentBindings?: readonly CrudDerivedReportBinding[];
    rootValues?: readonly CrudDerivedReportValueExpectation[];
    rows?: readonly CrudDerivedReportRowExpectation[];
    queryBindings?: readonly CrudDerivedReportArgumentBinding[];
    executionPrincipal?: 'company' | 'group';
    scopeProbe?: CrudDerivedReportOracle['scopeProbe'];
  },
): CrudDerivedReportDefinition => ({
  capabilityId,
  expectedPath,
  expectedQueryParameters: input.expectedQueryParameters,
  queryBindings: input.queryBindings ?? [companyA()],
  executionPrincipal: input.executionPrincipal ?? 'company',
  seedScenario: 'company-summary-pair-v1',
  scope: 'company',
  oracle: {
    presentBindings: input.presentBindings ?? [],
    absentBindings: input.absentBindings ?? [],
    ...(input.rootValues ? { rootValues: input.rootValues } : {}),
    ...(input.rows ? { rows: input.rows } : {}),
    scopeProbe: input.scopeProbe ?? operationsScopeProbe,
  },
});

const companyRows = (
  collectionPath: readonly string[],
  valuePath: readonly string[],
  valueA: CrudDerivedReportBinding,
  valueB: CrudDerivedReportBinding,
): readonly CrudDerivedReportRowExpectation[] => [
  {
    collectionPath,
    matchResponsePath: ['company', 'id'],
    matchBinding: 'companyA',
    values: [{ responsePath: valuePath, binding: valueA }],
  },
  {
    collectionPath,
    matchResponsePath: ['company', 'id'],
    matchBinding: 'companyB',
    values: [{ responsePath: valuePath, binding: valueB }],
  },
];

const definitions: readonly CrudDerivedReportDefinition[] = Object.freeze([
  financial('FinancialReportsController.getGroupSummary', 'financial-reports/group-summary', {
    presentBindings: ['companyA', 'companyB'],
    rows: companyRows(
      ['companies'],
      ['totalDebits'],
      'financeGroupSummaryDebitA',
      'financeGroupSummaryDebitB',
    ),
  }),
  financial(
    'FinancialReportsController.getGroupTrialBalance',
    'financial-reports/group/trial-balance',
    {
      queryBindings: [literal('dateFrom', '2026-01-01'), literal('dateTo', '2026-12-31')],
      presentBindings: ['financeJournalA', 'financeJournalB'],
    },
  ),
  financial(
    'FinancialReportsController.getGroupProfitAndLoss',
    'financial-reports/group/profit-and-loss',
    {
      queryBindings: [literal('dateFrom', '2026-01-01'), literal('dateTo', '2026-12-31')],
      presentBindings: ['financeJournalA', 'financeJournalB'],
    },
  ),
  financial(
    'FinancialReportsController.getGroupBalanceSheet',
    'financial-reports/group/balance-sheet',
    {
      queryBindings: [literal('asOf', '2099-12-31')],
      presentBindings: ['financeJournalA', 'financeJournalB'],
    },
  ),
  financial(
    'FinancialReportsController.getConsolidatedProfitAndLoss',
    'financial-reports/group/consolidated/profit-and-loss',
    {
      queryBindings: [literal('dateFrom', '2026-01-01'), literal('dateTo', '2026-12-31')],
      presentBindings: [
        'financeJournalA',
        'financeJournalB',
        'financeIntercompanyJournalA',
        'financeIntercompanyJournalB',
      ],
      pathMarkers: [
        {
          responsePath: ['byCompany'],
          presentBindings: ['financeJournalA', 'financeJournalB'],
          absentBindings: ['financeIntercompanyJournalA', 'financeIntercompanyJournalB'],
        },
        {
          responsePath: ['eliminations', 'journalEntryIds'],
          presentBindings: ['financeIntercompanyJournalA', 'financeIntercompanyJournalB'],
          absentBindings: [],
        },
      ],
    },
  ),
  financial(
    'FinancialReportsController.getConsolidatedBalanceSheet',
    'financial-reports/group/consolidated/balance-sheet',
    {
      queryBindings: [literal('asOf', '2099-12-31')],
      presentBindings: [
        'financeJournalA',
        'financeJournalB',
        'financeIntercompanyJournalA',
        'financeIntercompanyJournalB',
      ],
      pathMarkers: [
        {
          responsePath: ['byCompany'],
          presentBindings: ['financeJournalA', 'financeJournalB'],
          absentBindings: ['financeIntercompanyJournalA', 'financeIntercompanyJournalB'],
        },
        {
          responsePath: ['eliminations', 'journalEntryIds'],
          presentBindings: ['financeIntercompanyJournalA', 'financeIntercompanyJournalB'],
          absentBindings: [],
        },
      ],
    },
  ),
  financial(
    'FinancialReportsController.getConsolidatedCashFlow',
    'financial-reports/group/consolidated/cash-flow',
    {
      queryBindings: [literal('periodStart', '2026-01-01'), literal('periodEnd', '2026-12-31')],
      presentBindings: [
        'financeJournalA',
        'financeJournalB',
        'financeIntercompanyJournalA',
        'financeIntercompanyJournalB',
      ],
      pathMarkers: [
        {
          responsePath: ['byCompany'],
          presentBindings: ['financeJournalA', 'financeJournalB'],
          absentBindings: ['financeIntercompanyJournalA', 'financeIntercompanyJournalB'],
        },
        {
          responsePath: ['eliminations', 'journalEntryIds'],
          presentBindings: ['financeIntercompanyJournalA', 'financeIntercompanyJournalB'],
          absentBindings: [],
        },
      ],
    },
  ),
  financial(
    'FinancialReportsController.getGroupReceivablesAging',
    'financial-reports/group/receivables-aging',
    {
      presentBindings: ['companyA', 'companyB'],
      rows: companyRows(
        ['byCompany'],
        ['total'],
        'financeReceivableTotalA',
        'financeReceivableTotalB',
      ),
    },
  ),
  financial(
    'FinancialReportsController.getGroupPayablesAging',
    'financial-reports/group/payables-aging',
    {
      presentBindings: ['companyA', 'companyB'],
      rows: companyRows(['byCompany'], ['total'], 'financePayableTotalA', 'financePayableTotalB'),
    },
  ),
  financial(
    'FinancialReportsController.getGroupCashPosition',
    'financial-reports/group/cash-position',
    {
      presentBindings: ['financeCashAccountA', 'financeCashAccountB', 'companyA', 'companyB'],
    },
  ),
  financial(
    'FinancialReportsController.getIntercompanyBalances',
    'financial-reports/intercompany-balances',
    {
      presentBindings: ['companyA', 'companyB'],
      rows: [
        {
          collectionPath: [],
          matchResponsePath: ['fromCompany', 'id'],
          matchBinding: 'companyA',
          values: [
            { responsePath: ['toCompany', 'id'], binding: 'companyB' },
            { responsePath: ['total'], binding: 'financeIntercompanyTotal' },
          ],
        },
      ],
    },
  ),
  operations(
    'OperationsReportsController.getStockValuation',
    'operations-reports/stock-valuation',
    {
      expectedQueryParameters: STOCK_VALUATION_QUERY_PARAMETERS,
      queryBindings: [companyA()],
      presentBindings: ['operationsProductA'],
      absentBindings: ['operationsProductB'],
    },
  ),
  operations('OperationsReportsController.getSalesSummary', 'operations-reports/sales-summary', {
    expectedQueryParameters: SALES_SUMMARY_QUERY_PARAMETERS,
    presentBindings: [],
    absentBindings: [],
    rootValues: [{ responsePath: ['totalSalesValue'], binding: 'operationsSalesTotalA' }],
  }),
  operations(
    'OperationsReportsController.getPurchaseSummary',
    'operations-reports/purchase-summary',
    {
      expectedQueryParameters: PURCHASE_SUMMARY_QUERY_PARAMETERS,
      presentBindings: [],
      absentBindings: [],
      rootValues: [{ responsePath: ['totalPurchaseValue'], binding: 'operationsPurchaseTotalA' }],
    },
  ),
  operations(
    'OperationsReportsController.getInventoryMovements',
    'operations-reports/inventory-movements',
    {
      expectedQueryParameters: INVENTORY_MOVEMENT_QUERY_PARAMETERS,
      queryBindings: [
        companyA(),
        literal('dateFrom', '2026-01-01'),
        literal('dateTo', '2026-12-31'),
        literal('page', 1),
        literal('pageSize', 100),
      ],
      presentBindings: ['operationsInventoryMovementA'],
      absentBindings: ['operationsInventoryMovementB'],
    },
  ),
  operations('OperationsReportsController.getSalesReport', 'operations-reports/sales-report', {
    presentBindings: ['operationsSalesOrderA'],
    absentBindings: ['operationsSalesOrderB'],
  }),
  operations(
    'OperationsReportsController.getSalesByCustomer',
    'operations-reports/sales-by-customer',
    {
      presentBindings: ['operationsCustomerA'],
      absentBindings: ['operationsCustomerB'],
    },
  ),
  operations(
    'OperationsReportsController.getSalesByProduct',
    'operations-reports/sales-by-product',
    {
      presentBindings: ['operationsProductA'],
      absentBindings: ['operationsProductB'],
    },
  ),
  operations(
    'OperationsReportsController.getCustomerProductSales',
    'operations-reports/customer-product-sales',
    {
      presentBindings: ['operationsCustomerA', 'operationsProductA'],
      absentBindings: ['operationsCustomerB', 'operationsProductB'],
    },
  ),
  operations(
    'OperationsReportsController.getPurchaseReport',
    'operations-reports/purchase-report',
    {
      presentBindings: ['operationsPurchaseOrderA'],
      absentBindings: ['operationsPurchaseOrderB'],
    },
  ),
  operations(
    'OperationsReportsController.getPurchasesBySupplier',
    'operations-reports/purchases-by-supplier',
    {
      presentBindings: ['operationsSupplierA'],
      absentBindings: ['operationsSupplierB'],
    },
  ),
  operations(
    'OperationsReportsController.getPurchasesByProduct',
    'operations-reports/purchases-by-product',
    {
      presentBindings: ['operationsProductA'],
      absentBindings: ['operationsProductB'],
    },
  ),
  operations(
    'OperationsReportsController.getSupplierProductPurchases',
    'operations-reports/supplier-product-purchases',
    {
      presentBindings: ['operationsSupplierA', 'operationsProductA'],
      absentBindings: ['operationsSupplierB', 'operationsProductB'],
    },
  ),
  operations('OperationsReportsController.getLowStock', 'operations-reports/low-stock', {
    presentBindings: ['operationsProductA'],
    absentBindings: ['operationsProductB'],
    queryBindings: [companyA()],
  }),
  operations(
    'OperationsReportsController.getStockAdjustments',
    'operations-reports/stock-adjustments',
    {
      presentBindings: ['operationsStockAdjustmentA'],
      absentBindings: ['operationsStockAdjustmentB'],
    },
  ),
  operations('OperationsReportsController.getStockAgeing', 'operations-reports/stock-ageing', {
    presentBindings: ['operationsProductA'],
    absentBindings: ['operationsProductB'],
    queryBindings: [companyA()],
  }),
  operations(
    'OperationsReportsController.getBranchProfitability',
    'operations-reports/branch-profitability',
    {
      presentBindings: ['operationsBranchA'],
      absentBindings: ['operationsBranchB'],
    },
  ),
  companySummary('AccountingEngineController.getReadiness', 'accounting-engine/readiness', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [
      {
        responsePath: ['indicators', 'openAccountingLocks'],
        binding: 'companySummaryAccountingLocksA',
      },
    ],
  }),
  companySummary('AccountingEngineController.getSummary', 'accounting-engine/summary', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [
      { responsePath: ['openAccountingLocks'], binding: 'companySummaryAccountingLocksA' },
    ],
  }),
  companySummary('ApprovalRequestsController.getReadiness', 'approvals/requests/readiness', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [
      {
        responsePath: ['indicators', 'pendingRequests'],
        binding: 'companySummaryApprovalPendingA',
      },
    ],
  }),
  companySummary('BackgroundJobsController.getStats', 'background-jobs/stats', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['QUEUED'], binding: 'companySummaryBackgroundQueuedA' }],
  }),
  companySummary('ComplianceCalendarController.findUpcoming', 'compliance/calendar/upcoming', {
    expectedQueryParameters: COMPLIANCE_CALENDAR_QUERY_PARAMETERS,
    queryBindings: [companyA(), literal('page', 1), literal('limit', 20)],
    presentBindings: ['companySummaryUpcomingObligationA'],
    absentBindings: ['companySummaryUpcomingObligationB'],
  }),
  companySummary(
    'ComplianceReportsController.getObligationsSummary',
    'compliance/reports/obligations-summary',
    {
      expectedQueryParameters: COMPLIANCE_REPORT_QUERY_PARAMETERS,
      rows: [
        {
          collectionPath: [],
          matchResponsePath: ['status'],
          matchBinding: 'companySummaryObligationStatusA',
          values: [{ responsePath: ['_count', 'id'], binding: 'companySummaryObligationCountA' }],
        },
      ],
    },
  ),
  companySummary(
    'ComplianceReportsController.getTaxTransactionsSummary',
    'compliance/reports/tax-transactions-summary',
    {
      expectedQueryParameters: COMPLIANCE_REPORT_QUERY_PARAMETERS,
      presentBindings: ['companySummaryTaxAmountA'],
      absentBindings: ['companySummaryTaxAmountB'],
    },
  ),
  companySummary('ContractsController.getSummary', 'contracts/summary', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    executionPrincipal: 'group',
    rootValues: [{ responsePath: ['total'], binding: 'companySummaryContractTotalA' }],
    scopeProbe: financialScopeProbe,
  }),
  companySummary('CrmController.getReadiness', 'crm/readiness', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [
      {
        responsePath: ['indicators', 'totalCustomers'],
        binding: 'companySummaryCustomerTotalA',
      },
    ],
  }),
  companySummary('CrmController.getSummary', 'crm/summary', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    presentBindings: ['operationsCustomerA', 'operationsSupplierA'],
    absentBindings: ['operationsCustomerB', 'operationsSupplierB'],
    rootValues: [
      { responsePath: ['totalCustomers'], binding: 'companySummaryCustomerTotalA' },
      { responsePath: ['totalSuppliers'], binding: 'companySummarySupplierTotalA' },
    ],
  }),
  companySummary('CustomersController.workbenchSummary', 'customers/workbench-summary', {
    expectedQueryParameters: CUSTOMER_WORKBENCH_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['total'], binding: 'companySummaryCustomerTotalA' }],
  }),
  companySummary('DocumentsController.getSummary', 'documents/summary', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['total'], binding: 'companySummaryDocumentTotalA' }],
  }),
  companySummary('InventoryBalancesController.summary', 'inventory-balances/summary', {
    expectedQueryParameters: INVENTORY_BALANCE_SUMMARY_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['totalSkus'], binding: 'companySummaryInventoryCountA' }],
  }),
  companySummary('InventoryMovementsController.summary', 'inventory-movements/summary', {
    expectedQueryParameters: INVENTORY_MOVEMENT_SUMMARY_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['totalMovements'], binding: 'companySummaryMovementCountA' }],
  }),
  companySummary('OperationsDashboardController.getReadiness', 'operations-dashboard/readiness', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [
      {
        responsePath: ['indicators', 'activeProducts'],
        binding: 'companySummaryOperationsActiveProductsA',
      },
    ],
  }),
  companySummary('OperationsDashboardController.getSummary', 'operations-dashboard/summary', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    presentBindings: ['operationsProductNameA'],
    absentBindings: ['operationsProductNameB'],
    rootValues: [
      {
        responsePath: ['products', 'active'],
        binding: 'companySummaryOperationsActiveProductsA',
      },
    ],
  }),
  companySummary('ProcurementController.getReadiness', 'procurement/readiness', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    rootValues: [
      {
        responsePath: ['indicators', 'activeSuppliers'],
        binding: 'companySummaryProcurementActiveSuppliersA',
      },
    ],
  }),
  companySummary('ProcurementController.getSummary', 'procurement/summary', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    presentBindings: ['operationsPurchaseOrderA'],
    absentBindings: ['operationsPurchaseOrderB'],
  }),
  companySummary('ProductBatchesController.findExpiring', 'westsides/product-batches/expiring', {
    expectedQueryParameters: COMPANY_QUERY_PARAMETERS,
    presentBindings: ['companySummaryExpiringBatchA'],
    absentBindings: ['companySummaryExpiringBatchB'],
  }),
  companySummary('ProfitController.belowCostAttempts', 'profit/below-cost-attempts', {
    expectedQueryParameters: PROFIT_ATTEMPT_QUERY_PARAMETERS,
    queryBindings: [companyA(), literal('page', 1), literal('limit', 20)],
    presentBindings: ['companySummaryBelowCostAttemptA'],
    absentBindings: ['companySummaryBelowCostAttemptB'],
  }),
  companySummary('ProfitController.productSummary', 'profit/product-summary', {
    expectedQueryParameters: PROFIT_PRODUCT_QUERY_PARAMETERS,
    presentBindings: ['operationsProductA'],
    absentBindings: ['operationsProductB'],
  }),
  companySummary('PurchaseOrdersController.summary', 'purchase-orders/summary', {
    expectedQueryParameters: PURCHASE_ORDER_SUMMARY_QUERY_PARAMETERS,
    rootValues: [
      { responsePath: ['totals', 'totalAmount'], binding: 'companySummaryPurchaseTotalA' },
    ],
  }),
  companySummary('SalesOrdersController.workbenchSummary', 'sales-orders/workbench-summary', {
    expectedQueryParameters: SALES_ORDER_WORKBENCH_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['revenue'], binding: 'companySummarySalesRevenueA' }],
  }),
  companySummary('SuppliersController.workbenchSummary', 'suppliers/workbench-summary', {
    expectedQueryParameters: SUPPLIER_WORKBENCH_QUERY_PARAMETERS,
    rootValues: [{ responsePath: ['total'], binding: 'companySummarySupplierTotalA' }],
  }),
]);

const packOrder = Object.freeze([
  'derived-financial-report-reads',
  'derived-operations-report-reads',
  'derived-company-summary-reads',
] as const);

function packIdFor(
  definition: CrudDerivedReportDefinition,
): CrudDerivedReportReadFixtureRegistration['packId'] {
  return definition.seedScenario === 'financial-company-pair-v1'
    ? 'derived-financial-report-reads'
    : definition.seedScenario === 'operations-company-pair-v1'
      ? 'derived-operations-report-reads'
      : 'derived-company-summary-reads';
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function capabilityMatchesDefinition(
  capability: Capability | undefined,
  definition: CrudDerivedReportDefinition,
): capability is Capability {
  if (!capability || capability.agentExcluded || capability.verb !== 'GET') return false;
  if (capability.path !== definition.expectedPath || capability.params.path.length > 0)
    return false;
  if (capability.permissions.length === 0 && capability.anyPermissions.length === 0) return false;

  const querySchema = capability.params.querySchema;
  const actualQueryParameters = querySchema
    ? Object.keys(querySchema.schema.properties)
    : capability.params.query;
  if (definition.expectedQueryParameters.length === 0) {
    if (capability.params.query.length > 0 || capability.params.freeFormQuery || querySchema) {
      return false;
    }
  } else {
    const closedDtoQuery =
      querySchema?.quality === 'strict' && querySchema.schema.additionalProperties === false;
    const closedNamedQuery =
      !querySchema &&
      capability.params.freeFormQuery === false &&
      capability.params.query.length > 0;
    if (
      (!closedDtoQuery && !closedNamedQuery) ||
      !sameNames(actualQueryParameters, definition.expectedQueryParameters)
    ) {
      return false;
    }
  }

  const bindingNames = definition.queryBindings.map((binding) => binding.name);
  return (
    new Set(bindingNames).size === bindingNames.length &&
    bindingNames.every((name) => definition.expectedQueryParameters.includes(name)) &&
    definition.queryBindings.every(
      (binding) =>
        (binding.binding === 'companyA') !== (binding.literal !== undefined) &&
        (binding.binding === undefined || binding.name === 'companyId'),
    )
  );
}

/**
 * Returns only definitions that still match the exact live route and DTO.
 * Drift is fail-closed: a missing or changed route remains an execution blocker.
 */
export function derivedReportReadEvidencePacks(
  manifest: readonly Capability[],
): readonly CrudDerivedReportReadFixturePack[] {
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = definitions.flatMap((definition): CrudDerivedReportReadFixtureRegistration[] => {
    const capability = byId.get(definition.capabilityId);
    if (!capabilityMatchesDefinition(capability, definition)) return [];
    const fixtureHash = createHash('sha256')
      .update(definition.capabilityId)
      .digest('hex')
      .slice(0, 12);
    const fixtureSlug = definition.capabilityId
      .replace(/Controller\./g, '-')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const packId = packIdFor(definition);
    const audited = capabilityRequiresSensitiveAccessAudit(capability);
    return [
      Object.freeze({
        fixtureId: `derived-report-read-${fixtureSlug}-${fixtureHash}`,
        fixtureVersion: 1,
        capabilityId: definition.capabilityId,
        controlKind: 'positive' as const,
        description: `Reconcile ${definition.capabilityId} against isolated company-A/company-B causal report rows.`,
        governance: {
          scope: definition.scope,
          audit: audited ? ('required' as const) : ('not_applicable' as const),
          ...(audited ? { auditScope: CRUD_COMPANY_A_EXPLICIT_AUDIT_SCOPE } : {}),
        },
        packId,
        expectedPath: definition.expectedPath,
        expectedQueryParameters: definition.expectedQueryParameters,
        queryBindings: definition.queryBindings,
        executionPrincipal: definition.executionPrincipal,
        seedScenario: definition.seedScenario,
        oracle: definition.oracle,
      }),
    ];
  });

  return Object.freeze(
    packOrder.map((packId) =>
      Object.freeze({
        packId,
        packVersion: 1,
        fixtures: Object.freeze(
          fixtures
            .filter((fixture) => fixture.packId === packId)
            .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
        ),
      }),
    ),
  );
}

export const CRUD_DERIVED_REPORT_REVIEWED_DEFINITION_COUNT = definitions.length;
