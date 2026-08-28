-- Persist the exact lease generation signed into each host-action dispatch.
-- The lease row's expiry is renewable; this immutable-per-dispatch snapshot is
-- required to authenticate progress/result receipts against the issued token.
ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "leaseFencingToken" BIGINT,
  ADD COLUMN "leaseAuthorizationExpiresAt" TIMESTAMP(3);

UPDATE "msaidizi_host_actions" AS action
SET
  "leaseFencingToken" = lease."fencingToken",
  "leaseAuthorizationExpiresAt" = lease."expiresAt"
FROM "msaidizi_device_leases" AS lease
WHERE action."leaseId" = lease."id";

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_lease_fence_complete_check"
  CHECK (
    ("leaseId" IS NULL AND "leaseFencingToken" IS NULL AND "leaseAuthorizationExpiresAt" IS NULL)
    OR
    ("leaseId" IS NOT NULL AND "leaseFencingToken" IS NOT NULL AND "leaseAuthorizationExpiresAt" IS NOT NULL)
  );

CREATE INDEX "msaidizi_host_actions_leaseId_leaseFencingToken_idx"
  ON "msaidizi_host_actions"("leaseId", "leaseFencingToken");
