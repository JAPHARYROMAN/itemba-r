-- Physical-return restock support on credit-note lines.
-- `returnedQuantity` (opt-in, nullable) marks a line as goods physically returned
-- to stock; `restockUnitCost` freezes the per-unit cost (original COGS basis) at
-- which the returned stock re-enters. A null/zero returnedQuantity keeps the line
-- a pure financial credit (price adjustment / allowance) with no restock.
ALTER TABLE "credit_note_lines"
  ADD COLUMN "returnedQuantity" DECIMAL(18,4),
  ADD COLUMN "restockUnitCost" DECIMAL(18,4);
