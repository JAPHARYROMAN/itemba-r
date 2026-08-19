-- The approval ledger for Msaidizi's red tier: one row per PROPOSED
-- irreversible action, spent by the dispatch that runs it.
--
-- WHAT THIS REPLACES, AND WHY A TABLE WAS THE ONLY WAY TO REPLACE IT.
--
-- Until now an approval was `confirmationIdFor(sessionId, toolName, args)` — a
-- value DERIVED from three things the caller supplies on the very request that
-- claims them approved. Two limits followed, and both are closed here:
--
--   (a) the spend was an in-memory Set inside one run(), so it died at the
--       request boundary. Re-sending the same id on a LATER request bought
--       another execution of the same irreversible action, bounded only by the
--       per-run write ceiling.
--   (b) an approval was not bound to a proposal ever having been made. It was a
--       pre-authorisation channel, not a receipt: nothing on the server had
--       issued the id, so nothing could recognise it.
--
-- The obvious repair — remember derived ids as permanently spent — is wrong, and
-- that is the reason this is a ledger of nonces rather than a deny list. The
-- derived id is deterministic, so the same weekly payroll journal posted again
-- next week produces the same id; a permanent spend would make a legitimately
-- repeated identical action permanently unapprovable, because re-approving it
-- can only ever produce the same id again. A grant is a fresh nonce per
-- proposal, so the repeat gets a new one and is approvable exactly as the first
-- was.
--
-- THE MODEL: the server ISSUES when it proposes, and SPENDS when it dispatches.
-- The client returns grant ids — server-issued nonces — never anything it
-- computed itself.
--
-- THE SPEND IS ONE CONDITIONAL UPDATE, and that is the load-bearing sentence in
-- this file. It is
--
--   UPDATE ... SET "usedAt" = now()
--    WHERE "id" = $1 AND "conversationId" = $2 AND "userId" = $3
--      AND "toolName" = $4 AND "argsDigest" = $5
--      AND "usedAt" IS NULL AND "expiresAt" > now()
--
-- and the row count it reports is the answer. Never a read followed by a write:
-- two concurrent requests naming one grant would both read `usedAt IS NULL` and
-- both dispatch. This codebase has already paid for that shape once — a create
-- race that could not be decided by reading first, because Postgres stamps
-- createdAt at transaction START — and the discipline here is the same one
-- msaidizi_conversations uses for its turn sequence and its highestTier raise.
--
-- FAIL CLOSED, DELIBERATELY UNLIKE ITS NEIGHBOURS. Everywhere else in this
-- module a storage failure must never fail a run, because by the time anything
-- is written the model turn and the tool calls have already happened. This table
-- is the opposite and the contradiction is intentional: an unspendable grant is
-- an UNPROVEN APPROVAL, so a store that cannot be reached to spend one means the
-- red action does not dispatch — it is proposed again. A future reader who
-- "fixes" this to swallow like the rest would turn an outage into a free pass on
-- exactly the actions that move money.
--
-- NO deletedAt COLUMN, and that is a decision rather than an omission. Every
-- other Msaidizi table has one. Here it would be wrong twice: an approval past
-- its clock must be destroyed rather than stamped, and PrismaService's
-- soft-delete middleware keys off the presence of that very column — adding it
-- would silently rewrite this table's DELETEs into UPDATEs and leave every spent
-- grant spendable-looking for ever.
--
-- EXPIRY IS ENFORCED IN THE SPEND, NOT BY THE SWEEP. The sweep below reclaims
-- space on the feature's own traffic (there is still no scheduler in this
-- codebase); the `expiresAt > now()` in the spend is what makes an expired grant
-- unusable. A sweep that never runs therefore cannot resurrect an approval.
--
-- SAFETY. Additive only: one new table. The only DDL touching existing tables is
-- ADD CONSTRAINT ... FOREIGN KEY. There is no live approval flow to break —
-- production runs MSAIDIZI_WRITE_MODE=read-only, so red-tier tools never enter
-- the registry and no confirmation has ever fired in production.

CREATE TABLE "msaidizi_approval_grants" (
  -- The grant id, and the only thing a client ever sends back as an approval. A
  -- fresh 128-bit random nonce minted per proposal, never derived from the
  -- session, the tool or the arguments — so it can only have come from a
  -- confirmation_required event this server emitted.
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  -- Copied from the conversation at issue, so the spend can name BOTH
  -- boundaries — this conversation and this user — inside the one conditional
  -- UPDATE, without a join. A grant issued in one conversation is unspendable in
  -- another, and unspendable by anyone but its author.
  "userId"         TEXT NOT NULL,
  -- The turn the proposal was made on, read off the conversation's own
  -- turnCount. Audit context, and deliberately NOT part of the spend predicate:
  -- an approval that arrives a turn later is still an answer to that proposal.
  "turnSequence"   INTEGER NOT NULL,
  "toolName"       TEXT NOT NULL,
  -- A digest of the exact arguments proposed, from the same canonical encoding
  -- and SHA-256 confirmationIdFor() uses. The spend requires equality with the
  -- digest of the action about to run, so a grant for "delete invoice 41" cannot
  -- dispatch "delete invoice 42" — including when both are approved together in
  -- one batch, where the two are told apart by nothing else.
  "argsDigest"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  -- NULL until spent. The conditional UPDATE on this column is the whole race.
  "usedAt"         TIMESTAMP(3),

  CONSTRAINT "msaidizi_approval_grants_pkey" PRIMARY KEY ("id")
);

-- The spend's own lookup is by primary key, so the index that matters here is
-- the one the sweep and the per-conversation reads use.
CREATE INDEX "msaidizi_approval_grants_conversationId_usedAt_idx"
  ON "msaidizi_approval_grants"("conversationId", "usedAt");

-- The sweep window, indexed for the same reason the conversation sweeps are: a
-- sweep that has to scan the table is a sweep somebody eventually switches off.
CREATE INDEX "msaidizi_approval_grants_expiresAt_idx"
  ON "msaidizi_approval_grants"("expiresAt");

ALTER TABLE "msaidizi_approval_grants"
  -- Cascade on the conversation: a grant is meaningless without the proposal
  -- that produced it, and deleting a conversation must never leave a spendable
  -- approval behind pointing at nothing.
  ADD CONSTRAINT "msaidizi_approval_grants_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "msaidizi_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_approval_grants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
