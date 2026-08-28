-- Freeze the exact protected recovery record and the pre-action state that a
-- trusted supervisor must restore. Legacy rows remain readable, but a host
-- action without this typed pair cannot authorize a new recovery command.
ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "recoveryRecordSha256" CHAR(64),
  ADD COLUMN "expectedRestoredStateSha256" CHAR(64);

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_recovery_binding_complete_check"
  CHECK (
    ("recoveryRecordSha256" IS NULL AND "expectedRestoredStateSha256" IS NULL)
    OR
    ("recoveryRecordSha256" IS NOT NULL
      AND "expectedRestoredStateSha256" IS NOT NULL
      AND "journalAccepted" = TRUE
      AND "journalReceiptDigest" IS NOT NULL
      AND "journalEvidenceEventCursor" IS NOT NULL
      AND "journalEvidenceAcceptedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_host_actions_recovery_binding_values_check"
  CHECK (
    ("recoveryRecordSha256" IS NULL
      OR "recoveryRecordSha256" ~ '^[0-9A-Fa-f]{64}$')
    AND
    ("expectedRestoredStateSha256" IS NULL
      OR "expectedRestoredStateSha256" ~ '^[0-9A-Fa-f]{64}$')
  );

-- Existing command rows already froze the recovery-record digest. Backfill the
-- restored-state target only when the centrally persisted precondition is an
-- exact SHA-256 value; malformed legacy rows stay NULL and therefore fail
-- closed on a successful result.
ALTER TABLE "msaidizi_recovery_commands"
  ALTER COLUMN "recoveryRecordSha256" TYPE CHAR(64)
    USING lower("recoveryRecordSha256")::CHAR(64),
  ALTER COLUMN "expectedCurrentStateSha256" TYPE CHAR(64)
    USING lower("expectedCurrentStateSha256")::CHAR(64),
  ADD COLUMN "expectedRestoredStateSha256" CHAR(64);

UPDATE "msaidizi_recovery_commands" AS command
SET "expectedRestoredStateSha256" =
  lower(action."expectedPreState" ->> 'sha256')::CHAR(64)
FROM "msaidizi_host_actions" AS action
WHERE action."id" = command."hostActionId"
  AND action."expectedPreState" ->> 'sha256' ~ '^[0-9A-Fa-f]{64}$';

ALTER TABLE "msaidizi_recovery_commands"
  ADD CONSTRAINT "msaidizi_recovery_commands_binding_values_check"
  CHECK (
    "recoveryRecordSha256" ~ '^[0-9a-f]{64}$'
    AND "expectedCurrentStateSha256" ~ '^[0-9a-f]{64}$'
    AND ("expectedRestoredStateSha256" IS NULL
      OR "expectedRestoredStateSha256" ~ '^[0-9a-f]{64}$')
  );

CREATE FUNCTION "reject_msaidizi_host_action_recovery_binding_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."recoveryRecordSha256" IS DISTINCT FROM NEW."recoveryRecordSha256"
      AND OLD."recoveryRecordSha256" IS NOT NULL THEN
    RAISE EXCEPTION 'msaidizi host-action recovery record is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."expectedRestoredStateSha256" IS DISTINCT FROM NEW."expectedRestoredStateSha256"
      AND OLD."expectedRestoredStateSha256" IS NOT NULL THEN
    RAISE EXCEPTION 'msaidizi host-action restored-state target is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_host_actions_recovery_binding_immutable_guard"
BEFORE UPDATE ON "msaidizi_host_actions"
FOR EACH ROW
EXECUTE FUNCTION "reject_msaidizi_host_action_recovery_binding_rewrite"();

CREATE FUNCTION "reject_msaidizi_recovery_command_binding_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."recoveryRecordSha256" IS DISTINCT FROM NEW."recoveryRecordSha256"
      OR OLD."expectedCurrentStateSha256" IS DISTINCT FROM NEW."expectedCurrentStateSha256"
      OR OLD."expectedRestoredStateSha256" IS DISTINCT FROM NEW."expectedRestoredStateSha256" THEN
    RAISE EXCEPTION 'msaidizi recovery command bindings are immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_recovery_commands_binding_immutable_guard"
BEFORE UPDATE ON "msaidizi_recovery_commands"
FOR EACH ROW
EXECUTE FUNCTION "reject_msaidizi_recovery_command_binding_rewrite"();
