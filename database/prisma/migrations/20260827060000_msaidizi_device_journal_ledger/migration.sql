CREATE TABLE "msaidizi_device_journal_heads" (
  "deviceId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "hashVersion" INTEGER NOT NULL DEFAULT 2,
  "entryHash" CHAR(64) NOT NULL,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exactAcknowledgedAt" TIMESTAMP(3),

  CONSTRAINT "msaidizi_device_journal_heads_pkey" PRIMARY KEY ("deviceId"),
  CONSTRAINT "msaidizi_device_journal_heads_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "msaidizi_device_journal_heads_hash_version_check"
    CHECK ("hashVersion" IN (1, 2)),
  CONSTRAINT "msaidizi_device_journal_heads_hash_check"
    CHECK ("entryHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "msaidizi_device_journal_entries" (
  "deviceId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "hashVersion" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "previousHash" CHAR(64) NOT NULL,
  "payloadSha256" CHAR(64) NOT NULL,
  "entryHash" CHAR(64) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "msaidizi_device_journal_entries_pkey" PRIMARY KEY ("deviceId", "sequence"),
  CONSTRAINT "msaidizi_device_journal_entries_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "msaidizi_device_journal_entries_hash_version_check"
    CHECK ("hashVersion" IN (1, 2)),
  CONSTRAINT "msaidizi_device_journal_entries_kind_check" CHECK (
    "kind" IN ('Prepared', 'Completed', 'Rejected', 'Cancelled', 'Failed',
      'NeedsAttention', 'RecoveryPrepared', 'ActionFenced', 'ChainUpgraded')
  ),
  CONSTRAINT "msaidizi_device_journal_entries_identifier_check" CHECK (
    length("actionId") BETWEEN 1 AND 160
    AND length("idempotencyKey") BETWEEN 1 AND 160
  ),
  CONSTRAINT "msaidizi_device_journal_entries_hash_check" CHECK (
    "previousHash" ~ '^[0-9a-f]{64}$'
    AND "payloadSha256" ~ '^[0-9a-f]{64}$'
    AND "entryHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "msaidizi_device_journal_entries_deviceId_entryHash_key"
  ON "msaidizi_device_journal_entries"("deviceId", "entryHash");
CREATE INDEX "msaidizi_device_journal_entries_deviceId_recordedAt_idx"
  ON "msaidizi_device_journal_entries"("deviceId", "recordedAt");

ALTER TABLE "msaidizi_device_journal_heads"
  ADD CONSTRAINT "msaidizi_device_journal_heads_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_device_journal_entries"
  ADD CONSTRAINT "msaidizi_device_journal_entries_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "msaidizi_device_journal_heads" (
  "deviceId", "sequence", "hashVersion", "entryHash", "reconciledAt",
  "exactAcknowledgedAt"
)
SELECT
  "id",
  0,
  2,
  '0000000000000000000000000000000000000000000000000000000000000000',
  CURRENT_TIMESTAMP,
  NULL
FROM "msaidizi_devices";

CREATE OR REPLACE FUNCTION msaidizi_reject_device_journal_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Msaidizi device journal entries are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "msaidizi_device_journal_entries_append_only"
BEFORE UPDATE OR DELETE ON "msaidizi_device_journal_entries"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_device_journal_entry_mutation();
