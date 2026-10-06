ALTER TABLE "cash_desk_entries" ADD COLUMN "erpBalanceApplied" BOOLEAN NOT NULL DEFAULT false;

-- A verified first connection included the existing book in the ERP baseline.
-- Mark evidence only; this migration never changes money or posts journals.
UPDATE cash_desk_entries e SET "erpBalanceApplied" = true
FROM cash_desk_accounts d, cash_desk_movements m
WHERE e."accountId" = d.id AND e."movementId" = m.id
AND d."erpCashAccountId" IS NOT NULL
AND EXISTS (
  SELECT 1 FROM audit_logs a
  WHERE a.action = 'CONNECT' AND a."entityType" = 'CashLedgerConnection'
    AND a."entityId" = d."erpCashAccountId"
    AND a.metadata->'balanceSetup'->>'deskAccountId' = d.id
    AND a.metadata->'balanceSetup'->>'source' = 'CashDesk'
    AND m."createdAt" <= a."createdAt"
);

-- Canonical payments already deducted ERP cash. Do not replay them as desk-only cash.
UPDATE cash_desk_entries e SET "erpBalanceApplied" = true
FROM cash_desk_accounts d, cash_desk_movements m, supplier_payments p
WHERE e."accountId" = d.id AND e."movementId" = m.id
AND m."supplierPaymentId" = p.id AND p."cashAccountId" = d."erpCashAccountId"
AND p."journalEntryId" IS NOT NULL;

UPDATE cash_desk_entries e SET "erpBalanceApplied" = true
FROM cash_desk_accounts d, cash_desk_movements m
WHERE e."accountId" = d.id AND e."movementId" = m.id
AND d."erpCashAccountId" IS NOT NULL AND m."journalEntryId" IS NOT NULL
AND (m."requestId" LIKE 'SupplierPayment:%' OR m."requestId" LIKE 'CustomerPayment:%'
  OR m."requestId" LIKE 'Expense:%' OR m."requestId" LIKE 'Refund:%');

-- Reversals of ERP-owned effects also reached ERP. Manual reversals remain pending.
UPDATE cash_desk_entries e SET "erpBalanceApplied" = true
FROM cash_desk_movements m, cash_desk_entries original
WHERE e."movementId" = m.id AND m."reversalOfId" = original."movementId"
AND e."accountId" = original."accountId" AND original."erpBalanceApplied" = true
AND m."journalEntryId" IS NOT NULL;
