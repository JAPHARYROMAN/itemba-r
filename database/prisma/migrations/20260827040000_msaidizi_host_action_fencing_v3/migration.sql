CREATE TYPE "MsaidiziHostActionFenceStatus" AS ENUM (
  'PENDING',
  'DISPATCHED',
  'ACKNOWLEDGED',
  'CONFLICTED'
);

CREATE TABLE "msaidizi_host_action_fences" (
  "fenceId" TEXT NOT NULL,
  "hostActionId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "status" "MsaidiziHostActionFenceStatus" NOT NULL DEFAULT 'PENDING',
  "oldLeaseId" TEXT NOT NULL,
  "oldLeaseFencingToken" BIGINT NOT NULL,
  "oldActionTokenDigest" CHAR(64) NOT NULL,
  "journalPreviousSequence" INTEGER NOT NULL,
  "journalPreviousHash" CHAR(64) NOT NULL,
  "dispatchCount" INTEGER NOT NULL DEFAULT 0,
  "maxDispatches" INTEGER NOT NULL DEFAULT 3,
  "dispatchedAt" TIMESTAMP(3),
  "receiptDigest" CHAR(64),
  "tombstoneSequence" INTEGER,
  "tombstonePreviousHash" CHAR(64),
  "tombstoneHash" CHAR(64),
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "msaidizi_host_action_fences_pkey" PRIMARY KEY ("fenceId"),
  CONSTRAINT "msaidizi_host_action_fences_dispatch_bounds_check"
    CHECK ("dispatchCount" >= 0 AND "maxDispatches" BETWEEN 1 AND 3 AND "dispatchCount" <= "maxDispatches"),
  CONSTRAINT "msaidizi_host_action_fences_predecessor_check"
    CHECK ("journalPreviousSequence" >= 0),
  CONSTRAINT "msaidizi_host_action_fences_tombstone_check"
    CHECK (
      ("status" <> 'ACKNOWLEDGED') OR
      ("receiptDigest" IS NOT NULL AND "tombstoneSequence" = "journalPreviousSequence" + 1
        AND "tombstonePreviousHash" IS NOT NULL AND "tombstoneHash" IS NOT NULL
        AND "acknowledgedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "msaidizi_host_action_fences_hostActionId_key"
  ON "msaidizi_host_action_fences"("hostActionId");
CREATE UNIQUE INDEX "msaidizi_host_action_fences_receiptDigest_key"
  ON "msaidizi_host_action_fences"("receiptDigest");
CREATE INDEX "msaidizi_host_action_fences_deviceId_status_dispatchedAt_idx"
  ON "msaidizi_host_action_fences"("deviceId", "status", "dispatchedAt");

ALTER TABLE "msaidizi_host_action_fences"
  ADD CONSTRAINT "msaidizi_host_action_fences_hostActionId_fkey"
  FOREIGN KEY ("hostActionId") REFERENCES "msaidizi_host_actions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "msaidizi_host_action_fences"
  ADD CONSTRAINT "msaidizi_host_action_fences_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "msaidizi_host_action_fence_dispatches" (
  "id" TEXT NOT NULL,
  "fenceId" TEXT NOT NULL,
  "dispatchCount" INTEGER NOT NULL,
  "fenceTokenDigest" CHAR(64) NOT NULL,
  "tokenId" TEXT NOT NULL,
  "tokenIssuedAt" TIMESTAMP(3) NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "msaidizi_host_action_fence_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_host_action_fence_dispatches_count_check"
    CHECK ("dispatchCount" BETWEEN 1 AND 3)
);

CREATE UNIQUE INDEX "msaidizi_host_action_fence_dispatches_fenceTokenDigest_key"
  ON "msaidizi_host_action_fence_dispatches"("fenceTokenDigest");
CREATE UNIQUE INDEX "msaidizi_host_action_fence_dispatches_fenceId_dispatchCount_key"
  ON "msaidizi_host_action_fence_dispatches"("fenceId", "dispatchCount");
CREATE INDEX "msaidizi_host_action_fence_dispatches_fenceId_createdAt_idx"
  ON "msaidizi_host_action_fence_dispatches"("fenceId", "createdAt");

ALTER TABLE "msaidizi_host_action_fence_dispatches"
  ADD CONSTRAINT "msaidizi_host_action_fence_dispatches_fenceId_fkey"
  FOREIGN KEY ("fenceId") REFERENCES "msaidizi_host_action_fences"("fenceId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "reject_msaidizi_host_action_fence_dispatch_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "msaidizi_host_action_fence_dispatches_append_only_guard"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "msaidizi_host_action_fence_dispatches"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_msaidizi_host_action_fence_dispatch_rewrite"();
