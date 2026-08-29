-- Allocate the task-event cursor inside the chain lock.
--
-- The previous trigger took `pg_advisory_xact_lock` before checking that a new
-- event extends the chain head, and its comment said that lock "prevents two
-- writers from both extending the same head". It serialised the CHECK. But
-- `cursor` is BIGSERIAL, and a column default is evaluated BEFORE a BEFORE
-- INSERT trigger runs -- so the number being defended was handed out before the
-- lock was taken.
--
-- Two concurrent writers could therefore draw cursors in one order and acquire
-- the lock in the other:
--
--   writer A: nextval -> 5, acquires the lock second
--   writer B: nextval -> 6, acquires the lock first, appends, head = 6
--   writer A: 5 <= 6, rejected -- for a perfectly ordinary append
--
-- Fail-closed, so nothing was ever corrupted: hash linkage, immutability and
-- the append-only property all held. What was lost was a legitimate concurrent
-- write, reported with an error code that reads as "you did something wrong"
-- rather than "retry me". It was load-dependent, which is why it passed on a
-- developer machine and failed on a loaded CI runner.
--
-- The fix is to stop treating the cursor as an input. It is the ledger's own
-- sequence number, so the ledger assigns it, under the same lock that reads the
-- head it must extend. Allocation and validation are now atomic with respect to
-- one another, which is what the original comment claimed.
--
-- DELIBERATE SEMANTIC CHANGE, stated plainly because it removes a RAISE:
--
--   Before: a caller-supplied cursor that did not extend the head was rejected.
--   After:  a caller-supplied cursor is not honoured at all. Any INSERT lands at
--           head + 1 with a correctly linked hash.
--
-- That is strictly stronger, not weaker. Previously a caller could choose a
-- position and be refused only if the choice was bad; now a caller cannot choose
-- a position at all. Forged history remains impossible either way -- an attempt
-- to insert at an earlier position is appended at the head instead, honestly
-- linked, rather than silently accepted. The distinction was unavoidable:
-- BIGSERIAL fires for every INSERT, so the trigger genuinely cannot tell a
-- caller-supplied value from a sequence-supplied one, and the honest concurrent
-- writer and the backdating attacker arrive looking identical.
--
-- The BIGSERIAL default is intentionally left in place. Its value is discarded,
-- but keeping it means Prisma continues to omit the column on insert, so no
-- application code or schema annotation has to change. The sequence drifts
-- ahead of the real head; nothing reads it.

CREATE OR REPLACE FUNCTION "msaidizi_task_event_chain_before_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  prior_cursor BIGINT;
  prior_hash TEXT;
BEGIN
  -- A transaction-scoped global lock serialises both the read of the head and
  -- the allocation that extends it. Constants are private namespace
  -- identifiers, not secrets.
  PERFORM pg_advisory_xact_lock(1297302865, 1414743382);

  SELECT "cursor", "eventHash"
  INTO prior_cursor, prior_hash
  FROM "msaidizi_task_events"
  ORDER BY "cursor" DESC
  LIMIT 1;

  -- Assigned, never accepted. Whatever arrived here -- a fresh sequence value
  -- or a value someone chose -- is replaced by the one position that extends
  -- the chain, decided while holding the lock.
  NEW."cursor" := COALESCE(prior_cursor, 0) + 1;

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

-- Keep the sequence at or ahead of the real head so that a future reader who
-- does consult it is not misled into thinking the ledger is shorter than it is.
-- Purely cosmetic: nothing depends on the sequence any more.
SELECT setval(
  pg_get_serial_sequence('msaidizi_task_events', 'cursor'),
  GREATEST(
    (SELECT COALESCE(MAX("cursor"), 0) FROM "msaidizi_task_events"),
    (SELECT last_value FROM "msaidizi_task_events_cursor_seq")
  ),
  true
);
