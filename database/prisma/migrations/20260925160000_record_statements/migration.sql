ALTER TABLE "record_entries" ADD COLUMN "statementStartsOn" DATE;
CREATE TABLE "record_postings" (
  "id" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "date" DATE NOT NULL,
  "delta" DECIMAL(18,2) NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "reference" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "record_postings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "record_postings_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "record_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "record_postings_recordId_sequence_key" ON "record_postings"("recordId", "sequence");
CREATE INDEX "record_postings_recordId_date_sequence_idx" ON "record_postings"("recordId", "date", "sequence");
ALTER TABLE "record_postings" ADD CONSTRAINT "record_postings_nonzero" CHECK ("delta" <> 0);
ALTER TABLE "record_postings" ADD CONSTRAINT "record_postings_kind" CHECK ("kind" IN ('DEBT', 'OPENING', 'PAYMENT', 'REVERSAL', 'ADJUSTMENT', 'VOID'));
-- Earlier records allowed in-place amount/date edits, so historical amounts cannot
-- be reconstructed reliably. Preserve an explicit opening snapshot at cutover.
-- Earlier payments remain available in the record's original settlement history.
UPDATE "record_entries" SET "statementStartsOn" = GREATEST(CURRENT_DATE, "recordDate") WHERE "kind" IN ('DEBTOR', 'CREDITOR');
INSERT INTO "record_postings" ("id", "recordId", "sequence", "kind", "date", "delta", "description", "reference")
SELECT 'opening-' || "id", "id", "version", 'OPENING', "statementStartsOn", "amount" - "settledAmount",
  'Opening balance brought forward from earlier Records history', "reference"
FROM "record_entries" WHERE "kind" IN ('DEBTOR', 'CREDITOR') AND "voidedAt" IS NULL AND "amount" > "settledAmount";
