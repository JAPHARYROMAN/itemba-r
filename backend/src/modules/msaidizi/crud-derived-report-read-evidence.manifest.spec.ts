import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_DERIVED_REPORT_REVIEWED_DEFINITION_COUNT,
  derivedReportReadEvidencePacks,
} from './crud-derived-report-read-evidence';

const FINANCIAL_REPORTS = Object.freeze([
  'FinancialReportsController.getConsolidatedBalanceSheet',
  'FinancialReportsController.getConsolidatedCashFlow',
  'FinancialReportsController.getConsolidatedProfitAndLoss',
  'FinancialReportsController.getGroupBalanceSheet',
  'FinancialReportsController.getGroupCashPosition',
  'FinancialReportsController.getGroupPayablesAging',
  'FinancialReportsController.getGroupProfitAndLoss',
  'FinancialReportsController.getGroupReceivablesAging',
  'FinancialReportsController.getGroupSummary',
  'FinancialReportsController.getGroupTrialBalance',
  'FinancialReportsController.getIntercompanyBalances',
]);

const OPERATIONS_REPORTS = Object.freeze([
  'OperationsReportsController.getBranchProfitability',
  'OperationsReportsController.getCustomerProductSales',
  'OperationsReportsController.getInventoryMovements',
  'OperationsReportsController.getLowStock',
  'OperationsReportsController.getPurchaseReport',
  'OperationsReportsController.getPurchasesByProduct',
  'OperationsReportsController.getPurchasesBySupplier',
  'OperationsReportsController.getPurchaseSummary',
  'OperationsReportsController.getSalesByCustomer',
  'OperationsReportsController.getSalesByProduct',
  'OperationsReportsController.getSalesReport',
  'OperationsReportsController.getSalesSummary',
  'OperationsReportsController.getStockAdjustments',
  'OperationsReportsController.getStockAgeing',
  'OperationsReportsController.getStockValuation',
  'OperationsReportsController.getSupplierProductPurchases',
]);

const COMPANY_SUMMARY_READS = Object.freeze([
  'AccountingEngineController.getReadiness',
  'AccountingEngineController.getSummary',
  'ApprovalRequestsController.getReadiness',
  'BackgroundJobsController.getStats',
  'ComplianceCalendarController.findUpcoming',
  'ComplianceReportsController.getObligationsSummary',
  'ComplianceReportsController.getTaxTransactionsSummary',
  'ContractsController.getSummary',
  'CrmController.getReadiness',
  'CrmController.getSummary',
  'CustomersController.workbenchSummary',
  'DocumentsController.getSummary',
  'InventoryBalancesController.summary',
  'InventoryMovementsController.summary',
  'OperationsDashboardController.getReadiness',
  'OperationsDashboardController.getSummary',
  'ProcurementController.getReadiness',
  'ProcurementController.getSummary',
  'ProductBatchesController.findExpiring',
  'ProfitController.belowCostAttempts',
  'ProfitController.productSummary',
  'PurchaseOrdersController.summary',
  'SalesOrdersController.workbenchSummary',
  'SuppliersController.workbenchSummary',
]);

describe('manifest-bound derived report and company-summary evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const packs = derivedReportReadEvidencePacks(manifest);
  const fixtures = packs.flatMap((pack) => pack.fixtures);

  it('registers exactly the reviewed 11 financial, 16 operations, and 24 summary gaps', () => {
    expect(CRUD_DERIVED_REPORT_REVIEWED_DEFINITION_COUNT).toBe(51);
    expect(packs.map((pack) => pack.packId)).toEqual([
      'derived-financial-report-reads',
      'derived-operations-report-reads',
      'derived-company-summary-reads',
    ]);
    expect(packs.map((pack) => pack.fixtures.length)).toEqual([11, 16, 24]);
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId))).toHaveProperty('size', 51);
    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...FINANCIAL_REPORTS, ...OPERATIONS_REPORTS, ...COMPANY_SUMMARY_READS].sort(),
    );
  });

  it('binds every fixture to the exact live GET path and closed DTO surface', () => {
    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      expect(capability?.agentExcluded).toBe(false);
      expect(capability?.verb).toBe('GET');
      expect(capability?.path).toBe(fixture.expectedPath);
      expect(capability?.params.path).toEqual([]);
      expect(
        [...(capability?.permissions ?? []), ...(capability?.anyPermissions ?? [])].length,
      ).toBeGreaterThan(0);

      if (fixture.expectedQueryParameters.length === 0) {
        expect(capability?.params.freeFormQuery).toBe(false);
        expect(capability?.params.querySchema).toBeUndefined();
      } else if (capability?.params.querySchema) {
        expect(capability?.params.querySchema?.quality).toBe('strict');
        expect(capability?.params.querySchema?.schema.additionalProperties).toBe(false);
        expect(Object.keys(capability?.params.querySchema?.schema.properties ?? {}).sort()).toEqual(
          [...fixture.expectedQueryParameters].sort(),
        );
      } else {
        expect(capability?.params.freeFormQuery).toBe(false);
        expect(capability?.params.query.sort()).toEqual(
          [...fixture.expectedQueryParameters].sort(),
        );
      }
      expect(new Set(fixture.queryBindings.map((binding) => binding.name))).toHaveProperty(
        'size',
        fixture.queryBindings.length,
      );
    }
  });

  it('keeps global and company authorization oracles distinct and causal', () => {
    const financialFixtures = fixtures.filter(
      (fixture) => fixture.seedScenario === 'financial-company-pair-v1',
    );
    const operationsFixtures = fixtures.filter(
      (fixture) => fixture.seedScenario === 'operations-company-pair-v1',
    );
    const companySummaryFixtures = fixtures.filter(
      (fixture) => fixture.seedScenario === 'company-summary-pair-v1',
    );
    const contractsSummary = companySummaryFixtures.find(
      (fixture) => fixture.capabilityId === 'ContractsController.getSummary',
    );
    const ordinaryCompanySummaryFixtures = companySummaryFixtures.filter(
      (fixture) => fixture !== contractsSummary,
    );

    expect(
      financialFixtures.every(
        (fixture) =>
          fixture.governance.scope === 'global' &&
          fixture.executionPrincipal === 'group' &&
          fixture.oracle.scopeProbe.kind === 'company_principal_denied_group_report' &&
          fixture.oracle.presentBindings.length >= 2 &&
          fixture.oracle.absentBindings.length === 0,
      ),
    ).toBe(true);
    expect(
      operationsFixtures.every(
        (fixture) =>
          fixture.governance.scope === 'company' &&
          fixture.executionPrincipal === 'company' &&
          fixture.oracle.scopeProbe.kind === 'foreign_company_denied' &&
          fixture.queryBindings.some(
            (binding) => binding.name === 'companyId' && binding.binding === 'companyA',
          ) &&
          (fixture.oracle.presentBindings.length > 0 ||
            (fixture.oracle.rootValues?.length ?? 0) > 0),
      ),
    ).toBe(true);
    expect(companySummaryFixtures).toHaveLength(24);
    expect(ordinaryCompanySummaryFixtures).toHaveLength(23);
    expect(
      ordinaryCompanySummaryFixtures.every(
        (fixture) =>
          fixture.governance.scope === 'company' &&
          fixture.executionPrincipal === 'company' &&
          fixture.oracle.scopeProbe.kind === 'foreign_company_denied' &&
          fixture.queryBindings.some(
            (binding) => binding.name === 'companyId' && binding.binding === 'companyA',
          ) &&
          (fixture.oracle.presentBindings.length > 0 ||
            (fixture.oracle.rootValues?.length ?? 0) > 0 ||
            (fixture.oracle.rows?.length ?? 0) > 0),
      ),
    ).toBe(true);
    expect(contractsSummary).toMatchObject({
      governance: {
        scope: 'company',
        audit: 'required',
        auditScope: {
          scopeKind: 'COMPANY',
          attributionStatus: 'EXPLICIT',
          companyScopeBindings: ['companyA'],
        },
      },
      executionPrincipal: 'group',
      oracle: {
        scopeProbe: {
          kind: 'company_principal_denied_group_report',
          expectedStatus: 403,
        },
      },
      queryBindings: [{ name: 'companyId', binding: 'companyA' }],
    });
  });

  it('requires exact consolidation placement for both intercompany journal controls', () => {
    const consolidated = financialFixtures().filter((fixture) =>
      fixture.capabilityId.includes('Consolidated'),
    );
    expect(consolidated).toHaveLength(3);
    for (const fixture of consolidated) {
      expect(fixture.oracle.pathMarkers).toEqual([
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
      ]);
    }
  });

  it('fails closed when a live route drifts from the reviewed path', () => {
    const target = byId.get('OperationsReportsController.getSalesReport');
    expect(target).toBeDefined();
    const driftedManifest = manifest.map((capability) =>
      capability.id === target?.id
        ? { ...capability, path: 'operations-reports/drifted-sales-report' }
        : capability,
    );
    const drifted = derivedReportReadEvidencePacks(driftedManifest).flatMap(
      (pack) => pack.fixtures,
    );
    expect(drifted).toHaveLength(50);
    expect(drifted.some((fixture) => fixture.capabilityId === target?.id)).toBe(false);
  });

  function financialFixtures() {
    return fixtures.filter((fixture) => fixture.seedScenario === 'financial-company-pair-v1');
  }
});
