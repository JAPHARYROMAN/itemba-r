-- The application verifies event type, task, actor, payload, and hash-chain
-- integrity before recovery. This foreign key adds the database-level minimum:
-- a persisted journal-evidence pointer must name a real immutable task event.
ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_journalEvidenceEventCursor_fkey"
  FOREIGN KEY ("journalEvidenceEventCursor")
  REFERENCES "msaidizi_task_events"("cursor")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
