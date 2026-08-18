-- Conversation persistence for Msaidizi: a chat is a place you return to, and
-- that requires server-side history rather than localStorage on a shared office
-- machine's disk.
--
-- TWO PAYLOADS, TWO LIFETIMES, AND THAT SPLIT IS THE WHOLE DESIGN.
--
-- A run returns two arrays and they are not two views of one thing. The event
-- stream is built for the human: its tool_result variant carries { tool, ok,
-- status, error } and NO body. The model message array is built for the API and
-- carries the fenced tool_result payload verbatim -- real customer records,
-- supplier balances, invoice lines. Displaying a past conversation needs only
-- the first; RESUMING one needs the second unchanged, because the API requires
-- every tool_use block paired with its tool_result echoed back. Reconstructing
-- the second from the first is impossible (no block ids, no bodies), and
-- synthesising it with placeholders would make the model answer follow-ups from
-- invented data while sounding exactly as confident as before.
--
-- So both are stored, at different fidelities, on different clocks:
--   msaidizi_conversation_turns."events" -- the transcript, kept for the
--     retention window (default 90 days, sliding on the last turn).
--   msaidizi_conversations."resumeState" -- the resume state, destroyed within
--     a day (default 24 hours). A conversation past that window is readable and
--     not continuable, which is what a chat app does when a session ages out.
--
-- WHY TEXT AND NOT JSONB. Both columns hold AES-256-GCM ciphertext from
-- EncryptionService, not JSON. Four properties follow: a DBA browsing this table
-- sees ciphertext rather than supplier balances; nobody can accidentally write a
-- jsonb path query into customers' records; "byte-for-byte" is literally true
-- because GCM round-trips the exact string; and the auth tag means a tampered
-- transcript fails closed -- someone editing a stored conversation to inject an
-- instruction gets a decryption error, not a poisoned resume.
--
-- WHAT IS DELIBERATELY PLAINTEXT. "prompt" and the derived "title" are the
-- user's own words and contain nothing the system retrieved, so history stays
-- searchable. That is also why the metadata-only oversight projection excludes
-- "title": it is derived from the first prompt and will name a customer.
--
-- RETENTION IS SWEPT, NOT MERELY STAMPED. There is no scheduler in this
-- codebase -- @nestjs/schedule is not a dependency and @Cron appears nowhere --
-- and cache_entries already has an expiresAt that nothing sweeps. An "expired"
-- row still holding customer records is a deletion that did not delete. The
-- sweep therefore rides the feature's own traffic, opportunistically and
-- bounded, exactly as expired refresh tokens are pruned on token issue. Note
-- for anyone maintaining it: the Prisma soft-delete middleware rewrites delete
-- and deleteMany into updates for any model carrying deletedAt, so the sweep
-- MUST be raw SQL or it will silently stamp instead of destroying.
--
-- CASCADE ON THE AUTHOR, deliberately unlike audit_logs' SET NULL. A
-- conversation is private to its author; when the author is gone nobody may read
-- it. What the agent actually DID survives independently in audit_logs, joined
-- only by agentSessionId -- so deleting a conversation never deletes evidence.
--
-- Additive only: two new tables, no changes to existing tables. The only DDL
-- touching users and companies is ADD CONSTRAINT ... FOREIGN KEY.

CREATE TABLE "msaidizi_conversations" (
  "id"              TEXT NOT NULL,
  -- Mirrors audit_logs."agentSessionId", so a conversation is the durable index
  -- into the audit trail for whatever the run changed. Server-owned: red-tier
  -- confirmation ids are derived from it, and a client-supplied value would let
  -- an approval be minted against a session the user never saw.
  "agentSessionId"  TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "companyId"       TEXT,
  "title"           TEXT,
  "turnCount"       INTEGER NOT NULL DEFAULT 0,
  "toolCallCount"   INTEGER NOT NULL DEFAULT 0,
  "writeCallCount"  INTEGER NOT NULL DEFAULT 0,
  -- Denormalised so oversight can rank conversations by blast radius without
  -- decrypting anything.
  "highestTier"     TEXT NOT NULL DEFAULT 'green',
  -- AES-256-GCM ciphertext of the model message array. The only column in this
  -- schema holding records the system retrieved on the user's behalf.
  "resumeState"     TEXT,
  "resumeBytes"     INTEGER NOT NULL DEFAULT 0,
  "resumeExpiresAt" TIMESTAMP(3),
  -- False when the run's messages exceeded the configured cap. Truncating the
  -- array would break tool_use/tool_result pairing and produce a request the API
  -- rejects, surfacing as a generic failure indistinguishable from an outage --
  -- so nothing is stored and the UI says so.
  "resumable"       BOOLEAN NOT NULL DEFAULT true,
  "lastTurnAt"      TIMESTAMP(3),
  -- Sliding: recomputed as lastTurnAt + retention window on every turn.
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),

  CONSTRAINT "msaidizi_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_conversation_turns" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sequence"       INTEGER NOT NULL,
  -- The user's own words, plaintext. Free of retrieved data by construction.
  "prompt"         TEXT NOT NULL,
  -- AES-256-GCM ciphertext of the event array, with tool arguments passed
  -- through the audit trail's redactSensitiveFields first: a red-tier
  -- POST /users would otherwise put a plaintext password in the transcript.
  "events"         TEXT NOT NULL,
  -- A DoneReason, or 'running' for a row opened before the loop and never
  -- closed -- a crashed run or a dropped stream. TEXT rather than an enum so
  -- DoneReason can grow without a migration, following msaidizi_procedures.
  "reason"         TEXT NOT NULL,
  "toolCallCount"  INTEGER NOT NULL DEFAULT 0,
  "writeCallCount" INTEGER NOT NULL DEFAULT 0,
  "procedureId"    TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"        TIMESTAMP(3),

  CONSTRAINT "msaidizi_conversation_turns_pkey" PRIMARY KEY ("id")
);

-- One conversation per agent session, so the join to audit_logs."agentSessionId"
-- is unambiguous in both directions.
CREATE UNIQUE INDEX "msaidizi_conversations_agentSessionId_key"
  ON "msaidizi_conversations"("agentSessionId");

-- The list query: mine, live, newest first.
CREATE INDEX "msaidizi_conversations_userId_deletedAt_lastTurnAt_idx"
  ON "msaidizi_conversations"("userId", "deletedAt", "lastTurnAt");

CREATE INDEX "msaidizi_conversations_companyId_createdAt_idx"
  ON "msaidizi_conversations"("companyId", "createdAt");

-- The two sweeps. Both windows are indexed because a sweep that has to scan the
-- table is a sweep somebody eventually switches off.
CREATE INDEX "msaidizi_conversations_expiresAt_idx"
  ON "msaidizi_conversations"("expiresAt");

CREATE INDEX "msaidizi_conversations_resumeExpiresAt_idx"
  ON "msaidizi_conversations"("resumeExpiresAt");

-- Turn ordering is a database guarantee, not a read-then-write check. Two tabs
-- posting at once both take the row lock on the conversation, so the atomic
-- turnCount increment hands each a distinct sequence; this index is the backstop
-- that makes a lost race an error rather than a silently overwritten turn.
CREATE UNIQUE INDEX "msaidizi_conversation_turns_conversationId_sequence_key"
  ON "msaidizi_conversation_turns"("conversationId", "sequence");

CREATE INDEX "msaidizi_conversation_turns_conversationId_sequence_idx"
  ON "msaidizi_conversation_turns"("conversationId", "sequence");

ALTER TABLE "msaidizi_conversations"
  ADD CONSTRAINT "msaidizi_conversations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_conversations_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "msaidizi_conversation_turns"
  ADD CONSTRAINT "msaidizi_conversation_turns_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "msaidizi_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
