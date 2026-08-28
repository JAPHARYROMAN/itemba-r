-- Durable task progress doubles as the central reconciliation ledger. Keep its
-- integrity enforcement below the application so a compromised worker cannot
-- silently rewrite history. A separately trusted signer can anchor eventHash
-- checkpoints later; this migration deliberately does not pretend a database
-- hash chain is an external signature.
ALTER TABLE "msaidizi_task_events"
  ADD COLUMN "integrityVersion" INTEGER,
  ADD COLUMN "previousHash" CHAR(64),
  ADD COLUMN "eventHash" CHAR(64);

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
        jsonb_build_object(
          'integrityVersion', 1,
          'previousHash', previous_hash,
          'cursor', event_cursor::TEXT,
          'taskId', task_id,
          'type', event_type,
          'actorType', actor_type,
          'actorId', actor_id,
          'payload', event_payload,
          'createdAt', to_jsonb(created_at)
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );
$$;

-- Backfill in cursor order before making the envelope mandatory. The table is
-- locked so no insert can race the one-time chain construction.
LOCK TABLE "msaidizi_task_events" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  prior_hash TEXT := repeat('0', 64);
  event_row RECORD;
  computed_hash TEXT;
BEGIN
  FOR event_row IN
    SELECT
      "cursor",
      "taskId",
      "type",
      "actorType",
      "actorId",
      "payload",
      "createdAt"
    FROM "msaidizi_task_events"
    ORDER BY "cursor" ASC
  LOOP
    computed_hash := "msaidizi_task_event_hash_v1"(
      prior_hash,
      event_row."cursor",
      event_row."taskId",
      event_row."type",
      event_row."actorType",
      event_row."actorId",
      event_row."payload",
      event_row."createdAt"
    );

    UPDATE "msaidizi_task_events"
    SET
      "integrityVersion" = 1,
      "previousHash" = prior_hash,
      "eventHash" = computed_hash
    WHERE "cursor" = event_row."cursor";

    prior_hash := computed_hash;
  END LOOP;
END $$;

ALTER TABLE "msaidizi_task_events"
  ALTER COLUMN "integrityVersion" SET DEFAULT 1,
  ALTER COLUMN "integrityVersion" SET NOT NULL,
  ALTER COLUMN "previousHash" SET NOT NULL,
  ALTER COLUMN "eventHash" SET NOT NULL;

ALTER TABLE "msaidizi_task_events"
  ADD CONSTRAINT "msaidizi_task_events_integrity_version_check"
  CHECK ("integrityVersion" = 1),
  ADD CONSTRAINT "msaidizi_task_events_previous_hash_check"
  CHECK ("previousHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "msaidizi_task_events_event_hash_check"
  CHECK ("eventHash" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "msaidizi_task_events_eventHash_key"
  ON "msaidizi_task_events"("eventHash");

CREATE OR REPLACE FUNCTION "msaidizi_task_event_chain_before_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  prior_cursor BIGINT;
  prior_hash TEXT;
BEGIN
  -- A transaction-scoped global lock prevents two writers from both extending
  -- the same head. Constants are private namespace identifiers, not secrets.
  PERFORM pg_advisory_xact_lock(1297302865, 1414743382);

  SELECT "cursor", "eventHash"
  INTO prior_cursor, prior_hash
  FROM "msaidizi_task_events"
  ORDER BY "cursor" DESC
  LIMIT 1;

  IF prior_cursor IS NOT NULL AND NEW."cursor" <= prior_cursor THEN
    RAISE EXCEPTION 'task event cursor % does not extend chain head %', NEW."cursor", prior_cursor
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  NEW."integrityVersion" := 1;
  NEW."previousHash" := COALESCE(prior_hash, repeat('0', 64));
  NEW."eventHash" := "msaidizi_task_event_hash_v1"(
    NEW."previousHash",
    NEW."cursor",
    NEW."taskId",
    NEW."type",
    NEW."actorType",
    NEW."actorId",
    NEW."payload",
    NEW."createdAt"
  );

  RETURN NEW;
END $$;

CREATE TRIGGER "msaidizi_task_event_chain_insert"
BEFORE INSERT ON "msaidizi_task_events"
FOR EACH ROW
EXECUTE FUNCTION "msaidizi_task_event_chain_before_insert"();

CREATE OR REPLACE FUNCTION "msaidizi_task_event_reject_history_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'msaidizi task events are append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER "msaidizi_task_event_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "msaidizi_task_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "msaidizi_task_event_reject_history_rewrite"();

-- Durable ledger rows may not disappear as a side effect of task deletion.
ALTER TABLE "msaidizi_task_events"
  DROP CONSTRAINT "msaidizi_task_events_taskId_fkey",
  ADD CONSTRAINT "msaidizi_task_events_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the sequence ahead of an imported or explicitly restored cursor.
SELECT setval(
  pg_get_serial_sequence('"msaidizi_task_events"', 'cursor'),
  COALESCE((SELECT MAX("cursor") FROM "msaidizi_task_events"), 1),
  EXISTS(SELECT 1 FROM "msaidizi_task_events")
);
