-- A RUNNING job is owned by one worker process and must renew its durable
-- heartbeat. Recovery compares all three values (status, owner, heartbeat), so
-- it cannot reclaim a live lease or overwrite cancellation/another worker.
ALTER TABLE "background_jobs"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "background_jobs_status_leaseHeartbeatAt_idx"
  ON "background_jobs"("status", "leaseHeartbeatAt");
