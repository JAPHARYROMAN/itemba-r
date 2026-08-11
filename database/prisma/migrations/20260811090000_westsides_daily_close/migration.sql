-- Persist the Westsides daily cash close. Additive only: the close screen
-- previously kept counted amounts, variances, and sign-off in browser state,
-- losing them on every reload.

CREATE TABLE "westsides_daily_closes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "closeDate" DATE NOT NULL,
    "countedByMethod" JSONB NOT NULL,
    "expectedTotal" DECIMAL(18,2) NOT NULL,
    "countedTotal" DECIMAL(18,2) NOT NULL,
    "varianceTotal" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "closedById" TEXT NOT NULL,
    "closedByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "westsides_daily_closes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "westsides_daily_closes_companyId_branchId_closeDate_key" ON "westsides_daily_closes"("companyId", "branchId", "closeDate");

CREATE INDEX "westsides_daily_closes_companyId_closeDate_idx" ON "westsides_daily_closes"("companyId", "closeDate");
