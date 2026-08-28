-- Persist only signed route-attestation digests. Raw DNS answers and selected
-- addresses remain ephemeral inside the independently privileged supervisor.
DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "msaidizi_host_actions" WHERE "egressEvidenceSha256" IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Cannot enable route-attested egress with legacy accepted egress evidence',
      HINT = 'Reconcile and archive legacy proof rows before retrying; route evidence cannot be inferred.';
  END IF;
END
$migration_guard$;

ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "egressReservationDnsAnswerSetSha256" CHAR(64),
  ADD COLUMN "egressConnectionDnsAnswerSetSha256" CHAR(64),
  ADD COLUMN "egressSelectedAddressSha256" CHAR(64);

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_egress_route_attestation_check" CHECK (
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
  );
