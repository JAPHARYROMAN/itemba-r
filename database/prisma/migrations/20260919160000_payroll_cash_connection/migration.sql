ALTER TABLE "cash_desk_movements" ADD COLUMN "payrollRunId" TEXT,
  ADD COLUMN "payrollJournalEntryId" TEXT;
ALTER TABLE "salary_payments" ADD COLUMN "cashMovementId" TEXT;
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_cashMovementId_fkey"
  FOREIGN KEY ("cashMovementId") REFERENCES "cash_desk_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "cash_desk_movements_payrollJournalEntryId_key" ON "cash_desk_movements"("payrollJournalEntryId");
CREATE INDEX "cash_desk_movements_payrollRunId_idx" ON "cash_desk_movements"("payrollRunId");
CREATE UNIQUE INDEX "cash_desk_movements_active_payroll_key" ON "cash_desk_movements"("payrollRunId")
  WHERE "payrollRunId" IS NOT NULL AND "reversedAt" IS NULL AND "reversalOfId" IS NULL;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_payrollRunId_fkey"
  FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_payrollJournalEntryId_fkey"
  FOREIGN KEY ("payrollJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
