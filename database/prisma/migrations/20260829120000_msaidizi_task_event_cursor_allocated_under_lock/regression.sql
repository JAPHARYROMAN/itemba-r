-- Executable PostgreSQL regression for cursor allocation under the chain lock.
-- Everything happens inside a transaction that is rolled back, so running it
-- leaves no rows or objects behind.
--
-- The bug this guards was not reachable from a single session: it needed two
-- writers drawing sequence values in one order and taking the lock in the
-- other. What IS reachable from one session, and is the same defect stated
-- exactly, is that a cursor which does not extend the head must never decide
-- where a row lands. Before the fix such an INSERT raised; the honest
-- concurrent writer arrived looking identical to it and was rejected too.
BEGIN;

-- A task row to hang events off. `updatedAt` has no database default because
-- Prisma supplies it, so it is named explicitly here.
INSERT INTO "msaidizi_tasks" ("id", "principalId", "title", "objective", "mode", "updatedAt")
SELECT
  'regression-cursor-task',
  (SELECT "id" FROM "msaidizi_principals" LIMIT 1),
  'cursor allocation regression',
  'Verify the cursor is allocated under the chain lock',
  'ASK',
  now()
WHERE EXISTS (SELECT 1 FROM "msaidizi_principals" LIMIT 1);

DO $cursor_allocation$
DECLARE
  head_before BIGINT;
  assigned_low BIGINT;
  assigned_next BIGINT;
  linked BIGINT;
BEGIN
  -- Skip cleanly on an empty database: with no principal there is no task to
  -- attach events to, and a regression that silently tests nothing is worse
  -- than one that says it did not run.
  IF NOT EXISTS (SELECT 1 FROM "msaidizi_tasks" WHERE "id" = 'regression-cursor-task') THEN
    RAISE NOTICE 'no principal available; cursor allocation regression skipped';
    RETURN;
  END IF;

  SELECT COALESCE(MAX("cursor"), 0) INTO head_before FROM "msaidizi_task_events";

  -- Deliberately supply cursor = 1, which cannot extend a non-empty chain. The
  -- ledger must ignore it and append at the head rather than either honouring
  -- it or refusing the write.
  INSERT INTO "msaidizi_task_events" ("cursor", "taskId", "type", "actorType", "payload")
  VALUES (1, 'regression-cursor-task', 'regression.ignored-cursor', 'SYSTEM', '{}'::jsonb)
  RETURNING "cursor" INTO assigned_low;

  IF assigned_low <> head_before + 1 THEN
    RAISE EXCEPTION
      'supplied cursor was honoured or misallocated: got %, expected %',
      assigned_low, head_before + 1;
  END IF;

  -- A second append must take the next position, proving allocation reads the
  -- head it just wrote rather than a stale one.
  INSERT INTO "msaidizi_task_events" ("taskId", "type", "actorType", "payload")
  VALUES ('regression-cursor-task', 'regression.sequential', 'SYSTEM', '{}'::jsonb)
  RETURNING "cursor" INTO assigned_next;

  IF assigned_next <> assigned_low + 1 THEN
    RAISE EXCEPTION 'second append did not extend: got %, expected %',
      assigned_next, assigned_low + 1;
  END IF;

  -- The hash chain must still link: the later row's previousHash is the earlier
  -- row's eventHash. Allocation changed; integrity did not.
  SELECT count(*) INTO linked
  FROM "msaidizi_task_events" later
  JOIN "msaidizi_task_events" earlier ON earlier."cursor" = assigned_low
  WHERE later."cursor" = assigned_next
    AND later."previousHash" = earlier."eventHash";

  IF linked <> 1 THEN
    RAISE EXCEPTION 'chain linkage broken across an allocated cursor';
  END IF;

  RAISE NOTICE 'cursor allocation regression passed (head % -> % -> %)',
    head_before, assigned_low, assigned_next;
END
$cursor_allocation$;

ROLLBACK;
