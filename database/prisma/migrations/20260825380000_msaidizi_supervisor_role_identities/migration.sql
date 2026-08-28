CREATE TYPE "MsaidiziSupervisorRole" AS ENUM ('UPDATE', 'RECOVERY');

ALTER TABLE "msaidizi_devices"
  ADD COLUMN "updateSupervisorCertificateSha256" CHAR(64),
  ADD COLUMN "updateSupervisorPublicKeySpkiSha256" CHAR(64),
  ADD COLUMN "recoverySupervisorCertificateSha256" CHAR(64),
  ADD COLUMN "recoverySupervisorPublicKeySpkiSha256" CHAR(64);

ALTER TABLE "msaidizi_devices"
  ADD CONSTRAINT "msaidizi_devices_update_supervisor_identity_complete_check"
  CHECK (
    ("updateSupervisorCertificateSha256" IS NULL
      AND "updateSupervisorPublicKeySpkiSha256" IS NULL)
    OR
    ("updateSupervisorCertificateSha256" IS NOT NULL
      AND "updateSupervisorPublicKeySpkiSha256" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_devices_recovery_supervisor_identity_complete_check"
  CHECK (
    ("recoverySupervisorCertificateSha256" IS NULL
      AND "recoverySupervisorPublicKeySpkiSha256" IS NULL)
    OR
    ("recoverySupervisorCertificateSha256" IS NOT NULL
      AND "recoverySupervisorPublicKeySpkiSha256" IS NOT NULL)
  ),
  ADD CONSTRAINT "msaidizi_devices_supervisor_identity_digest_check"
  CHECK (
    ("updateSupervisorCertificateSha256" IS NULL
      OR "updateSupervisorCertificateSha256" ~ '^[0-9A-F]{64}$')
    AND ("updateSupervisorPublicKeySpkiSha256" IS NULL
      OR "updateSupervisorPublicKeySpkiSha256" ~ '^[0-9A-F]{64}$')
    AND ("recoverySupervisorCertificateSha256" IS NULL
      OR "recoverySupervisorCertificateSha256" ~ '^[0-9A-F]{64}$')
    AND ("recoverySupervisorPublicKeySpkiSha256" IS NULL
      OR "recoverySupervisorPublicKeySpkiSha256" ~ '^[0-9A-F]{64}$')
  ),
  ADD CONSTRAINT "msaidizi_devices_supervisor_roles_distinct_check"
  CHECK (
    ("updateSupervisorCertificateSha256" IS NULL
      OR "updateSupervisorCertificateSha256" <> "updateSupervisorPublicKeySpkiSha256")
    AND ("recoverySupervisorCertificateSha256" IS NULL
      OR "recoverySupervisorCertificateSha256" <> "recoverySupervisorPublicKeySpkiSha256")
    AND ("updateSupervisorCertificateSha256" IS NULL
      OR "recoverySupervisorCertificateSha256" IS NULL
      OR (
        "updateSupervisorCertificateSha256" <> "recoverySupervisorCertificateSha256"
        AND "updateSupervisorCertificateSha256" <> "recoverySupervisorPublicKeySpkiSha256"
        AND "updateSupervisorPublicKeySpkiSha256" <> "recoverySupervisorCertificateSha256"
        AND "updateSupervisorPublicKeySpkiSha256" <> "recoverySupervisorPublicKeySpkiSha256"
      ))
  ),
  ADD CONSTRAINT "msaidizi_devices_update_supervisor_not_device_certificate_check"
  CHECK (
    "updateSupervisorCertificateSha256" IS NULL
    OR "certificateThumbprint" IS NULL
    OR "updateSupervisorCertificateSha256" <> "certificateThumbprint"
  ),
  ADD CONSTRAINT "msaidizi_devices_recovery_supervisor_not_device_certificate_check"
  CHECK (
    "recoverySupervisorCertificateSha256" IS NULL
    OR "certificateThumbprint" IS NULL
    OR "recoverySupervisorCertificateSha256" <> "certificateThumbprint"
  ),
  ADD CONSTRAINT "msaidizi_devices_update_supervisor_not_egress_spki_check"
  CHECK (
    "updateSupervisorPublicKeySpkiSha256" IS NULL
    OR "egressBoundaryPublicKeySha256" IS NULL
    OR "updateSupervisorPublicKeySpkiSha256" <> upper("egressBoundaryPublicKeySha256")
  ),
  ADD CONSTRAINT "msaidizi_devices_recovery_supervisor_not_egress_spki_check"
  CHECK (
    "recoverySupervisorPublicKeySpkiSha256" IS NULL
    OR "egressBoundaryPublicKeySha256" IS NULL
    OR "recoverySupervisorPublicKeySpkiSha256" <> upper("egressBoundaryPublicKeySha256")
  );

CREATE UNIQUE INDEX "msaidizi_devices_updateSupervisorCertificateSha256_key"
  ON "msaidizi_devices"("updateSupervisorCertificateSha256");
CREATE UNIQUE INDEX "msaidizi_devices_updateSupervisorPublicKeySpkiSha256_key"
  ON "msaidizi_devices"("updateSupervisorPublicKeySpkiSha256");
CREATE UNIQUE INDEX "msaidizi_devices_recoverySupervisorCertificateSha256_key"
  ON "msaidizi_devices"("recoverySupervisorCertificateSha256");
CREATE UNIQUE INDEX "msaidizi_devices_recoverySupervisorPublicKeySpkiSha256_key"
  ON "msaidizi_devices"("recoverySupervisorPublicKeySpkiSha256");

CREATE TABLE "msaidizi_supervisor_enrollment_challenges" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "role" "MsaidiziSupervisorRole" NOT NULL,
  "challengeDigest" CHAR(64) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "msaidizi_supervisor_enrollment_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_supervisor_enrollment_challenges_digest_check"
    CHECK ("challengeDigest" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "msaidizi_supervisor_enrollment_challenges_challengeDigest_key"
  ON "msaidizi_supervisor_enrollment_challenges"("challengeDigest");
CREATE INDEX "msaidizi_supervisor_enrollment_challenges_deviceId_role_consumedAt_expiresAt_idx"
  ON "msaidizi_supervisor_enrollment_challenges"("deviceId", "role", "consumedAt", "expiresAt");
CREATE INDEX "msaidizi_supervisor_enrollment_challenges_createdByUserId_createdAt_idx"
  ON "msaidizi_supervisor_enrollment_challenges"("createdByUserId", "createdAt");

ALTER TABLE "msaidizi_supervisor_enrollment_challenges"
  ADD CONSTRAINT "msaidizi_supervisor_enrollment_challenges_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "msaidizi_supervisor_enrollment_challenges"
  ADD CONSTRAINT "msaidizi_supervisor_enrollment_challenges_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
