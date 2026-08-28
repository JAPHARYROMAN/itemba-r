-- Dispatch authorization is fail-closed: every future insert must state
-- whether the signed token authorized execution or only transported a cached
-- result. Replay-result leases issued before this migration used the
-- `evidence-` namespace but inherited the temporary EXECUTE default.
--
-- Keep the append-only guard disabled only inside this access-exclusive,
-- transactional rewrite. The lock prevents a concurrent insert from relying
-- on the old default before it is removed, and rollback restores both rows and
-- trigger state if any statement fails.
BEGIN;

ALTER TABLE "msaidizi_host_action_dispatches"
  DISABLE TRIGGER "msaidizi_host_action_dispatches_append_only_guard";

UPDATE "msaidizi_host_action_dispatches"
SET "executionMode" = 'REPLAY_RESULT_ONLY'
WHERE "leaseId" LIKE 'evidence-%'
  AND "executionMode" = 'EXECUTE';

ALTER TABLE "msaidizi_host_action_dispatches"
  ALTER COLUMN "executionMode" DROP DEFAULT;

ALTER TABLE "msaidizi_host_action_dispatches"
  ENABLE TRIGGER "msaidizi_host_action_dispatches_append_only_guard";

COMMIT;
