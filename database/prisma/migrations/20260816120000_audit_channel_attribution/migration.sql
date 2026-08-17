-- Channel attribution on the audit trail: records not just who acted, but what
-- drove the action.
--
-- Today every audit row says "user X did this" whether X clicked a button, an
-- API key acted on X's behalf, or a scheduled job ran as X. Once an agent can
-- act under a user's own permissions, that ambiguity stops being cosmetic: a
-- manager reviewing the log cannot tell what they did from what they asked for,
-- a bad action cannot be traced back to the instruction that caused it, and an
-- agent run cannot be reversed as a unit.
--
-- This has to land before the agent does, not after. There is no backfill for a
-- channel nobody recorded — pre-existing rows take the WEB default and are
-- forever indistinguishable, which is precisely why the column is added now
-- while that history is small and entirely human.
--
-- Additive only: one new enum type, two nullable-or-defaulted columns, two
-- indexes. Nothing is dropped and no data is rewritten.
--
-- On the safety of ADD COLUMN with a default: in PG 11+ a non-volatile default
-- is stored in the catalog rather than written into every existing row, so this
-- does not rewrite audit_logs and cannot stall a shop mid-trade. The two
-- CREATE INDEX statements do take a lock that blocks writes to audit_logs for
-- their duration; audit writes are fire-and-forget rather than in a trade's
-- critical path, and the alternative (CREATE INDEX CONCURRENTLY) cannot run
-- inside prisma migrate's transaction. Run this during a quiet window if
-- audit_logs is large.

CREATE TYPE "AuditChannel" AS ENUM ('WEB', 'API', 'AGENT', 'SYSTEM');

ALTER TABLE "audit_logs"
  ADD COLUMN "channel" "AuditChannel" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "agentSessionId" TEXT;

-- "show me everything the agent did, most recent first" — the review query this
-- whole change exists to make answerable.
CREATE INDEX "audit_logs_channel_createdAt_idx"
  ON "audit_logs"("channel", "createdAt");

-- Pull one agent run's entries together for review or reversal.
CREATE INDEX "audit_logs_agentSessionId_idx"
  ON "audit_logs"("agentSessionId");
