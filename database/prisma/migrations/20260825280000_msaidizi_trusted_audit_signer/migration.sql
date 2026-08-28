-- Expose the exact database canonical bytes used by the existing v1 task-event
-- chain so a separately deployed signer can independently hash what PostgreSQL
-- hashed. Replacing the hash function with the helper is byte-for-byte
-- compatible; the verification block aborts rather than rewriting history.
CREATE OR REPLACE FUNCTION "msaidizi_task_event_canonical_v1"(
  previous_hash TEXT,
  event_cursor BIGINT,
  task_id TEXT,
  event_type TEXT,
  actor_type TEXT,
  actor_id TEXT,
  event_payload JSONB,
  created_at TIMESTAMP(3)
) RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'integrityVersion', 1,
    'previousHash', previous_hash,
    'cursor', event_cursor::TEXT,
    'taskId', task_id,
    'type', event_type,
    'actorType', actor_type,
    'actorId', actor_id,
    'payload', event_payload,
    'createdAt', to_jsonb(created_at)
  )::TEXT;
$$;

CREATE OR REPLACE FUNCTION "msaidizi_task_event_hash_v1"(
  previous_hash TEXT,
  event_cursor BIGINT,
  task_id TEXT,
  event_type TEXT,
  actor_type TEXT,
  actor_id TEXT,
  event_payload JSONB,
  created_at TIMESTAMP(3)
) RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(
    pg_catalog.sha256(
      convert_to(
        "msaidizi_task_event_canonical_v1"(
          previous_hash,
          event_cursor,
          task_id,
          event_type,
          actor_type,
          actor_id,
          event_payload,
          created_at
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

DO $$
DECLARE
  event_row RECORD;
  recomputed TEXT;
BEGIN
  FOR event_row IN
    SELECT * FROM "msaidizi_task_events" ORDER BY "cursor" ASC
  LOOP
    recomputed := "msaidizi_task_event_hash_v1"(
      event_row."previousHash",
      event_row."cursor",
      event_row."taskId",
      event_row."type",
      event_row."actorType",
      event_row."actorId",
      event_row."payload",
      event_row."createdAt"
    );
    IF recomputed <> event_row."eventHash" THEN
      RAISE EXCEPTION 'existing task-event hash mismatch at cursor %', event_row."cursor"
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
END $$;

CREATE TABLE "msaidizi_audit_checkpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schemaVersion" INTEGER NOT NULL,
  "signerKeyId" TEXT NOT NULL,
  "fromCursor" BIGINT NOT NULL,
  "toCursor" BIGINT NOT NULL,
  "previousEventHash" CHAR(64) NOT NULL,
  "eventHeadHash" CHAR(64) NOT NULL,
  "eventCount" INTEGER NOT NULL,
  "canonicalSegmentSha256" CHAR(64) NOT NULL,
  "previousCheckpointSha256" CHAR(64) NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "manifestSha256" CHAR(64) NOT NULL,
  "signature" TEXT NOT NULL,
  "signerCertificateSha256" CHAR(64) NOT NULL,
  "signerSubjectPublicKeySha256" CHAR(64) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "msaidizi_audit_checkpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_audit_checkpoints_version_check" CHECK ("schemaVersion" = 1),
  CONSTRAINT "msaidizi_audit_checkpoints_cursor_check"
    CHECK ("fromCursor" > 0 AND "toCursor" >= "fromCursor" AND "eventCount" > 0),
  CONSTRAINT "msaidizi_audit_checkpoints_expiry_check" CHECK ("expiresAt" > "issuedAt"),
  CONSTRAINT "msaidizi_audit_checkpoints_previous_event_hash_check"
    CHECK ("previousEventHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_event_head_hash_check"
    CHECK ("eventHeadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_segment_hash_check"
    CHECK ("canonicalSegmentSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_previous_checkpoint_hash_check"
    CHECK ("previousCheckpointSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_manifest_hash_check"
    CHECK ("manifestSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_certificate_hash_check"
    CHECK ("signerCertificateSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_spki_hash_check"
    CHECK ("signerSubjectPublicKeySha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_audit_checkpoints_signature_check"
    CHECK ("signature" ~ '^[A-Za-z0-9_-]{86}$')
);

CREATE UNIQUE INDEX "msaidizi_audit_checkpoints_toCursor_key"
  ON "msaidizi_audit_checkpoints"("toCursor");
CREATE UNIQUE INDEX "msaidizi_audit_checkpoints_eventHeadHash_key"
  ON "msaidizi_audit_checkpoints"("eventHeadHash");
CREATE UNIQUE INDEX "msaidizi_audit_checkpoints_previousCheckpointSha256_key"
  ON "msaidizi_audit_checkpoints"("previousCheckpointSha256");
CREATE UNIQUE INDEX "msaidizi_audit_checkpoints_manifestSha256_key"
  ON "msaidizi_audit_checkpoints"("manifestSha256");
CREATE INDEX "msaidizi_audit_checkpoints_signerKeyId_toCursor_idx"
  ON "msaidizi_audit_checkpoints"("signerKeyId", "toCursor");
CREATE INDEX "msaidizi_audit_checkpoints_receivedAt_idx"
  ON "msaidizi_audit_checkpoints"("receivedAt");

CREATE OR REPLACE FUNCTION "msaidizi_audit_checkpoint_reject_history_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'msaidizi audit checkpoints are append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER "msaidizi_audit_checkpoints_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "msaidizi_audit_checkpoints"
FOR EACH STATEMENT
EXECUTE FUNCTION "msaidizi_audit_checkpoint_reject_history_rewrite"();
