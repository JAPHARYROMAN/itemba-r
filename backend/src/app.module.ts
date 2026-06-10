import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { envValidate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { redisConfig } from '@common/config/redis.config';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { GroupsModule } from './modules/groups/groups.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { DivisionsModule } from './modules/divisions/divisions.module';
import { BranchesModule } from './modules/branches/branches.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { LoansModule } from './modules/loans/loans.module';
import { DebtsModule } from './modules/debts/debts.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { FixedAssetsModule } from './modules/fixed-assets/fixed-assets.module';
import { GroupControlModule } from './modules/group-control/group-control.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ChartOfAccountsModule } from './modules/chart-of-accounts/chart-of-accounts.module';
import { FiscalYearsModule } from './modules/fiscal-years/fiscal-years.module';
import { AccountingPeriodsModule } from './modules/accounting-periods/accounting-periods.module';
import { JournalEntriesModule } from './modules/journal-entries/journal-entries.module';
import { CashAccountsModule } from './modules/cash-accounts/cash-accounts.module';
import { ExpenseCategoriesModule } from './modules/expense-categories/expense-categories.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ReceivablesModule } from './modules/receivables/receivables.module';
import { PayablesModule } from './modules/payables/payables.module';
import { IntercompanyTransactionsModule } from './modules/intercompany-transactions/intercompany-transactions.module';
import { FinancialReportsModule } from './modules/financial-reports/financial-reports.module';
import { ReportsCatalogModule } from './modules/reports-catalog/reports-catalog.module';
import { GlobalSearchModule } from './modules/global-search/global-search.module';
import { GroupReportsModule } from './modules/group-reports/group-reports.module';
import { SettingsCatalogModule } from './modules/settings-catalog/settings-catalog.module';
import { UserPreferencesModule } from './modules/user-preferences/user-preferences.module';
import { TaxAutoApplyModule } from './modules/tax-auto-apply/tax-auto-apply.module';
import { TaxFilingEngineModule } from './modules/tax-filing-engine/tax-filing-engine.module';
import { TaxAnomalyDetectionModule } from './modules/tax-anomaly-detection/tax-anomaly-detection.module';
import { EntityCodeGeneratorModule } from './modules/entity-code-generator/entity-code-generator.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { UnitsModule } from './modules/units/units.module';
import { ProductCategoriesModule } from './modules/product-categories/product-categories.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryBalancesModule } from './modules/inventory-balances/inventory-balances.module';
import { InventoryMovementsModule } from './modules/inventory-movements/inventory-movements.module';
import { StockAdjustmentsModule } from './modules/stock-adjustments/stock-adjustments.module';
import { SalesOrdersModule } from './modules/sales-orders/sales-orders.module';
import { SalesCommissionsModule } from './modules/sales-commissions/sales-commissions.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { OperationsDashboardModule } from './modules/operations-dashboard/operations-dashboard.module';
import { OperationsReportsModule } from './modules/operations-reports/operations-reports.module';
import { WestsidesModule } from './modules/westsides/westsides.module';
import { ItembaWorkUnitsModule } from './modules/itemba-work-units/itemba-work-units.module';
import { EquipmentUsageModule } from './modules/equipment-usage/equipment-usage.module';
import { LaborRecordsModule } from './modules/labor-records/labor-records.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { RoutesModule } from './modules/routes/routes.module';
import { TripsModule } from './modules/trips/trips.module';
import { TripExpensesModule } from './modules/trip-expenses/trip-expenses.module';
import { TripFuelUsageModule } from './modules/trip-fuel-usage/trip-fuel-usage.module';
import { VehicleMaintenanceModule } from './modules/vehicle-maintenance/vehicle-maintenance.module';
import { LogisticsDashboardModule } from './modules/logistics-dashboard/logistics-dashboard.module';
import { ConstructionProjectsModule } from './modules/construction-projects/construction-projects.module';
import { ConstructionSitesModule } from './modules/construction-sites/construction-sites.module';
import { BOQItemsModule } from './modules/boq-items/boq-items.module';
import { ProjectMaterialIssuesModule } from './modules/project-material-issues/project-material-issues.module';
import { SubcontractorsModule } from './modules/subcontractors/subcontractors.module';
import { ProjectProgressModule } from './modules/project-progress/project-progress.module';
import { ProjectBillingModule } from './modules/project-billing/project-billing.module';
import { ConstructionDashboardModule } from './modules/construction-dashboard/construction-dashboard.module';
import { LicensedBusinessUnitsModule } from './modules/licensed-business-units/licensed-business-units.module';
import { BusinessLicensesModule } from './modules/business-licenses/business-licenses.module';

// ── Milestone 9 — HR & Payroll ───────────────────────────────────────────────
import { DepartmentsModule } from './modules/hr/departments/departments.module';
import { PositionsModule } from './modules/hr/positions/positions.module';
import { EmployeesModule } from './modules/hr/employees/employees.module';
import { MobileMoneyAccountsModule } from './modules/hr/mobile-money-accounts/mobile-money-accounts.module';
import { PayslipsModule } from './modules/hr/payslips/payslips.module';
import { DisbursementsModule } from './modules/hr/disbursements/disbursements.module';
import { StatutoryReturnsModule } from './modules/hr/statutory-returns/statutory-returns.module';
import { PayrollPostingsModule } from './modules/hr/payroll-postings/payroll-postings.module';
import { WcfAuditModule } from './modules/hr/wcf-audit/wcf-audit.module';
import { OshaRegistrationsModule } from './modules/hr/osha-registrations/osha-registrations.module';
import { MedicalExamRecordsModule } from './modules/hr/medical-exam-records/medical-exam-records.module';
import { EmploymentDisputesModule } from './modules/hr/employment-disputes/employment-disputes.module';
import { DisciplinaryActionsModule } from './modules/hr/disciplinary-actions/disciplinary-actions.module';
import { CcmNoticesModule } from './modules/hr/ccm-notices/ccm-notices.module';
import { ConstructionLabourCostModule } from './modules/construction-labour-cost/construction-labour-cost.module';
import { EmployeeAssignmentsModule } from './modules/hr/employee-assignments/employee-assignments.module';
import { EmploymentContractsModule } from './modules/hr/employment-contracts/employment-contracts.module';
import { WorkShiftsModule } from './modules/hr/work-shifts/work-shifts.module';
import { ShiftSchedulesModule } from './modules/hr/shift-schedules/shift-schedules.module';
import { AttendanceModule } from './modules/hr/attendance/attendance.module';
import { LeaveTypesModule } from './modules/hr/leave-types/leave-types.module';
import { LeaveRequestsModule } from './modules/hr/leave-requests/leave-requests.module';
import { LeaveBalancesModule } from './modules/hr/leave-balances/leave-balances.module';
import { AllowanceTypesModule } from './modules/hr/allowance-types/allowance-types.module';
import { DeductionTypesModule } from './modules/hr/deduction-types/deduction-types.module';
import { EmployeeAllowancesModule } from './modules/hr/employee-allowances/employee-allowances.module';
import { EmployeeDeductionsModule } from './modules/hr/employee-deductions/employee-deductions.module';
import { PayrollPeriodsModule } from './modules/hr/payroll-periods/payroll-periods.module';
import { PayrollRunsModule } from './modules/hr/payroll-runs/payroll-runs.module';
import { PayrollEntriesModule } from './modules/hr/payroll-entries/payroll-entries.module';
import { SalaryPaymentsModule } from './modules/hr/salary-payments/salary-payments.module';
import { SalaryAdvancesModule } from './modules/hr/salary-advances/salary-advances.module';
import { PerformanceModule } from './modules/hr/performance/performance.module';
import { HrDocumentsModule } from './modules/hr/hr-documents/hr-documents.module';
import { HrDashboardModule } from './modules/hr/dashboard/hr-dashboard.module';
import { HrReportsModule } from './modules/hr/reports/hr-reports.module';
// ── Milestone 10 — Tax, Compliance, Regulatory Reporting ─────────────────────
import { TaxModule } from './modules/tax/tax.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { AuditEvidencePacksModule } from './modules/audit-evidence-packs/audit-evidence-packs.module';
import { DataExportsModule } from './modules/data-exports/data-exports.module';
// ── Milestone 11 — Approval Workflows, Notifications, Alerts, Internal Controls
import { ApprovalWorkflowsModule } from './modules/approval-workflows/approval-workflows.module';
import { ApprovalStepsModule } from './modules/approval-steps/approval-steps.module';
import { ApprovalRequestsModule } from './modules/approval-requests/approval-requests.module';
import { ApprovalDelegationsModule } from './modules/approval-delegations/approval-delegations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AlertRulesModule } from './modules/alert-rules/alert-rules.module';
import { AlertEventsModule } from './modules/alert-events/alert-events.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { InternalControlsModule } from './modules/internal-controls/internal-controls.module';
import { ApprovalEngineModule } from './modules/approval-engine/approval-engine.module';

// Milestone 12 — Advanced Reporting, BI Dashboards, Data Warehouse
import { KpiIndicatorsModule } from './modules/kpi-indicators/kpi-indicators.module';
import { KpiSnapshotsModule } from './modules/kpi-snapshots/kpi-snapshots.module';
import { ReportDefinitionsModule } from './modules/report-definitions/report-definitions.module';
import { SavedReportViewsModule } from './modules/saved-report-views/saved-report-views.module';
import { ReportRunsModule } from './modules/report-runs/report-runs.module';
import { ScheduledReportsModule } from './modules/scheduled-reports/scheduled-reports.module';
import { DashboardDefinitionsModule } from './modules/dashboard-definitions/dashboard-definitions.module';
import { DashboardWidgetsModule } from './modules/dashboard-widgets/dashboard-widgets.module';
import { UserDashboardPreferencesModule } from './modules/user-dashboard-preferences/user-dashboard-preferences.module';
import { AnalyticsSnapshotRunsModule } from './modules/analytics-snapshot-runs/analytics-snapshot-runs.module';
import { ExecutiveInsightsModule } from './modules/executive-insights/executive-insights.module';
import { DataQualityModule } from './modules/data-quality/data-quality.module';
import { BiModule } from './modules/bi/bi.module';

// ── Milestone 13 — Integration, Webhooks, API Management, Mobile, Messaging ──
import { IntegrationProvidersModule } from './modules/integration-providers/integration-providers.module';
import { IntegrationConnectionsModule } from './modules/integration-connections/integration-connections.module';
import { IntegrationEventsModule } from './modules/integration-events/integration-events.module';
import { WebhookEndpointsModule } from './modules/webhook-endpoints/webhook-endpoints.module';
import { WebhookEventsModule } from './modules/webhook-events/webhook-events.module';
import { ApiClientsModule } from './modules/api-clients/api-clients.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ApiRequestLogsModule } from './modules/api-request-logs/api-request-logs.module';
import { DeviceRegistrationsModule } from './modules/device-registrations/device-registrations.module';
import { MobileSessionsModule } from './modules/mobile-sessions/mobile-sessions.module';
import { OfflineSyncModule } from './modules/offline-sync/offline-sync.module';
import { ExternalPaymentsModule } from './modules/external-payments/external-payments.module';
import { ExternalMessagesModule } from './modules/external-messages/external-messages.module';
import { MessageTemplatesModule } from './modules/message-templates/message-templates.module';
import { IntegrationMappingsModule } from './modules/integration-mappings/integration-mappings.module';
import { IntegrationApiModule } from './modules/integration-api/integration-api.module';

// ── Milestone 14 — Security Hardening, Backup, DR, Monitoring, Production ────
import { SecurityPoliciesModule } from './modules/security-policies/security-policies.module';
import { UserSecurityProfilesModule } from './modules/user-security-profiles/user-security-profiles.module';
import { SecurityEventsModule } from './modules/security-events/security-events.module';
import { ActiveSessionsModule } from './modules/active-sessions/active-sessions.module';
import { BackupJobsModule } from './modules/backup-jobs/backup-jobs.module';
import { BackupRunsModule } from './modules/backup-runs/backup-runs.module';
import { RestoreTestsModule } from './modules/restore-tests/restore-tests.module';
import { DisasterRecoveryModule } from './modules/disaster-recovery/disaster-recovery.module';
import { SystemHealthModule } from './modules/system-health/system-health.module';
import { SystemMetricsModule } from './modules/system-metrics/system-metrics.module';
import { ErrorLogsModule } from './modules/error-logs/error-logs.module';
import { RetentionPoliciesModule } from './modules/retention-policies/retention-policies.module';
import { DataArchiveJobsModule } from './modules/data-archive-jobs/data-archive-jobs.module';
import { ProductionReadinessModule } from './modules/production-readiness/production-readiness.module';
import { EnvironmentConfigChecksModule } from './modules/environment-config-checks/environment-config-checks.module';
import { SecurityModule } from './modules/security/security.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { BackupsModule } from './modules/backups/backups.module';

// ── Milestone 14.5 — Advanced Accounting ─────────────────────────────────────
import { PostingRulesModule } from './modules/posting-rules/posting-rules.module';
import { PostingRunsModule } from './modules/posting-runs/posting-runs.module';
import { PeriodCloseModule } from './modules/period-close/period-close.module';
import { AccountingLocksModule } from './modules/accounting-locks/accounting-locks.module';
import { BankReconciliationsModule } from './modules/bank-reconciliations/bank-reconciliations.module';
import { DepreciationModule } from './modules/depreciation/depreciation.module';
import { LoanRepaymentSchedulesModule } from './modules/loan-repayment-schedules/loan-repayment-schedules.module';
import { FinancialStatementsModule } from './modules/financial-statements/financial-statements.module';
import { AuditAdjustmentsModule } from './modules/audit-adjustments/audit-adjustments.module';
import { AccountingEngineModule } from './modules/accounting-engine/accounting-engine.module';
// ── Milestone 14.5 — Procurement ─────────────────────────────────────────────
import { PurchaseRequisitionsModule } from './modules/purchase-requisitions/purchase-requisitions.module';
import { RfqsModule } from './modules/rfqs/rfqs.module';
import { SupplierQuotationsModule } from './modules/supplier-quotations/supplier-quotations.module';
import { BidComparisonsModule } from './modules/bid-comparisons/bid-comparisons.module';
import { GoodsReceivedNotesModule } from './modules/goods-received-notes/goods-received-notes.module';
import { SupplierInvoicesModule } from './modules/supplier-invoices/supplier-invoices.module';
import { ThreeWayMatchingModule } from './modules/three-way-matching/three-way-matching.module';
import { ProcurementPlansModule } from './modules/procurement-plans/procurement-plans.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
// ── Milestone 14.5 — CRM/SRM ─────────────────────────────────────────────────
import { ContactPersonsModule } from './modules/contact-persons/contact-persons.module';
import { CommunicationLogsModule } from './modules/communication-logs/communication-logs.module';
import { CustomerCreditProfilesModule } from './modules/customer-credit-profiles/customer-credit-profiles.module';
import { SupplierPerformanceModule } from './modules/supplier-performance/supplier-performance.module';
import { CustomerSegmentsModule } from './modules/customer-segments/customer-segments.module';
import { CustomerStatementsModule } from './modules/customer-statements/customer-statements.module';
import { SupplierStatementsModule } from './modules/supplier-statements/supplier-statements.module';
import { CrmModule } from './modules/crm/crm.module';
// ── Milestone 14.5 — Document Templates ──────────────────────────────────────
import { DocumentTemplatesModule } from './modules/document-templates/document-templates.module';
import { GeneratedDocumentsModule } from './modules/generated-documents/generated-documents.module';
import { DocumentNumberSequencesModule } from './modules/document-number-sequences/document-number-sequences.module';
import { PrintEngineModule } from './modules/print-engine/print-engine.module';
// ── Milestone 14.5 — Business Automation ─────────────────────────────────────
import { AutomationRulesModule } from './modules/automation-rules/automation-rules.module';
import { AutomationRunsModule } from './modules/automation-runs/automation-runs.module';
import { BusinessAutomationModule } from './modules/business-automation/business-automation.module';

// ── Milestone 15 — Performance, Scalability, Deployment ──────────────────────
import { PerformanceDashboardModule } from './modules/performance/performance.module';
import { PerformanceTracesModule } from './modules/performance-traces/performance-traces.module';
import { BackgroundJobsModule } from './modules/background-jobs/background-jobs.module';
import { JobQueueConfigsModule } from './modules/job-queue-configs/job-queue-configs.module';
import { JobWorkerModule } from './modules/job-worker/job-worker.module';
import { CacheManagementModule } from './modules/cache-management/cache-management.module';
import { ScalabilityModule } from './modules/scalability/scalability.module';
import { LoadTestsModule } from './modules/load-tests/load-tests.module';
import { DataIsolationModule } from './modules/data-isolation/data-isolation.module';
import { DataIsolationTestsModule } from './modules/data-isolation-tests/data-isolation-tests.module';
import { DataIsolationIssuesModule } from './modules/data-isolation-issues/data-isolation-issues.module';
import { DeploymentModule } from './modules/deployment/deployment.module';
import { DeploymentReleasesModule } from './modules/deployment-releases/deployment-releases.module';
import { ProductionOpsModule } from './modules/production-ops/production-ops.module';

// M16 - QA, Launch Readiness, Documentation, Training, Support
import { QaModule } from './modules/qa/qa.module';
import { QaTestSuitesModule } from './modules/qa-test-suites/qa-test-suites.module';
import { QaTestCasesModule } from './modules/qa-test-cases/qa-test-cases.module';
import { QaTestRunsModule } from './modules/qa-test-runs/qa-test-runs.module';
import { QaTestResultsModule } from './modules/qa-test-results/qa-test-results.module';
import { LaunchReadinessModule } from './modules/launch-readiness/launch-readiness.module';
import { LaunchBlockersModule } from './modules/launch-blockers/launch-blockers.module';
import { LaunchAssessmentsModule } from './modules/launch-assessments/launch-assessments.module';
import { LaunchReadinessItemsModule } from './modules/launch-readiness-items/launch-readiness-items.module';
import { DocumentationModule } from './modules/documentation/documentation.module';
import { UserManualsModule } from './modules/user-manuals/user-manuals.module';
import { HelpCenterModule } from './modules/help-center/help-center.module';
import { HelpArticlesModule } from './modules/help-articles/help-articles.module';
import { TrainingModule } from './modules/training/training.module';
import { TrainingCoursesModule } from './modules/training-courses/training-courses.module';
import { TrainingLessonsModule } from './modules/training-lessons/training-lessons.module';
import { TrainingEnrollmentsModule } from './modules/training-enrollments/training-enrollments.module';
import { GuidedWalkthroughsModule } from './modules/guided-walkthroughs/guided-walkthroughs.module';
import { TrainingEnvironmentModule } from './modules/training-environment/training-environment.module';
import { SupportModule } from './modules/support/support.module';
import { SupportTicketsModule } from './modules/support-tickets/support-tickets.module';
import { SupportTicketCommentsModule } from './modules/support-ticket-comments/support-ticket-comments.module';
import { FinalQaDashboardModule } from './modules/final-qa-dashboard/final-qa-dashboard.module';
import { GoLiveSignoffModule } from './modules/go-live-signoff/go-live-signoff.module';

import { HealthController } from './common/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: envValidate,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: redisConfig,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    GroupsModule,
    CompaniesModule,
    DivisionsModule,
    BranchesModule,
    AuditLogsModule,
    DocumentsModule,
    BankAccountsModule,
    LoansModule,
    DebtsModule,
    ContractsModule,
    FixedAssetsModule,
    GroupControlModule,
    DashboardModule,
    ChartOfAccountsModule,
    FiscalYearsModule,
    AccountingPeriodsModule,
    JournalEntriesModule,
    CashAccountsModule,
    ExpenseCategoriesModule,
    ExpensesModule,
    ReceivablesModule,
    PayablesModule,
    IntercompanyTransactionsModule,
    FinancialReportsModule,
    ReportsCatalogModule,
    GlobalSearchModule,
    GroupReportsModule,
    SettingsCatalogModule,
    UserPreferencesModule,
    TaxAutoApplyModule,
    TaxFilingEngineModule,
    TaxAnomalyDetectionModule,
    EntityCodeGeneratorModule,
    FinanceModule,
    CustomersModule,
    SuppliersModule,
    UnitsModule,
    ProductCategoriesModule,
    ProductsModule,
    InventoryBalancesModule,
    InventoryMovementsModule,
    StockAdjustmentsModule,
    SalesOrdersModule,
    SalesCommissionsModule,
    PurchaseOrdersModule,
    OperationsDashboardModule,
    OperationsReportsModule,
    WestsidesModule,
    ItembaWorkUnitsModule,
    EquipmentUsageModule,
    LaborRecordsModule,
    VehiclesModule,
    DriversModule,
    RoutesModule,
    TripsModule,
    TripExpensesModule,
    TripFuelUsageModule,
    VehicleMaintenanceModule,
    LogisticsDashboardModule,
    ConstructionProjectsModule,
    ConstructionSitesModule,
    BOQItemsModule,
    ProjectMaterialIssuesModule,
    SubcontractorsModule,
    ProjectProgressModule,
    ProjectBillingModule,
    ConstructionDashboardModule,
    LicensedBusinessUnitsModule,
    BusinessLicensesModule,

    // Milestone 9 — HR & Payroll
    DepartmentsModule,
    PositionsModule,
    EmployeesModule,
    MobileMoneyAccountsModule,
    PayslipsModule,
    DisbursementsModule,
    StatutoryReturnsModule,
    PayrollPostingsModule,
    WcfAuditModule,
    OshaRegistrationsModule,
    MedicalExamRecordsModule,
    EmploymentDisputesModule,
    DisciplinaryActionsModule,
    CcmNoticesModule,
    ConstructionLabourCostModule,
    EmployeeAssignmentsModule,
    EmploymentContractsModule,
    WorkShiftsModule,
    ShiftSchedulesModule,
    AttendanceModule,
    LeaveTypesModule,
    LeaveRequestsModule,
    LeaveBalancesModule,
    AllowanceTypesModule,
    DeductionTypesModule,
    EmployeeAllowancesModule,
    EmployeeDeductionsModule,
    PayrollPeriodsModule,
    PayrollRunsModule,
    PayrollEntriesModule,
    SalaryPaymentsModule,
    SalaryAdvancesModule,
    PerformanceModule,
    HrDocumentsModule,
    HrDashboardModule,
    HrReportsModule,
    // Milestone 10 — Tax, Compliance, Regulatory Reporting
    TaxModule,
    ComplianceModule,
    AuditEvidencePacksModule,
    DataExportsModule,
    // Milestone 11 — Approval Workflows, Notifications, Alerts, Internal Controls
    NotificationsModule,
    AlertRulesModule,
    AlertEventsModule,
    ApprovalWorkflowsModule,
    ApprovalStepsModule,
    ApprovalRequestsModule,
    ApprovalDelegationsModule,
    TasksModule,
    InternalControlsModule,
    ApprovalEngineModule,
    // Milestone 12 — Advanced Reporting, BI Dashboards, Data Warehouse
    KpiIndicatorsModule,
    KpiSnapshotsModule,
    ReportDefinitionsModule,
    SavedReportViewsModule,
    ReportRunsModule,
    ScheduledReportsModule,
    DashboardDefinitionsModule,
    DashboardWidgetsModule,
    UserDashboardPreferencesModule,
    AnalyticsSnapshotRunsModule,
    ExecutiveInsightsModule,
    DataQualityModule,
    BiModule,
    // Milestone 13 — Integration, Webhooks, API Management, Mobile, Messaging
    IntegrationProvidersModule,
    IntegrationConnectionsModule,
    IntegrationEventsModule,
    WebhookEndpointsModule,
    WebhookEventsModule,
    ApiClientsModule,
    ApiKeysModule,
    ApiRequestLogsModule,
    DeviceRegistrationsModule,
    MobileSessionsModule,
    OfflineSyncModule,
    ExternalPaymentsModule,
    ExternalMessagesModule,
    MessageTemplatesModule,
    IntegrationMappingsModule,
    IntegrationApiModule,
    // ── Milestone 14 — Security Hardening, Backup, DR, Monitoring, Production ──
    SecurityPoliciesModule,
    UserSecurityProfilesModule,
    SecurityEventsModule,
    ActiveSessionsModule,
    BackupJobsModule,
    BackupRunsModule,
    RestoreTestsModule,
    DisasterRecoveryModule,
    SystemHealthModule,
    SystemMetricsModule,
    ErrorLogsModule,
    RetentionPoliciesModule,
    DataArchiveJobsModule,
    ProductionReadinessModule,
    EnvironmentConfigChecksModule,
    SecurityModule,
    MonitoringModule,
    BackupsModule,
    // ── Milestone 14.5 — Advanced Accounting ───────────────────────────────────
    PostingRulesModule,
    PostingRunsModule,
    PeriodCloseModule,
    AccountingLocksModule,
    BankReconciliationsModule,
    DepreciationModule,
    LoanRepaymentSchedulesModule,
    FinancialStatementsModule,
    AuditAdjustmentsModule,
    AccountingEngineModule,
    // ── Milestone 14.5 — Procurement ───────────────────────────────────────────
    PurchaseRequisitionsModule,
    RfqsModule,
    SupplierQuotationsModule,
    BidComparisonsModule,
    GoodsReceivedNotesModule,
    SupplierInvoicesModule,
    ThreeWayMatchingModule,
    ProcurementPlansModule,
    ProcurementModule,
    // ── Milestone 14.5 — CRM/SRM ───────────────────────────────────────────────
    ContactPersonsModule,
    CommunicationLogsModule,
    CustomerCreditProfilesModule,
    SupplierPerformanceModule,
    CustomerSegmentsModule,
    CustomerStatementsModule,
    SupplierStatementsModule,
    CrmModule,
    // ── Milestone 14.5 — Document Templates ────────────────────────────────────
    DocumentTemplatesModule,
    GeneratedDocumentsModule,
    DocumentNumberSequencesModule,
    PrintEngineModule,
    // ── Milestone 14.5 — Business Automation ───────────────────────────────────
    AutomationRulesModule,
    AutomationRunsModule,
    BusinessAutomationModule,
    // ── Milestone 15 — Performance, Scalability, Deployment ──────────────────
    PerformanceDashboardModule,
    PerformanceTracesModule,
    BackgroundJobsModule,
    JobQueueConfigsModule,
    JobWorkerModule,
    CacheManagementModule,
    ScalabilityModule,
    LoadTestsModule,
    DataIsolationModule,
    DataIsolationTestsModule,
    DataIsolationIssuesModule,
    DeploymentModule,
    DeploymentReleasesModule,
    ProductionOpsModule,
    // M16 - QA, Launch Readiness, Documentation, Training, Support
    QaModule,
    QaTestSuitesModule,
    QaTestCasesModule,
    QaTestRunsModule,
    QaTestResultsModule,
    LaunchReadinessModule,
    LaunchBlockersModule,
    LaunchAssessmentsModule,
    LaunchReadinessItemsModule,
    DocumentationModule,
    UserManualsModule,
    HelpCenterModule,
    HelpArticlesModule,
    TrainingModule,
    TrainingCoursesModule,
    TrainingLessonsModule,
    TrainingEnrollmentsModule,
    GuidedWalkthroughsModule,
    TrainingEnvironmentModule,
    SupportModule,
    SupportTicketsModule,
    SupportTicketCommentsModule,
    FinalQaDashboardModule,
    GoLiveSignoffModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard execution order: Throttler → JWT → Roles → Permissions
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
