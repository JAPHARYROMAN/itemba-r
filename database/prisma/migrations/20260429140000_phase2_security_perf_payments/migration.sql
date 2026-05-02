-- Phase 2 hardening: refresh-token family revocation, payment idempotency, performance indexes.

-- ─── F-010: Refresh token family revocation ───────────────────────────────────
ALTER TABLE "refresh_tokens" ADD COLUMN "familyId" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "revokedReason" TEXT;
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- ─── F-014: Idempotency keys on payment endpoints ─────────────────────────────
ALTER TABLE "rent_payments" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "parking_payments" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "hospitality_payments" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "external_payments" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "rent_payments_companyId_idempotencyKey_key"
  ON "rent_payments"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "parking_payments_companyId_idempotencyKey_key"
  ON "parking_payments"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "hospitality_payments_companyId_idempotencyKey_key"
  ON "hospitality_payments"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "external_payments_companyId_idempotencyKey_key"
  ON "external_payments"("companyId", "idempotencyKey");

-- ─── F-016: Performance indexes ────────────────────────────────────────────────
CREATE INDEX "loans_companyId_status_maturityDate_idx"
  ON "loans"("companyId", "status", "maturityDate");
CREATE INDEX "loans_companyId_createdAt_idx"
  ON "loans"("companyId", "createdAt");

CREATE INDEX "debts_companyId_status_dueDate_idx"
  ON "debts"("companyId", "status", "dueDate");
CREATE INDEX "debts_companyId_createdAt_idx"
  ON "debts"("companyId", "createdAt");

CREATE INDEX "customers_companyId_status_name_idx"
  ON "customers"("companyId", "status", "name");
CREATE INDEX "customers_companyId_createdAt_idx"
  ON "customers"("companyId", "createdAt");

CREATE INDEX "suppliers_companyId_status_name_idx"
  ON "suppliers"("companyId", "status", "name");
CREATE INDEX "suppliers_companyId_createdAt_idx"
  ON "suppliers"("companyId", "createdAt");

CREATE INDEX "payroll_entries_companyId_idx"
  ON "payroll_entries"("companyId");
CREATE INDEX "payroll_entries_payrollRunId_idx"
  ON "payroll_entries"("payrollRunId");
CREATE INDEX "payroll_entries_employeeId_idx"
  ON "payroll_entries"("employeeId");
CREATE INDEX "payroll_entries_companyId_status_createdAt_idx"
  ON "payroll_entries"("companyId", "status", "createdAt");

CREATE INDEX "salary_payments_companyId_idx"
  ON "salary_payments"("companyId");
CREATE INDEX "salary_payments_employeeId_idx"
  ON "salary_payments"("employeeId");
CREATE INDEX "salary_payments_payrollRunId_idx"
  ON "salary_payments"("payrollRunId");
CREATE INDEX "salary_payments_companyId_paymentDate_status_idx"
  ON "salary_payments"("companyId", "paymentDate", "status");
