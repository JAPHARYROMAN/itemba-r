-- Convert purchase order numbers from global uniqueness to per-company uniqueness.
-- The prior per-company number migration intentionally handled several financial
-- documents but missed purchase_orders.

DROP INDEX IF EXISTS "purchase_orders_purchaseOrderNumber_key";
DROP INDEX IF EXISTS "fuel_shifts_shiftNumber_key";
DROP INDEX IF EXISTS "fuel_tank_dips_dipNumber_key";
DROP INDEX IF EXISTS "fuel_credit_sales_creditSaleNumber_key";
DROP INDEX IF EXISTS "fuel_deliveries_deliveryNumber_key";
DROP INDEX IF EXISTS "fuel_daily_reconciliations_reconciliationNumber_key";
DROP INDEX IF EXISTS "product_batches_batchNumber_key";
DROP INDEX IF EXISTS "stock_damages_damageNumber_key";
DROP INDEX IF EXISTS "quotations_quotationNumber_key";
DROP INDEX IF EXISTS "proforma_invoices_proformaNumber_key";
DROP INDEX IF EXISTS "delivery_notes_deliveryNoteNumber_key";
DROP INDEX IF EXISTS "approval_requests_approvalRequestNumber_key";
DROP INDEX IF EXISTS "alert_events_alertEventNumber_key";
DROP INDEX IF EXISTS "tasks_taskNumber_key";
DROP INDEX IF EXISTS "purchase_requisitions_requisitionNumber_key";
DROP INDEX IF EXISTS "request_for_quotations_rfqNumber_key";
DROP INDEX IF EXISTS "goods_received_notes_grnNumber_key";
DROP INDEX IF EXISTS "supplier_invoices_supplierInvoiceNumber_key";
DROP INDEX IF EXISTS "bank_reconciliations_reconciliationNumber_key";
DROP INDEX IF EXISTS "LaunchBlocker_blockerNumber_key";
DROP INDEX IF EXISTS "SupportTicket_ticketNumber_key";
DROP INDEX IF EXISTS "employees_nidaNumber_idx";

CREATE UNIQUE INDEX "purchase_orders_companyId_purchaseOrderNumber_key"
  ON "purchase_orders"("companyId", "purchaseOrderNumber");

CREATE UNIQUE INDEX "fuel_shifts_companyId_shiftNumber_key"
  ON "fuel_shifts"("companyId", "shiftNumber");

CREATE UNIQUE INDEX "fuel_tank_dips_companyId_dipNumber_key"
  ON "fuel_tank_dips"("companyId", "dipNumber");

CREATE UNIQUE INDEX "fuel_credit_sales_companyId_creditSaleNumber_key"
  ON "fuel_credit_sales"("companyId", "creditSaleNumber");

CREATE UNIQUE INDEX "fuel_deliveries_companyId_deliveryNumber_key"
  ON "fuel_deliveries"("companyId", "deliveryNumber");

CREATE UNIQUE INDEX "fuel_daily_reconciliations_companyId_reconciliationNumber_key"
  ON "fuel_daily_reconciliations"("companyId", "reconciliationNumber");

CREATE UNIQUE INDEX "product_batches_companyId_batchNumber_key"
  ON "product_batches"("companyId", "batchNumber");

CREATE UNIQUE INDEX "stock_damages_companyId_damageNumber_key"
  ON "stock_damages"("companyId", "damageNumber");

CREATE UNIQUE INDEX "quotations_companyId_quotationNumber_key"
  ON "quotations"("companyId", "quotationNumber");

CREATE UNIQUE INDEX "proforma_invoices_companyId_proformaNumber_key"
  ON "proforma_invoices"("companyId", "proformaNumber");

CREATE UNIQUE INDEX "delivery_notes_companyId_deliveryNoteNumber_key"
  ON "delivery_notes"("companyId", "deliveryNoteNumber");

CREATE UNIQUE INDEX "approval_requests_companyId_approvalRequestNumber_key"
  ON "approval_requests"("companyId", "approvalRequestNumber");

CREATE UNIQUE INDEX "alert_events_companyId_alertEventNumber_key"
  ON "alert_events"("companyId", "alertEventNumber");

CREATE UNIQUE INDEX "tasks_companyId_taskNumber_key"
  ON "tasks"("companyId", "taskNumber");

CREATE UNIQUE INDEX "purchase_requisitions_companyId_requisitionNumber_key"
  ON "purchase_requisitions"("companyId", "requisitionNumber");

CREATE UNIQUE INDEX "request_for_quotations_companyId_rfqNumber_key"
  ON "request_for_quotations"("companyId", "rfqNumber");

CREATE UNIQUE INDEX "goods_received_notes_companyId_grnNumber_key"
  ON "goods_received_notes"("companyId", "grnNumber");

CREATE UNIQUE INDEX "supplier_invoices_companyId_supplierInvoiceNumber_key"
  ON "supplier_invoices"("companyId", "supplierInvoiceNumber");

CREATE UNIQUE INDEX "bank_reconciliations_companyId_reconciliationNumber_key"
  ON "bank_reconciliations"("companyId", "reconciliationNumber");

CREATE UNIQUE INDEX "LaunchBlocker_companyId_blockerNumber_key"
  ON "LaunchBlocker"("companyId", "blockerNumber");

CREATE UNIQUE INDEX "SupportTicket_companyId_ticketNumber_key"
  ON "SupportTicket"("companyId", "ticketNumber");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_idx"
  ON "password_reset_tokens"("tokenHash");

CREATE INDEX IF NOT EXISTS "employee_assignments_companyId_status_idx"
  ON "employee_assignments"("companyId", "status");
CREATE INDEX IF NOT EXISTS "employee_assignments_employeeId_status_idx"
  ON "employee_assignments"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "employee_assignments_divisionId_status_idx"
  ON "employee_assignments"("divisionId", "status");
CREATE INDEX IF NOT EXISTS "employee_assignments_branchId_status_idx"
  ON "employee_assignments"("branchId", "status");
CREATE INDEX IF NOT EXISTS "employee_assignments_startDate_idx"
  ON "employee_assignments"("startDate");

CREATE INDEX IF NOT EXISTS "attendance_records_employeeId_idx"
  ON "attendance_records"("employeeId");
CREATE INDEX IF NOT EXISTS "attendance_records_attendanceDate_idx"
  ON "attendance_records"("attendanceDate");
CREATE INDEX IF NOT EXISTS "attendance_records_companyId_attendanceDate_idx"
  ON "attendance_records"("companyId", "attendanceDate");

CREATE INDEX IF NOT EXISTS "leave_types_companyId_isActive_idx"
  ON "leave_types"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "allowance_types_companyId_isActive_idx"
  ON "allowance_types"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "deduction_types_companyId_isActive_idx"
  ON "deduction_types"("companyId", "isActive");

CREATE INDEX IF NOT EXISTS "employee_allowances_companyId_status_idx"
  ON "employee_allowances"("companyId", "status");
CREATE INDEX IF NOT EXISTS "employee_allowances_employeeId_status_idx"
  ON "employee_allowances"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "employee_allowances_allowanceTypeId_idx"
  ON "employee_allowances"("allowanceTypeId");
CREATE INDEX IF NOT EXISTS "employee_allowances_effectiveFrom_idx"
  ON "employee_allowances"("effectiveFrom");

CREATE INDEX IF NOT EXISTS "employee_deductions_companyId_status_idx"
  ON "employee_deductions"("companyId", "status");
CREATE INDEX IF NOT EXISTS "employee_deductions_employeeId_status_idx"
  ON "employee_deductions"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "employee_deductions_deductionTypeId_idx"
  ON "employee_deductions"("deductionTypeId");
CREATE INDEX IF NOT EXISTS "employee_deductions_effectiveFrom_idx"
  ON "employee_deductions"("effectiveFrom");

CREATE INDEX IF NOT EXISTS "work_shifts_companyId_isActive_idx"
  ON "work_shifts"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "shift_schedules_employeeId_scheduleDate_idx"
  ON "shift_schedules"("employeeId", "scheduleDate");
CREATE INDEX IF NOT EXISTS "shift_schedules_companyId_scheduleDate_idx"
  ON "shift_schedules"("companyId", "scheduleDate");
CREATE INDEX IF NOT EXISTS "shift_schedules_workShiftId_idx"
  ON "shift_schedules"("workShiftId");

CREATE INDEX IF NOT EXISTS "performance_records_employeeId_reviewDate_idx"
  ON "performance_records"("employeeId", "reviewDate");
CREATE INDEX IF NOT EXISTS "performance_records_companyId_reviewDate_idx"
  ON "performance_records"("companyId", "reviewDate");
CREATE INDEX IF NOT EXISTS "performance_records_reviewerId_idx"
  ON "performance_records"("reviewerId");

CREATE INDEX IF NOT EXISTS "data_export_logs_companyId_createdAt_idx"
  ON "data_export_logs"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "data_export_logs_exportedById_createdAt_idx"
  ON "data_export_logs"("exportedById", "createdAt");
CREATE INDEX IF NOT EXISTS "data_export_logs_status_createdAt_idx"
  ON "data_export_logs"("status", "createdAt");

CREATE UNIQUE INDEX "employees_nidaNumber_key"
  ON "employees"("nidaNumber");
