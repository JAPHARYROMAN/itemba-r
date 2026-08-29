-- Expense input-VAT recovery: persist the recoverable input VAT carried inside
-- the gross expense amount so approval can split DR Expense (net) + DR Tax VAT
-- Receivable / CR AP (gross).
--
-- Additive only. "taxAmount" is deliberately NULLable (no DEFAULT 0): NULL on
-- every legacy row means "tax never assessed", while an explicit 0 means
-- "assessed and exempt/zero-rated" — the posting path treats both as no-split.
ALTER TABLE "expenses" ADD COLUMN "isTaxable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN "taxAmount" DECIMAL(18,2);
