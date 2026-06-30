-- Adds a per-line landed unit cost to GRN lines so a goods receipt can be valued
-- at the cost actually captured/matched, instead of relying solely on an exact
-- product:unit match to a PO line (which leaves no-PO / UoM-mismatched receipts
-- with an undefined cost and aborts the posting transaction for stock products).
-- Additive and nullable: safe to apply to existing data.
ALTER TABLE "goods_received_note_lines" ADD COLUMN "unitCost" DECIMAL(18,4);
