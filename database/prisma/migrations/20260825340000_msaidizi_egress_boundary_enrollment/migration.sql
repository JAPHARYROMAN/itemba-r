-- Raw command and browser effects remain disabled until these boundary keys
-- are independently enrolled and the external WFP/WebView2 stack is validated.
ALTER TABLE "msaidizi_devices"
  ADD COLUMN "egressBoundaryKeyId" TEXT,
  ADD COLUMN "egressBoundaryPublicKey" TEXT,
  ADD COLUMN "egressBoundaryPublicKeySha256" TEXT,
  ADD COLUMN "egressDestinationPolicySha256" TEXT,
  ADD COLUMN "egressExecutionIdentitySha256" TEXT;

ALTER TABLE "msaidizi_devices"
  ADD CONSTRAINT "msaidizi_devices_egress_boundary_enrollment_complete_check"
  CHECK (
    ("egressBoundaryKeyId" IS NULL
      AND "egressBoundaryPublicKey" IS NULL
      AND "egressBoundaryPublicKeySha256" IS NULL
      AND "egressDestinationPolicySha256" IS NULL
      AND "egressExecutionIdentitySha256" IS NULL)
    OR
    ("egressBoundaryKeyId" IS NOT NULL
      AND "egressBoundaryPublicKey" IS NOT NULL
      AND "egressBoundaryPublicKeySha256" IS NOT NULL
      AND "egressDestinationPolicySha256" IS NOT NULL
      AND "egressExecutionIdentitySha256" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_devices_egress_boundary_key_id_check"
  CHECK (
    "egressBoundaryKeyId" IS NULL
    OR "egressBoundaryKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  ADD CONSTRAINT "msaidizi_devices_egress_boundary_public_key_check"
  CHECK (
    "egressBoundaryPublicKey" IS NULL
    OR (length("egressBoundaryPublicKey") BETWEEN 1 AND 8192
      AND position('00' IN encode(convert_to("egressBoundaryPublicKey", 'UTF8'), 'hex')) = 0)
  ),
  ADD CONSTRAINT "msaidizi_devices_egress_boundary_digests_check"
  CHECK (
    ("egressBoundaryPublicKeySha256" IS NULL
      OR "egressBoundaryPublicKeySha256" ~ '^[0-9a-f]{64}$')
    AND ("egressDestinationPolicySha256" IS NULL
      OR "egressDestinationPolicySha256" ~ '^[0-9a-f]{64}$')
    AND ("egressExecutionIdentitySha256" IS NULL
      OR "egressExecutionIdentitySha256" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "egressEvidenceSha256" TEXT,
  ADD COLUMN "egressReceiptId" UUID,
  ADD COLUMN "egressAuthorizationLeaseId" UUID,
  ADD COLUMN "egressBoundaryBootId" UUID,
  ADD COLUMN "egressReceiptSequence" INTEGER;

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_egress_evidence_complete_check"
  CHECK (
    ("egressEvidenceSha256" IS NULL
      AND "egressReceiptId" IS NULL
      AND "egressAuthorizationLeaseId" IS NULL
      AND "egressBoundaryBootId" IS NULL
      AND "egressReceiptSequence" IS NULL)
    OR
    ("egressEvidenceSha256" IS NOT NULL
      AND "egressReceiptId" IS NOT NULL
      AND "egressAuthorizationLeaseId" IS NOT NULL
      AND "egressBoundaryBootId" IS NOT NULL
      AND "egressReceiptSequence" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_host_actions_egress_evidence_digest_check"
  CHECK (
    "egressEvidenceSha256" IS NULL
    OR "egressEvidenceSha256" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "msaidizi_host_actions_egress_receipt_sequence_check"
  CHECK ("egressReceiptSequence" IS NULL OR "egressReceiptSequence" >= 1);

CREATE UNIQUE INDEX "msaidizi_host_actions_egressReceiptId_key"
  ON "msaidizi_host_actions"("egressReceiptId");

CREATE UNIQUE INDEX "msaidizi_host_actions_egressAuthorizationLeaseId_key"
  ON "msaidizi_host_actions"("egressAuthorizationLeaseId");

CREATE UNIQUE INDEX "msaidizi_host_actions_deviceId_egressBoundaryBootId_egressReceiptSequence_key"
  ON "msaidizi_host_actions"("deviceId", "egressBoundaryBootId", "egressReceiptSequence");
