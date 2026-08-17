import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { SupplierOrderDraftsModule } from './modules/supplier-order-drafts/supplier-order-drafts.module';
import { ProfitModule } from './modules/profit/profit.module';
import { RecordBookModule } from './modules/record-book/record-book.module';
import { OperationsDashboardModule } from './modules/operations-dashboard/operations-dashboard.module';
import { OperationsReportsModule } from './modules/operations-reports/operations-reports.module';
import { WestsidesModule } from './modules/westsides/westsides.module';
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
import { SavedReportViewsModule } from './modules/saved-report-views/saved-report-views.module';
import { ScheduledReportsModule } from './modules/scheduled-reports/scheduled-reports.module';
import { UserDashboardPreferencesModule } from './modules/user-dashboard-preferences/user-dashboard-preferences.module';

// ── Milestone 13 — Integration, Webhooks, API Management, Mobile, Messaging ──
import { IntegrationProvidersModule } from './modules/integration-providers/integration-providers.module';
import { IntegrationConnectionsModule } from './modules/integration-connections/integration-connections.module';
import { IntegrationEventsModule } from './modules/integration-events/integration-events.module';
import { WebhookEndpointsModule } from './modules/webhook-endpoints/webhook-endpoints.module';
import { WebhookEventsModule } from './modules/webhook-events/webhook-events.module';
import { ApiClientsModule } from './modules/api-clients/api-clients.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ApiRequestLogsModule } from './modules/api-request-logs/api-request-logs.module';
import { MobileSessionsModule } from './modules/mobile-sessions/mobile-sessions.module';
import { OfflineSyncModule } from './modules/offline-sync/offline-sync.module';
import { MobilePosLiteModule } from './modules/mobile-pos-lite/mobile-pos-lite.module';
import { MsaidiziModule } from './modules/msaidizi/msaidizi.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
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
import { SecurityModule } from './modules/security/security.module';
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

// ── Milestone 15 — Performance, Scalability, Deployment ──────────────────────
import { BackgroundJobsModule } from './modules/background-jobs/background-jobs.module';
import { JobQueueConfigsModule } from './modules/job-queue-configs/job-queue-configs.module';
import { JobWorkerModule } from './modules/job-worker/job-worker.module';
import { CacheManagementModule } from './modules/cache-management/cache-management.module';
import { DataIsolationModule } from './modules/data-isolation/data-isolation.module';
import { DataIsolationTestsModule } from './modules/data-isolation-tests/data-isolation-tests.module';
import { DataIsolationIssuesModule } from './modules/data-isolation-issues/data-isolation-issues.module';

// ── UX Backend Wave 2 — Credit Notes & Refunds ──────────────────────────────
import { CreditNotesModule } from './modules/credit-notes/credit-notes.module';
import { RefundsModule } from './modules/refunds/refunds.module';
// ── UX Backend Wave 2b — Customer Payments ───────────────────────────────────
import { CustomerPaymentsModule } from './modules/customer-payments/customer-payments.module';

// M16 - QA, Launch Readiness, Documentation, Training, Support

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
    SupplierOrderDraftsModule,
    ProfitModule,
    RecordBookModule,
    OperationsDashboardModule,
    OperationsReportsModule,
    WestsidesModule,
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
    SavedReportViewsModule,
    ScheduledReportsModule,
    UserDashboardPreferencesModule,
    // Milestone 13 — Integration, Webhooks, API Management, Mobile, Messaging
    IntegrationProvidersModule,
    IntegrationConnectionsModule,
    IntegrationEventsModule,
    WebhookEndpointsModule,
    WebhookEventsModule,
    ApiClientsModule,
    ApiKeysModule,
    ApiRequestLogsModule,
    MobileSessionsModule,
    OfflineSyncModule,
    MobilePosLiteModule,
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
    SecurityModule,
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
    // ── Milestone 15 — Performance, Scalability, Deployment ──────────────────
    BackgroundJobsModule,
    JobQueueConfigsModule,
    JobWorkerModule,
    CacheManagementModule,
    DataIsolationModule,
    DataIsolationTestsModule,
    DataIsolationIssuesModule,
    // ── UX Backend Wave 2 — Credit Notes & Refunds ────────────────────────────
    CreditNotesModule,
    RefundsModule,
    // ── UX Backend Wave 2b — Customer Payments ─────────────────────────────────
    CustomerPaymentsModule,
    // ── Msaidizi — agent layer (inert unless MSAIDIZI_ENABLED=true) ────────────
    MsaidiziModule,
    // M16 - QA, Launch Readiness, Documentation, Training, Support
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware, not an interceptor: this runs before the guards, so an audit
    // entry written for a *rejected* request is still attributed to the right
    // channel. An interceptor would run too late to cover that case.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
