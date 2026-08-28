import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_QUERY_READ_REMAINING_BLOCKERS,
  canonicalJson,
  metadataReadEvidenceBlockers,
  metadataReadEvidenceFixtures,
  metadataReadEvidencePacks,
  sha256Hex,
} from './crud-execution-evidence';
import { derivedReportReadEvidencePacks } from './crud-derived-report-read-evidence';
import { globalAdminReadEvidencePack } from './crud-global-admin-read-evidence';
import { remainingReadEvidencePack } from './crud-remaining-read-evidence';

/** The measured schema-less, discovery-eligible collection-read bucket. */
const QUERY_SCHEMA_TARGETS = Object.freeze([
  'ActiveSessionsController.findAll',
  'AlertEventsController.findAll',
  'AlertRulesController.findAll',
  'AllowanceTypesController.findAll',
  'ApprovalDelegationsController.findAll',
  'ApprovalRequestsController.findAll',
  'ApprovalRequestsController.getReadiness',
  'ApprovalRequestsController.pendingForMe',
  'ApprovalRequestsController.submittedByMe',
  'ApprovalWorkflowsController.findAll',
  'AttendanceController.findAll',
  'AuditEvidencePacksController.findAll',
  'AutomationRulesController.findAll',
  'AutomationRunsController.findAll',
  'BackgroundJobsController.findAll',
  'BackgroundJobsController.getStats',
  'BackupRunsController.findAll',
  'BidComparisonsController.findAll',
  'CacheManagementController.findAll',
  'CommunicationLogsController.findAll',
  'CompanyTaxRegistrationsController.findAll',
  'ComplianceCalendarController.findAll',
  'ComplianceCalendarController.findOverdue',
  'ComplianceCalendarController.findUpcoming',
  'ComplianceDashboardController.getSummary',
  'ComplianceDocumentRequirementsController.findAll',
  'ComplianceDocumentStatusController.findAll',
  'ComplianceEventsController.findAll',
  'ComplianceObligationsController.findAll',
  'ComplianceReportsController.getDocumentStatusSummary',
  'ComplianceReportsController.getObligationsSummary',
  'ComplianceReportsController.getTaxTransactionsSummary',
  'CrmController.getReadiness',
  'CrmController.getSummary',
  'CustomerCreditProfilesController.findAll',
  'DataExportsController.findAll',
  'DataIsolationTestsController.findAll',
  'DeductionTypesController.findAll',
  'DepartmentsController.findAll',
  'DepreciationController.findAll',
  'DisciplinaryActionsController.findAll',
  'DocumentTemplatesController.findAll',
  'EmployeeAllowancesController.findAll',
  'EmployeeAssignmentsController.findAll',
  'EmployeeDeductionsController.findAll',
  'EmployeesController.findAll',
  'EmploymentContractsController.findAll',
  'EmploymentDisputesController.findAll',
  'FinancialStatementsController.findAll',
  'GeneratedDocumentsController.findAll',
  'HrDocumentsController.findAll',
  'HrReportsController.attendanceReport',
  'HrReportsController.employeeReport',
  'HrReportsController.leaveReport',
  'HrReportsController.payrollReport',
  'InternalControlsController.findAll',
  'LeaveBalancesController.findAll',
  'LeaveRequestsController.findAll',
  'LeaveTypesController.findAll',
  'LoanRepaymentSchedulesController.findAll',
  'MedicalExamRecordsController.findAll',
  'NotificationsController.findAll',
  'NotificationsController.findMy',
  'OshaRegistrationsController.findAll',
  'PayrollEntriesController.findAll',
  'PayrollPeriodsController.findAll',
  'PayrollRunsController.findAll',
  'PerformanceController.findAll',
  'PositionsController.findAll',
  'PostingRulesController.findAll',
  'ProcurementController.getReadiness',
  'ProcurementController.getSummary',
  'ProcurementPlansController.findAll',
  'ProfitController.belowCostAttempts',
  'ProfitController.costGaps',
  'ProfitController.exportReport',
  'ProfitController.productSummary',
  'PurchaseRequisitionsController.findAll',
  'RfqsController.findAll',
  'SalaryAdvancesController.findAll',
  'SalaryPaymentsController.findAll',
  'SalesCommissionsController.findAll',
  'SalesOrdersController.findReceiptAccounts',
  'SavedReportViewsController.findAll',
  'ScheduledReportsController.findAll',
  'SecurityEventsController.findAll',
  'SecurityPoliciesController.findAll',
  'ShiftSchedulesController.findAll',
  'StatutoryDeductionRulesController.findAll',
  'SupplierQuotationsController.findAll',
  'TasksController.findAll',
  'TasksController.myTasks',
  'TaxAuthoritiesController.findAll',
  'TaxCodesController.findAll',
  'TaxFilingPeriodsController.findAll',
  'TaxRatesController.findAll',
  'TaxRatesController.findCurrent',
  'TaxReturnsController.findAll',
  'TaxTransactionsController.findAll',
  'TaxTypesController.findAll',
  'UsersController.findAll',
  'UserSecurityProfilesController.findAll',
  'WorkShiftsController.findAll',
]);

describe('manifest-bound collection-read query evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));

  it('keeps the measured 103-route target exact and gives every route a closed DTO schema', () => {
    expect(QUERY_SCHEMA_TARGETS).toHaveLength(103);
    expect(new Set(QUERY_SCHEMA_TARGETS)).toHaveProperty('size', 103);

    for (const capabilityId of QUERY_SCHEMA_TARGETS) {
      const capability = byId.get(capabilityId);
      expect(capability).toBeDefined();
      expect(capability?.agentExcluded).toBe(capabilityId === 'ProfitController.exportReport');
      if (capabilityId === 'ProfitController.exportReport') {
        expect(capability?.agentExclusionReason).toBe('read_writes_audit_ledger');
      }
      expect(capability?.verb).toBe('GET');
      expect(capability?.params.path).toEqual([]);
      expect(capability?.params.freeFormQuery).toBe(true);
      expect(capability?.params.querySchema?.quality).toBe('strict');
      expect(capability?.params.querySchema?.schema.additionalProperties).toBe(false);
      expect(Object.keys(capability?.params.querySchema?.schema.properties ?? {})).not.toHaveLength(
        0,
      );
      expect(capability?.params.querySchema?.sources).toContain('class-validator');
    }
  });

  it('partitions the 103-route target into marker positives and exact blockers', () => {
    const target = new Set(QUERY_SCHEMA_TARGETS);
    const fixtures = metadataReadEvidenceFixtures(manifest).filter((fixture) =>
      target.has(fixture.capabilityId),
    );
    const markerBlockers = metadataReadEvidenceBlockers(manifest).filter((blocker) =>
      target.has(blocker.capabilityId),
    );
    const derivedSummaryFixtures = derivedReportReadEvidencePacks(manifest)
      .flatMap((pack) => pack.fixtures)
      .filter(
        (fixture) =>
          fixture.seedScenario === 'company-summary-pair-v1' && target.has(fixture.capabilityId),
      );
    const globalAdminFixtures = globalAdminReadEvidencePack(manifest).fixtures.filter((fixture) =>
      target.has(fixture.capabilityId),
    );
    const mutationBlockers = CRUD_QUERY_READ_REMAINING_BLOCKERS.filter((blocker) =>
      target.has(blocker.capabilityId),
    );

    expect(fixtures).toHaveLength(86);
    expect(derivedSummaryFixtures).toHaveLength(11);
    expect(globalAdminFixtures).toHaveLength(5);
    expect(globalAdminFixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [
        'BackupRunsController.findAll',
        'DataIsolationTestsController.findAll',
        'TaxAuthoritiesController.findAll',
        'TaxTypesController.findAll',
        'UserSecurityProfilesController.findAll',
      ].sort(),
    );
    expect(markerBlockers).toEqual([]);
    expect(mutationBlockers).toEqual([
      expect.objectContaining({
        capabilityId: 'ProfitController.exportReport',
        reason: 'read_writes_audit_ledger',
      }),
    ]);
    expect(
      [
        ...fixtures.map((fixture) => fixture.capabilityId),
        ...derivedSummaryFixtures.map((fixture) => fixture.capabilityId),
        ...globalAdminFixtures.map((fixture) => fixture.capabilityId),
        ...markerBlockers.map((item) => item.capabilityId),
        ...mutationBlockers.map((item) => item.capabilityId),
      ].sort(),
    ).toEqual([...QUERY_SCHEMA_TARGETS].sort());
  });

  it('partitions all 235 residual metadata candidates without a shape-only oracle', () => {
    const fixtures = metadataReadEvidenceFixtures(manifest);
    const blockers = metadataReadEvidenceBlockers(manifest);
    const derivedSummaryFixtures = derivedReportReadEvidencePacks(manifest)
      .flatMap((pack) => pack.fixtures)
      .filter((fixture) => fixture.seedScenario === 'company-summary-pair-v1');
    const globalAdminFixtures = globalAdminReadEvidencePack(manifest).fixtures;
    const remainingFixtures = remainingReadEvidencePack(manifest).fixtures;
    const capabilityIds = [
      ...fixtures.map((fixture) => fixture.capabilityId),
      ...derivedSummaryFixtures.map((fixture) => fixture.capabilityId),
      ...globalAdminFixtures.map((fixture) => fixture.capabilityId),
      ...remainingFixtures.map((fixture) => fixture.capabilityId),
      ...blockers.map((blocker) => blocker.capabilityId),
    ];

    expect(fixtures).toHaveLength(184);
    expect(derivedSummaryFixtures).toHaveLength(24);
    expect(globalAdminFixtures).toHaveLength(12);
    expect(remainingFixtures).toHaveLength(15);
    expect(blockers).toEqual([]);
    expect(new Set(capabilityIds)).toHaveProperty('size', 235);
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'AuditLogsController.findSensitive'),
    ).toMatchObject({
      fixtureVersion: 4,
      observable: {
        seedModel: 'AuditLog',
        seedFields: { severity: 'HIGH' },
      },
    });
    expect(
      fixtures.find(
        (fixture) => fixture.capabilityId === 'ComplianceDashboardController.getSummary',
      ),
    ).toMatchObject({
      fixtureVersion: 4,
      observable: {
        seedModel: 'ComplianceDocumentStatus',
        seedFields: { status: 'EXPIRING_SOON' },
      },
    });
    expect(
      fixtures.find((fixture) => fixture.capabilityId === 'OfflineSyncController.findConflicts'),
    ).toMatchObject({
      fixtureVersion: 4,
      observable: {
        seedModel: 'OfflineSyncRecord',
        seedFields: { status: 'CONFLICT' },
      },
    });
    expect(
      fixtures
        .filter((fixture) =>
          [
            'ComplianceCalendarController.findOverdue',
            'DebtsController.getOverdue',
            'LoansController.getOverdue',
            'ProductBatchesController.findExpired',
          ].includes(fixture.capabilityId),
        )
        .map((fixture) => ({
          capabilityId: fixture.capabilityId,
          fixtureVersion: fixture.fixtureVersion,
          executionPrincipal: fixture.executionPrincipal,
          audit: fixture.governance.audit,
          seedModel: fixture.observable.seedModel,
          seedFields: fixture.observable.seedFields,
        })),
    ).toEqual([
      {
        capabilityId: 'ComplianceCalendarController.findOverdue',
        fixtureVersion: 5,
        executionPrincipal: 'group',
        audit: 'not_applicable',
        seedModel: 'ComplianceObligation',
        seedFields: {
          dueDate: { dateIso: '2000-01-01T00:00:00.000Z' },
          status: 'UPCOMING',
        },
      },
      {
        capabilityId: 'DebtsController.getOverdue',
        fixtureVersion: 5,
        executionPrincipal: 'company',
        audit: 'required',
        seedModel: 'Debt',
        seedFields: {
          dueDate: { dateIso: '2000-01-01T00:00:00.000Z' },
          status: 'OUTSTANDING',
        },
      },
      {
        capabilityId: 'LoansController.getOverdue',
        fixtureVersion: 5,
        executionPrincipal: 'company',
        audit: 'required',
        seedModel: 'Loan',
        seedFields: {
          maturityDate: { dateIso: '2000-01-01T00:00:00.000Z' },
          status: 'ACTIVE',
        },
      },
      {
        capabilityId: 'ProductBatchesController.findExpired',
        fixtureVersion: 5,
        executionPrincipal: 'company',
        audit: 'not_applicable',
        seedModel: 'ProductBatch',
        seedFields: {
          expiryDate: { dateIso: '2000-01-01T00:00:00.000Z' },
          status: 'ACTIVE',
        },
      },
    ]);
    expect(
      fixtures
        .filter((fixture) =>
          ['ProfitController.costGaps', 'SalesOrdersController.findReceiptAccounts'].includes(
            fixture.capabilityId,
          ),
        )
        .map((fixture) => ({
          fixtureId: fixture.fixtureId,
          fixtureVersion: fixture.fixtureVersion,
          capabilityId: fixture.capabilityId,
          executionPrincipal: fixture.executionPrincipal,
          request: fixture.request,
          observable: fixture.observable,
        })),
    ).toEqual([
      {
        fixtureId: 'metadata-read-profit-controller-cost-gaps-9317e6a3bb04',
        fixtureVersion: 6,
        capabilityId: 'ProfitController.costGaps',
        executionPrincipal: 'group',
        request: { queryBindings: [{ name: 'companyId', binding: 'companyA' }] },
        observable: {
          kind: 'seeded-company-marker',
          seedModel: 'Product',
          present: { binding: 'companyA' },
          absent: { binding: 'companyB' },
          causalRecordControl: {
            seedScenario: 'profit-cost-gap-product-company-pair-v1',
            lifecycle: 'fixture_isolated',
            responseMarkerField: 'id',
            present: { binding: 'scenarioA', companyBinding: 'companyA' },
            absent: { binding: 'scenarioB', companyBinding: 'companyB' },
          },
        },
      },
      {
        fixtureId: 'metadata-read-sales-orders-controller-find-receipt-accounts-cb9004bf82fc',
        fixtureVersion: 6,
        capabilityId: 'SalesOrdersController.findReceiptAccounts',
        executionPrincipal: 'group',
        request: {
          queryBindings: [
            { name: 'companyId', binding: 'companyA' },
            { name: 'divisionId', binding: 'divisionA' },
            { name: 'branchId', binding: 'branchA' },
            { name: 'paymentMethod', literal: 'CASH' },
            { name: 'limit', literal: 20 },
          ],
        },
        observable: {
          kind: 'seeded-company-marker',
          seedModel: 'CashAccount',
          present: { binding: 'companyA' },
          absent: { binding: 'companyB' },
          causalRecordControl: {
            seedScenario: 'receipt-account-company-pair-v1',
            lifecycle: 'fixture_isolated',
            responseMarkerField: 'id',
            present: { binding: 'scenarioA', companyBinding: 'companyA' },
            absent: { binding: 'scenarioB', companyBinding: 'companyB' },
          },
        },
      },
    ]);
    expect(
      fixtures
        .filter((fixture) =>
          ['TasksController.myTasks', 'UserDashboardPreferencesController.list'].includes(
            fixture.capabilityId,
          ),
        )
        .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
    ).toEqual([
      {
        fixtureId: 'metadata-read-tasks-controller-my-tasks-75cdcc96656f',
        fixtureVersion: 3,
        capabilityId: 'TasksController.myTasks',
        controlKind: 'positive',
        description:
          'Execute the DTO-safe collection read TasksController.myTasks against the isolated actor.',
        executionPrincipal: 'actor',
        governance: { scope: 'actor', audit: 'not_applicable' },
        observable: {
          kind: 'seeded-company-marker',
          seedModel: 'Task',
          present: { binding: 'userA' },
          absent: { binding: 'userB' },
          negativeControl: {
            seedModel: 'Task',
            actorField: 'assignedToId',
            actorBinding: 'userB',
            companyBinding: 'companyA',
          },
        },
      },
      {
        fixtureId: 'metadata-read-user-dashboard-preferences-controller-list-276d801e6874',
        fixtureVersion: 3,
        capabilityId: 'UserDashboardPreferencesController.list',
        controlKind: 'positive',
        description:
          'Execute the DTO-safe collection read UserDashboardPreferencesController.list against the isolated actor.',
        executionPrincipal: 'actor',
        governance: { scope: 'actor', audit: 'not_applicable' },
        observable: {
          kind: 'seeded-company-marker',
          seedModel: 'UserDashboardPreference',
          present: { binding: 'userA' },
          absent: { binding: 'userB' },
          negativeControl: {
            seedModel: 'UserDashboardPreference',
            actorField: 'userId',
            actorBinding: 'userB',
            companyBinding: 'companyA',
          },
        },
      },
    ]);
    expect(sha256Hex(canonicalJson(fixtures.map((fixture) => fixture.capabilityId).sort()))).toBe(
      'd06e40aeea3af9dbebab2d1200d5224cfde331b9c3208be56b65df2076c0dd23',
    );
    expect(sha256Hex(canonicalJson(blockers.map((blocker) => blocker.capabilityId).sort()))).toBe(
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    );
    expect(
      fixtures.every((fixture) => {
        const markerMatchesScope =
          fixture.governance.scope === 'actor'
            ? fixture.observable.present.binding === 'userA' &&
              fixture.observable.absent.binding === 'userB'
            : fixture.governance.scope === 'company' &&
              fixture.observable.present.binding === 'companyA' &&
              fixture.observable.absent.binding === 'companyB';
        return (
          fixture.observable.kind === 'seeded-company-marker' &&
          fixture.observable.seedModel.length > 0 &&
          (fixture.governance.scope === 'actor'
            ? fixture.executionPrincipal === 'actor'
            : fixture.executionPrincipal === 'company' || fixture.executionPrincipal === 'group') &&
          markerMatchesScope
        );
      }),
    ).toBe(true);
    expect(
      fixtures
        .filter((fixture) => fixture.governance.scope === 'actor')
        .map((fixture) => fixture.capabilityId)
        .sort(),
    ).toEqual(
      [
        'ApprovalRequestsController.submittedByMe',
        'NotificationsController.findAll',
        'NotificationsController.findMy',
        'SavedReportViewsController.findAll',
        'TasksController.myTasks',
        'UserDashboardPreferencesController.list',
      ].sort(),
    );
    expect(
      fixtures
        .filter((fixture) => fixture.governance.scope === 'actor')
        .map((fixture) => fixture.observable.negativeControl),
    ).toEqual([
      {
        seedModel: 'ApprovalRequest',
        actorField: 'requestedById',
        actorBinding: 'userB',
        companyBinding: 'companyA',
      },
      {
        seedModel: 'Notification',
        actorField: 'recipientUserId',
        actorBinding: 'userB',
        companyBinding: 'companyA',
      },
      {
        seedModel: 'Notification',
        actorField: 'recipientUserId',
        actorBinding: 'userB',
        companyBinding: 'companyA',
      },
      {
        seedModel: 'SavedReportView',
        actorField: 'userId',
        actorBinding: 'userB',
        companyBinding: 'companyA',
      },
      {
        seedModel: 'Task',
        actorField: 'assignedToId',
        actorBinding: 'userB',
        companyBinding: 'companyA',
      },
      {
        seedModel: 'UserDashboardPreference',
        actorField: 'userId',
        actorBinding: 'userB',
        companyBinding: 'companyA',
      },
    ]);
    expect(fixtures.filter((fixture) => fixture.governance.scope === 'company')).toHaveLength(178);
    for (const fixture of fixtures.filter(
      (candidate) => candidate.governance.scope === 'company',
    )) {
      const capability = byId.get(fixture.capabilityId)!;
      const acceptsCompanyFilter = Boolean(
        capability.params.querySchema?.schema.properties.companyId,
      );
      expect(fixture.executionPrincipal).toBe(acceptsCompanyFilter ? 'group' : 'company');
    }
    expect(
      fixtures.some((fixture) =>
        ['unclassified', 'not_applicable'].includes(fixture.governance.scope),
      ),
    ).toBe(false);
    expect(
      blockers.every((blocker) => blocker.reason === 'no_deterministic_seeded_positive_control'),
    ).toBe(true);
  });

  it('partitions metadata positives once across five domain-isolated packs', () => {
    const fixtures = metadataReadEvidenceFixtures(manifest);
    const packs = metadataReadEvidencePacks(manifest);
    const flattened = packs.flatMap((pack) => pack.fixtures);

    expect(packs.map((pack) => pack.packId)).toEqual([
      'metadata-collection-reads-platform',
      'metadata-collection-reads-governance',
      'metadata-collection-reads-finance',
      'metadata-collection-reads-operations',
      'metadata-collection-reads-hr',
    ]);
    expect(packs.every((pack) => pack.fixtures.length > 0)).toBe(true);
    expect(new Set(flattened.map((fixture) => fixture.fixtureId)).size).toBe(flattened.length);
    expect(flattened.map((fixture) => fixture.fixtureId).sort()).toEqual(
      fixtures.map((fixture) => fixture.fixtureId).sort(),
    );
  });

  it('keeps interceptor-audited reads exact across positives and marker blockers', () => {
    const audited = metadataReadEvidenceFixtures(manifest)
      .filter((fixture) => fixture.governance.audit === 'required')
      .map((fixture) => fixture.capabilityId)
      .sort();

    expect(audited).toEqual(
      [
        'BankAccountsController.findAll',
        'BankAccountsController.getSummary',
        'ContractsController.findAll',
        'DashboardController.getExecutiveSummary',
        'DebtsController.findAll',
        'DebtsController.getOverdue',
        'FixedAssetsController.findAll',
        'FixedAssetsController.getSummary',
        'LoansController.findAll',
        'LoansController.getOverdue',
        'LoansController.getSummary',
      ].sort(),
    );
    expect(
      remainingReadEvidencePack(manifest)
        .fixtures.filter((fixture) => fixture.governance.audit === 'required')
        .map((fixture) => fixture.capabilityId),
    ).toEqual(['DebtsController.getSummary']);
    expect(
      metadataReadEvidenceBlockers(manifest)
        .map((blocker) => blocker.capabilityId)
        .filter((capabilityId) =>
          [
            'ContractsController.getSummary',
            'DebtsController.getOverdue',
            'DebtsController.getSummary',
            'LoansController.getOverdue',
          ].includes(capabilityId),
        )
        .sort(),
    ).toEqual([]);
  });

  it('closes every registered read-scope classification', () => {
    const report = buildCrudCoverageReport(manifest, undefined, '2026-08-26T00:00:00.000Z');

    expect(report.releaseGate.blockers).not.toContainEqual(
      expect.objectContaining({ code: 'read_scope_unclassified' }),
    );
  });
});
