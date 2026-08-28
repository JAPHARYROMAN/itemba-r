import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { NotificationStatus, NotificationType, SalesPaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Validated field catalogue for the older collection endpoints that formerly
 * accepted an opaque `any` query object.  Endpoint DTOs below use PickType so
 * every route advertises (and the global ValidationPipe enforces) only the
 * keys its service actually consumes.
 *
 * Boolean-looking query values intentionally remain the HTTP strings
 * `"true" | "false"`: several existing services compare those raw values and
 * changing them to booleans here would silently invert their filtering.
 */
class ResourceQueryFieldsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ minimum: 1, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiringDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  directToGroupHr?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  hazardOnly?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  twoFactorEnabled?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountingPeriodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  alertType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  allowanceTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appliesTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attendanceStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  authorityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  backupJobId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  backupType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cacheType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complianceObligationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  controlType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deductionTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  divisionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employmentStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enforcementLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exportType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filingFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fitnessStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leaveTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  loanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  obligationType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  packType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payrollPeriodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payrollRunId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  policyType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  positionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  queueName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registrationType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reportDefinitionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['product-summary', 'customer-summary', 'cost-gaps', 'below-cost-attempts'])
  report?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  runType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirementId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirementType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ruleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  securityRiskLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;
}

type ResourceQueryField = keyof ResourceQueryFieldsDto;
const fields = <T extends readonly ResourceQueryField[]>(...names: T): T => names;

export class CompanyQueryDto extends PickType(ResourceQueryFieldsDto, fields('companyId')) {}
export class PageLimitQueryDto extends PickType(ResourceQueryFieldsDto, fields('page', 'limit')) {}
export class PageSizeQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'pageSize'),
) {}
export class CompanyPageLimitQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'page', 'limit'),
) {}
export class CompanyStatusPageLimitQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'status', 'page', 'limit'),
) {}
export class SearchCompanyPageLimitQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('search', 'companyId', 'page', 'limit'),
) {}

export class ActiveSessionsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'userId', 'companyId', 'status', 'sessionType'),
) {}
export class AlertEventsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'alertType', 'status', 'priority'),
) {}
export class AlertRulesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'alertType', 'isActive'),
) {}
export class ApprovalPendingQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId'),
) {}
export class ApprovalSubmittedQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'status'),
) {}
export class ApprovalRequestsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'entityType', 'status', 'requestedById'),
) {}
export class ApprovalWorkflowsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'entityType', 'isActive'),
) {}
export class AuditEvidencePacksQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'packType', 'status'),
) {}
export class AutomationRunsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'ruleId', 'status', 'page', 'limit'),
) {}
export class BackgroundJobsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'pageSize', 'jobType', 'status', 'companyId', 'queueName'),
) {}
export class BackupRunsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'backupJobId', 'status', 'backupType'),
) {}
export class CacheManagementQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'pageSize', 'cacheType', 'companyId'),
) {}
export class CommunicationLogsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'entityType', 'entityId', 'page', 'limit'),
) {}
export class ComplianceCalendarQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'status', 'priority'),
) {}
export class ComplianceRequirementQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'requirementType', 'status'),
) {}
export class ComplianceDocumentStatusQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'requirementId', 'status'),
) {}
export class ComplianceEventsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'complianceObligationId', 'eventType'),
) {}
export class ComplianceObligationsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'status', 'priority', 'obligationType'),
) {}
export class CompanyDateRangeQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'startDate', 'endDate'),
) {}
export class StatutoryDeductionRulesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'status', 'taxTypeId'),
) {}
export class CustomerCreditProfilesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'customerId', 'page', 'limit'),
) {}
export class DataExportsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'exportType', 'status'),
) {}
export class DataIsolationTestsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'pageSize', 'runType', 'status'),
) {}
export class DepreciationQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'assetId', 'page', 'limit'),
) {}
export class DocumentTemplatesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'templateType', 'isActive', 'page', 'limit'),
) {}
export class GeneratedDocumentsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'templateId', 'entityType', 'entityId', 'page', 'limit'),
) {}
export class AttendanceQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'page',
    'limit',
    'employeeId',
    'companyId',
    'divisionId',
    'branchId',
    'dateFrom',
    'dateTo',
    'attendanceStatus',
  ),
) {}
export class DepartmentsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'search', 'companyId', 'divisionId', 'branchId', 'status'),
) {}
export class EmployeeAllowanceQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'companyId', 'allowanceTypeId'),
) {}
export class EmployeeAssignmentQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'companyId'),
) {}
export class EmployeeDeductionQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'companyId', 'deductionTypeId'),
) {}
export class EmployeesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'page',
    'limit',
    'search',
    'companyId',
    'branchId',
    'departmentId',
    'positionId',
    'status',
    'employmentStatus',
  ),
) {}
export class EmployeeStatusQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'companyId', 'status'),
) {}
export class HrDocumentsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'companyId', 'divisionId', 'branchId', 'documentCategory'),
) {}
export class LeaveRequestsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'page',
    'limit',
    'employeeId',
    'companyId',
    'divisionId',
    'branchId',
    'status',
    'leaveTypeId',
  ),
) {}
export class LeaveBalancesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'employeeId', 'leaveTypeId', 'year'),
) {}
export class PayrollEntriesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'payrollRunId', 'employeeId', 'companyId'),
) {}
export class PayrollRunsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'status', 'payrollPeriodId'),
) {}
export class PerformanceQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'companyId', 'divisionId', 'branchId', 'status'),
) {}
export class PositionsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'page',
    'limit',
    'search',
    'companyId',
    'divisionId',
    'branchId',
    'departmentId',
    'status',
  ),
) {}
export class HrEmployeeReportQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'divisionId', 'departmentId', 'status', 'search'),
) {}
export class HrAttendanceReportQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'divisionId', 'employeeId', 'dateFrom', 'dateTo', 'page', 'limit'),
) {}
export class HrPayrollReportQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'payrollPeriodId', 'status', 'page', 'limit'),
) {}
export class HrLeaveReportQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'divisionId', 'leaveTypeId', 'status', 'dateFrom', 'dateTo', 'page', 'limit'),
) {}
export class ShiftSchedulesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'shiftId', 'companyId', 'dateFrom', 'dateTo'),
) {}
export class EmploymentDisputesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'page',
    'limit',
    'companyId',
    'divisionId',
    'branchId',
    'employeeId',
    'status',
    'directToGroupHr',
  ),
) {}
export class DisciplinaryActionsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'employeeId', 'status', 'type'),
) {}
export class MedicalExamRecordsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'employeeId', 'fitnessStatus', 'expiringDays', 'hazardOnly'),
) {}
export class OshaRegistrationsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'branchId', 'status', 'expiringDays'),
) {}
export class InternalControlsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'controlType', 'isActive', 'enforcementLevel'),
) {}
export class LoanRepaymentSchedulesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'loanId', 'status', 'page', 'limit'),
) {}
export class NotificationsQueryDto extends PageLimitQueryDto {
  @ApiPropertyOptional({ enum: NotificationStatus })
  @IsOptional()
  @IsIn(Object.values(NotificationStatus))
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsIn(Object.values(NotificationType))
  type?: NotificationType;
}
export class SalesCommissionsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'employeeId', 'salesOrderId', 'status', 'companyId'),
) {}
class ReceiptAccountScopeQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'limit', 'divisionId', 'branchId'),
) {}
export class ReceiptAccountsQueryDto extends ReceiptAccountScopeQueryDto {
  @ApiPropertyOptional({ enum: SalesPaymentMethod })
  @IsOptional()
  @IsIn(Object.values(SalesPaymentMethod))
  paymentMethod?: SalesPaymentMethod;
}
export class ProfitProductSummaryQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'divisionId', 'branchId', 'dateFrom', 'dateTo', 'productId'),
) {}
export class ProfitCostGapsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'divisionId', 'branchId'),
) {}
export class ProfitBelowCostAttemptsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'dateFrom', 'dateTo'),
) {}
export class ProfitExportQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'report',
    'format',
    'companyId',
    'divisionId',
    'branchId',
    'dateFrom',
    'dateTo',
    'productId',
    'customerId',
    'page',
    'limit',
  ),
) {}
export class SavedReportViewsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'reportDefinitionId', 'companyId'),
) {}
export class ScheduledReportsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'reportDefinitionId', 'isActive'),
) {}
export class SecurityEventsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields(
    'page',
    'limit',
    'eventType',
    'severity',
    'status',
    'userId',
    'companyId',
    'dateFrom',
    'dateTo',
  ),
) {}
export class SecurityPoliciesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'policyType', 'isActive'),
) {}
export class SupplierQuotationsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('companyId', 'supplierId', 'status', 'page', 'limit'),
) {}
export class MyTasksQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'status', 'taskType', 'priority'),
) {}
export class TasksQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'status', 'assignedToId', 'taskType', 'priority'),
) {}
export class CompanyTaxRegistrationsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'status', 'registrationType'),
) {}
export class TaxAuthoritiesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'search', 'authorityType', 'status', 'country'),
) {}
export class TaxCodesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'taxTypeId', 'appliesTo', 'status'),
) {}
export class TaxFilingPeriodsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'taxTypeId', 'status', 'filingFrequency'),
) {}
export class TaxRatesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'taxTypeId', 'status'),
) {}
export class CurrentTaxRateQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('taxTypeId', 'companyId'),
) {}
export class TaxTransactionsQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'companyId', 'taxTypeId', 'direction', 'status', 'startDate', 'endDate'),
) {}
export class TaxTypesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'search', 'taxCategory', 'status'),
) {}
export class UserSecurityProfilesQueryDto extends PickType(
  ResourceQueryFieldsDto,
  fields('page', 'limit', 'userId', 'companyId', 'securityRiskLevel', 'twoFactorEnabled'),
) {}
