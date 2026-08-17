-- Saved procedures: a task a user taught Msaidizi once, reviewed before use and
-- bounded to the capabilities it declares.
--
-- The alternative is re-interpreting the user's prose on every run, which is
-- unreviewable before the fact, varies between runs, and hands the agent the
-- full breadth of the invoker's permissions for a task that needs a handful of
-- them. A saved procedure is approved once and then cannot reach past the
-- capability list it was approved with, so what it may touch is knowable in
-- advance rather than discovered afterwards.
--
-- `capabilities` is a JSON array of tool names rather than a join table: the
-- list is small, always read whole, and is a snapshot of what was approved. A
-- relational edge would imply the set tracks the manifest as it changes, which
-- is the opposite of what an approval means — a procedure approved last month
-- must not silently widen because a new endpoint appeared.
--
-- `deletedAt` follows the codebase's soft-delete convention. Nothing here is
-- hard-deleted: an archived procedure is still the explanation for whatever it
-- did while it was active.
--
-- Additive only: one enum, one new table, no changes to existing tables.

CREATE TYPE "MsaidiziProcedureStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "msaidizi_procedures" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT,
  "name"         TEXT NOT NULL,
  "instruction"  TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "highestTier"  TEXT NOT NULL DEFAULT 'green',
  "status"       "MsaidiziProcedureStatus" NOT NULL DEFAULT 'DRAFT',
  "version"      INTEGER NOT NULL DEFAULT 1,
  "createdById"  TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),

  CONSTRAINT "msaidizi_procedures_pkey" PRIMARY KEY ("id")
);

-- One live procedure per name per company, so "run the supplier close-out" is
-- never ambiguous. NULLs are distinct in Postgres, so group-level procedures
-- (companyId IS NULL) do not collide with company ones.
CREATE UNIQUE INDEX "msaidizi_procedures_companyId_name_key"
  ON "msaidizi_procedures"("companyId", "name");

CREATE INDEX "msaidizi_procedures_companyId_status_idx"
  ON "msaidizi_procedures"("companyId", "status");

ALTER TABLE "msaidizi_procedures"
  ADD CONSTRAINT "msaidizi_procedures_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_procedures_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_procedures_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
