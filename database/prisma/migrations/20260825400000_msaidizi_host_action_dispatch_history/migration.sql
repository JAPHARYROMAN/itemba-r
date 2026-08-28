-- Preserve every broker-signed host-action delivery generation. A durable
-- terminal receipt is bound to the token that began execution; overwriting
-- that token on redelivery would make a valid replay unverifiable.
CREATE TABLE "msaidizi_host_action_dispatches" (
  "id" TEXT NOT NULL,
  "hostActionId" TEXT NOT NULL,
  "dispatchCount" INTEGER NOT NULL,
  "actionTokenDigest" TEXT NOT NULL,
  "tokenId" TEXT,
  "tokenIssuedAt" TIMESTAMP(3),
  "tokenExpiresAt" TIMESTAMP(3),
  "leaseId" TEXT NOT NULL,
  "leaseFencingToken" BIGINT NOT NULL,
  "leaseAuthorizationExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "msaidizi_host_action_dispatches_pkey" PRIMARY KEY ("id")
);

-- Existing delivered actions retain their latest known generation. Earlier
-- generations cannot be reconstructed and therefore remain intentionally
-- absent rather than being fabricated.
INSERT INTO "msaidizi_host_action_dispatches" (
  "id",
  "hostActionId",
  "dispatchCount",
  "actionTokenDigest",
  "leaseId",
  "leaseFencingToken",
  "leaseAuthorizationExpiresAt",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  action."id",
  action."dispatchCount",
  action."actionTokenDigest",
  action."leaseId",
  action."leaseFencingToken",
  action."leaseAuthorizationExpiresAt",
  COALESCE(action."dispatchedAt", action."updatedAt")
FROM "msaidizi_host_actions" AS action
WHERE action."dispatchCount" > 0
  AND action."leaseId" IS NOT NULL
  AND action."leaseFencingToken" IS NOT NULL
  AND action."leaseAuthorizationExpiresAt" IS NOT NULL;

CREATE UNIQUE INDEX "msaidizi_host_action_dispatches_actionTokenDigest_key"
  ON "msaidizi_host_action_dispatches"("actionTokenDigest");

CREATE UNIQUE INDEX "msaidizi_host_action_dispatches_tokenId_key"
  ON "msaidizi_host_action_dispatches"("tokenId");

CREATE UNIQUE INDEX "msaidizi_host_action_dispatches_hostActionId_dispatchCount_key"
  ON "msaidizi_host_action_dispatches"("hostActionId", "dispatchCount");

CREATE INDEX "msaidizi_host_action_dispatches_hostActionId_createdAt_idx"
  ON "msaidizi_host_action_dispatches"("hostActionId", "createdAt");

ALTER TABLE "msaidizi_host_action_dispatches"
  ADD CONSTRAINT "msaidizi_host_action_dispatches_hostActionId_fkey"
  FOREIGN KEY ("hostActionId") REFERENCES "msaidizi_host_actions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "reject_msaidizi_host_action_dispatch_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "msaidizi_host_action_dispatches_append_only_guard"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "msaidizi_host_action_dispatches"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_msaidizi_host_action_dispatch_rewrite"();
