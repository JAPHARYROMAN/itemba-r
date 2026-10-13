ALTER TABLE "customer_statement_runs"
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "snapshotHash" TEXT,
  ADD COLUMN "pdfContent" BYTEA,
  ADD COLUMN "calculationVersion" TEXT;

-- Old summary-only runs intentionally remain without a snapshot. They are not
-- silently regenerated from mutable current records.

CREATE FUNCTION preserve_issued_customer_statement() RETURNS trigger AS $$
BEGIN
  IF OLD."snapshot" IS NOT NULL AND (
    NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR
    NEW."snapshotHash" IS DISTINCT FROM OLD."snapshotHash" OR
    NEW."pdfContent" IS DISTINCT FROM OLD."pdfContent" OR
    NEW."calculationVersion" IS DISTINCT FROM OLD."calculationVersion" OR
    NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
    NEW."customerId" IS DISTINCT FROM OLD."customerId" OR
    NEW."periodStart" IS DISTINCT FROM OLD."periodStart" OR
    NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd" OR
    NEW."openingBalance" IS DISTINCT FROM OLD."openingBalance" OR
    NEW."totalDebits" IS DISTINCT FROM OLD."totalDebits" OR
    NEW."totalCredits" IS DISTINCT FROM OLD."totalCredits" OR
    NEW."closingBalance" IS DISTINCT FROM OLD."closingBalance" OR
    NEW."currency" IS DISTINCT FROM OLD."currency" OR
    NEW."statementRunNumber" IS DISTINCT FROM OLD."statementRunNumber" OR
    NEW."generatedById" IS DISTINCT FROM OLD."generatedById" OR
    NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt" OR
    NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Issued customer statement content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customer_statement_snapshot_immutable
  BEFORE UPDATE ON "customer_statement_runs"
  FOR EACH ROW EXECUTE FUNCTION preserve_issued_customer_statement();
