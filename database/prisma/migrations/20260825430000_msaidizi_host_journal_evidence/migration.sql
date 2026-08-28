-- Persist the complete recovery-prepared journal link and the immutable task
-- event that records central verification. Legacy two-link receipts remain
-- valid because every new field is nullable, but a partial new envelope is
-- rejected at the database boundary.
ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "journalRecoveryPreparedSequence" INTEGER,
  ADD COLUMN "journalRecoveryPreparedPreviousHash" TEXT,
  ADD COLUMN "journalRecoveryPreparedHash" TEXT,
  ADD COLUMN "journalReceiptDigest" TEXT,
  ADD COLUMN "journalEvidenceEventCursor" BIGINT,
  ADD COLUMN "journalEvidenceAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "lateEvidenceAcceptedAt" TIMESTAMP(3);

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_recovery_checkpoint_complete_check"
  CHECK (
    ("journalRecoveryPreparedSequence" IS NULL
      AND "journalRecoveryPreparedPreviousHash" IS NULL
      AND "journalRecoveryPreparedHash" IS NULL)
    OR
    ("journalRecoveryPreparedSequence" IS NOT NULL
      AND "journalRecoveryPreparedPreviousHash" IS NOT NULL
      AND "journalRecoveryPreparedHash" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_host_actions_recovery_checkpoint_chain_check"
  CHECK (
    "journalRecoveryPreparedSequence" IS NULL
    OR (
      "journalPrepareSequence" IS NOT NULL
      AND "journalPreparePreviousHash" IS NOT NULL
      AND "journalPrepareHash" IS NOT NULL
      AND "journalSequence" IS NOT NULL
      AND "journalPreviousHash" IS NOT NULL
      AND "journalHash" IS NOT NULL
      AND "journalRecoveryPreparedSequence"::BIGINT =
        "journalPrepareSequence"::BIGINT + 1
      AND "journalSequence"::BIGINT =
        "journalRecoveryPreparedSequence"::BIGINT + 1
      AND upper("journalRecoveryPreparedPreviousHash") = upper("journalPrepareHash")
      AND upper("journalPreviousHash") = upper("journalRecoveryPreparedHash")
      AND "journalPreparePreviousHash" ~ '^[0-9A-Fa-f]{64}$'
      AND "journalPrepareHash" ~ '^[0-9A-Fa-f]{64}$'
      AND "journalRecoveryPreparedHash" ~ '^[0-9A-Fa-f]{64}$'
      AND "journalHash" ~ '^[0-9A-Fa-f]{64}$'
      AND upper("journalPreparePreviousHash") <> upper("journalPrepareHash")
      AND upper("journalPreparePreviousHash") <> upper("journalRecoveryPreparedHash")
      AND upper("journalPreparePreviousHash") <> upper("journalHash")
      AND upper("journalPrepareHash") <> upper("journalRecoveryPreparedHash")
      AND upper("journalPrepareHash") <> upper("journalHash")
      AND upper("journalRecoveryPreparedHash") <> upper("journalHash")
    )
  ),
  ADD CONSTRAINT "msaidizi_host_actions_journal_evidence_complete_check"
  CHECK (
    ("journalReceiptDigest" IS NULL
      AND "journalEvidenceEventCursor" IS NULL
      AND "journalEvidenceAcceptedAt" IS NULL)
    OR
    ("journalReceiptDigest" IS NOT NULL
      AND "journalEvidenceEventCursor" IS NOT NULL
      AND "journalEvidenceAcceptedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_host_actions_journal_evidence_values_check"
  CHECK (
    ("journalReceiptDigest" IS NULL
      OR "journalReceiptDigest" ~ '^[0-9A-Fa-f]{64}$')
    AND ("journalEvidenceEventCursor" IS NULL OR "journalEvidenceEventCursor" > 0)
  ),
  ADD CONSTRAINT "msaidizi_host_actions_late_evidence_check"
  CHECK (
    "lateEvidenceAcceptedAt" IS NULL
    OR ("journalReceiptDigest" IS NOT NULL
      AND "journalEvidenceEventCursor" IS NOT NULL
      AND "journalEvidenceAcceptedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "msaidizi_host_actions_journalReceiptDigest_key"
  ON "msaidizi_host_actions"("journalReceiptDigest");

CREATE UNIQUE INDEX "msaidizi_host_actions_journalEvidenceEventCursor_key"
  ON "msaidizi_host_actions"("journalEvidenceEventCursor");
