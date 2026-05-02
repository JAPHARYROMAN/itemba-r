-- Phase 3 schema: AuditAdjustment lines + reversal traceability + REVERSED status.

-- 1. AuditAdjustmentStatus gains REVERSED.
ALTER TYPE "AuditAdjustmentStatus" ADD VALUE 'REVERSED';

-- 2. Reversal-tracking columns on AuditAdjustment.
ALTER TABLE "audit_adjustments" ADD COLUMN "reversalJournalEntryId" TEXT;
ALTER TABLE "audit_adjustments" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "audit_adjustments" ADD COLUMN "reversedById" TEXT;
ALTER TABLE "audit_adjustments" ADD COLUMN "reversalReason" TEXT;
ALTER TABLE "audit_adjustments"
  ADD CONSTRAINT "audit_adjustments_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. New AuditAdjustmentLine table.
CREATE TABLE "audit_adjustment_lines" (
  "id"                  TEXT NOT NULL,
  "auditAdjustmentId"   TEXT NOT NULL,
  "accountId"           TEXT NOT NULL,
  "description"         TEXT,
  "debit"               DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "credit"              DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_adjustment_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_adjustment_lines_auditAdjustmentId_idx"
  ON "audit_adjustment_lines"("auditAdjustmentId");

ALTER TABLE "audit_adjustment_lines"
  ADD CONSTRAINT "audit_adjustment_lines_auditAdjustmentId_fkey"
  FOREIGN KEY ("auditAdjustmentId") REFERENCES "audit_adjustments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_adjustment_lines"
  ADD CONSTRAINT "audit_adjustment_lines_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
