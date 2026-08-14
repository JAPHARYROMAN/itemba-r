-- The end-of-day report a Mobile POS Lite terminal submits when the rep closes
-- her day (spec-history-reports §1.3): the record the office reads in the ERP,
-- and the record the letterhead PDF she hands over is rendered FROM.
--
-- Why a table of its own: every figure on it except declaredHeldCount /
-- declaredHeldAmount is recomputed server-side from SalesOrder rows at submit
-- time, so the row is a timestamped SNAPSHOT of records that already exist —
-- no financial fact, no stock movement, no GL entry. The declared pair is what
-- the phone was still holding in its outbox, which is the one thing the server
-- genuinely cannot know, and the column names say so.
--
-- Relation-free (plain ids plus name snapshots), deliberately mirroring
-- westsides_daily_closes: the record must outlive a renamed branch, a
-- reassigned terminal and a deactivated rep.
--
-- "idempotencyKey" is NOT NULL and company-scoped UNIQUE, and the INSERT itself
-- writes it. sales_orders and purchase_orders keep theirs nullable because
-- desktop-created rows share those tables and Postgres treats NULLs as
-- distinct; this table has no non-POS writer, so the nullable form would only
-- weaken the guarantee. The unique index is what settles a create race: as the
-- 20260813120000 migration records, Postgres stamps createdAt at transaction
-- START, so a read-then-write twin check lets both racers conclude they won.
--
-- Deliberately NOT unique on ("terminalId", "businessDate"): a rep may
-- legitimately close twice (a shift handover, or she sold more after closing),
-- and refusing the second close either strands her or forces the first report
-- to be a lie. The newest row for a terminal-day is the day's truth; the
-- earlier ones are its history.
--
-- Additive only: no existing table gains a column, nothing is backfilled,
-- nothing is dropped.
CREATE TABLE "mobile_pos_day_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "terminalCode" TEXT NOT NULL,
    "terminalName" TEXT NOT NULL,
    "repUserId" TEXT NOT NULL,
    "repName" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "salesCount" INTEGER NOT NULL,
    "grossTotal" DECIMAL(18,2) NOT NULL,
    "itemsSoldQuantity" DECIMAL(18,4) NOT NULL,
    "byMethod" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "itemsTruncated" BOOLEAN NOT NULL DEFAULT false,
    "declaredHeldCount" INTEGER NOT NULL DEFAULT 0,
    "declaredHeldAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_pos_day_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_pos_day_reports_companyId_idempotencyKey_key" ON "mobile_pos_day_reports"("companyId", "idempotencyKey");

CREATE INDEX "mobile_pos_day_reports_companyId_businessDate_idx" ON "mobile_pos_day_reports"("companyId", "businessDate");

CREATE INDEX "mobile_pos_day_reports_terminalId_businessDate_idx" ON "mobile_pos_day_reports"("terminalId", "businessDate");
