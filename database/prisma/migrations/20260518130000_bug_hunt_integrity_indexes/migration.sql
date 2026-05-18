-- Hot-path indexes from the 2026-05-18 production bug hunt.
CREATE INDEX IF NOT EXISTS "journal_entry_lines_companyId_accountId_createdAt_idx"
  ON "journal_entry_lines"("companyId", "accountId", "createdAt");

CREATE INDEX IF NOT EXISTS "expenses_companyId_status_approvedAt_idx"
  ON "expenses"("companyId", "status", "approvedAt");

CREATE INDEX IF NOT EXISTS "expenses_createdById_idx"
  ON "expenses"("createdById");

CREATE INDEX IF NOT EXISTS "expenses_approvedById_idx"
  ON "expenses"("approvedById");

CREATE INDEX IF NOT EXISTS "expenses_paidById_idx"
  ON "expenses"("paidById");

CREATE INDEX IF NOT EXISTS "sales_order_lines_salesOrderId_createdAt_idx"
  ON "sales_order_lines"("salesOrderId", "createdAt");

CREATE INDEX IF NOT EXISTS "purchase_order_lines_purchaseOrderId_createdAt_idx"
  ON "purchase_order_lines"("purchaseOrderId", "createdAt");
