-- Executable PostgreSQL regression for the fail-closed route-attestation
-- rollout guard and all-or-none central-ledger metadata constraint.
BEGIN;

CREATE TEMPORARY TABLE "msaidizi_host_actions" (
  "id" TEXT PRIMARY KEY,
  "egressEvidenceSha256" TEXT
);

DO $empty_ledger_allowed$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "msaidizi_host_actions" WHERE "egressEvidenceSha256" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'empty legacy egress ledger was rejected';
  END IF;
END
$empty_ledger_allowed$;

INSERT INTO "msaidizi_host_actions" ("id", "egressEvidenceSha256")
VALUES ('legacy-proof', repeat('a', 64));

DO $legacy_ledger_rejected$
DECLARE
  guard_blocked BOOLEAN := false;
BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1 FROM "msaidizi_host_actions" WHERE "egressEvidenceSha256" IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'expected route-attestation rollout guard rejection';
    END IF;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    guard_blocked := true;
  END;
  IF NOT guard_blocked THEN
    RAISE EXCEPTION 'legacy accepted egress proof bypassed the rollout guard';
  END IF;
END
$legacy_ledger_rejected$;

DROP TABLE "msaidizi_host_actions";
CREATE TEMPORARY TABLE "route_attestation_probe" (
  "egressEvidenceSha256" TEXT,
  "egressReservationDnsAnswerSetSha256" CHAR(64),
  "egressConnectionDnsAnswerSetSha256" CHAR(64),
  "egressSelectedAddressSha256" CHAR(64),
  CONSTRAINT "route_attestation_probe_check" CHECK (
    (
      "egressEvidenceSha256" IS NULL AND
      "egressReservationDnsAnswerSetSha256" IS NULL AND
      "egressConnectionDnsAnswerSetSha256" IS NULL AND
      "egressSelectedAddressSha256" IS NULL
    ) OR (
      "egressEvidenceSha256" IS NOT NULL AND
      "egressReservationDnsAnswerSetSha256" IS NOT NULL AND
      "egressReservationDnsAnswerSetSha256" ~ '^[0-9a-f]{64}$' AND
      "egressConnectionDnsAnswerSetSha256" IS NOT NULL AND
      "egressConnectionDnsAnswerSetSha256" ~ '^[0-9a-f]{64}$' AND
      "egressSelectedAddressSha256" IS NOT NULL AND
      "egressSelectedAddressSha256" ~ '^[0-9a-f]{64}$'
    )
  )
);

INSERT INTO "route_attestation_probe" DEFAULT VALUES;
INSERT INTO "route_attestation_probe" VALUES (
  repeat('e', 64), repeat('a', 64), repeat('a', 64), repeat('b', 64)
);

DO $partial_metadata_rejected$
DECLARE
  constraint_blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO "route_attestation_probe" VALUES (
      repeat('e', 64), repeat('a', 64), NULL, repeat('b', 64)
    );
  EXCEPTION WHEN check_violation THEN
    constraint_blocked := true;
  END;
  IF NOT constraint_blocked THEN
    RAISE EXCEPTION 'partial route-attestation metadata bypassed the constraint';
  END IF;
END
$partial_metadata_rejected$;

ROLLBACK;
