-- AlterTable
ALTER TABLE "users" ADD COLUMN     "authKind" TEXT NOT NULL DEFAULT 'PASSWORD';

-- AlterTable
ALTER TABLE "inventory_balances" ADD COLUMN     "physicalRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "mobile_pos_terminals" ALTER COLUMN "salespersonId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "mobile_pos_branch_setups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "generalCustomerId" TEXT NOT NULL,
    "paymentMappings" JSONB NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_pos_branch_setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_pos_invites" (
    "id" TEXT NOT NULL,
    "branchSetupId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_pos_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_pos_enrollments" (
    "id" TEXT NOT NULL,
    "branchSetupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestedRole" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedRole" TEXT,
    "userId" TEXT,
    "terminalId" TEXT,
    "claimTokenHash" TEXT NOT NULL,
    "claimExpiresAt" TIMESTAMP(3) NOT NULL,
    "setupTokenHash" TEXT,
    "setupExpiresAt" TIMESTAMP(3),
    "deviceSecretHash" TEXT,
    "pinHash" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_pos_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_drafts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT NOT NULL,
    "originUserId" TEXT NOT NULL,
    "originRole" TEXT NOT NULL,
    "terminalId" TEXT,
    "requestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "businessDate" DATE NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "pendingMoney" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "duplicateSignature" TEXT,
    "blockingReason" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "postedEntityType" TEXT,
    "postedEntityId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_draft_reservations" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "pos_draft_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_draft_decisions" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "pos_draft_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_pos_branch_setups_branchId_key" ON "mobile_pos_branch_setups"("branchId");

-- CreateIndex
CREATE INDEX "mobile_pos_branch_setups_companyId_branchId_idx" ON "mobile_pos_branch_setups"("companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_pos_invites_tokenHash_key" ON "mobile_pos_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "mobile_pos_invites_branchSetupId_expiresAt_idx" ON "mobile_pos_invites"("branchSetupId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_pos_enrollments_claimTokenHash_key" ON "mobile_pos_enrollments"("claimTokenHash");

-- CreateIndex
CREATE INDEX "mobile_pos_enrollments_companyId_branchId_status_idx" ON "mobile_pos_enrollments"("companyId", "branchId", "status");

-- CreateIndex
CREATE INDEX "mobile_pos_enrollments_userId_status_idx" ON "mobile_pos_enrollments"("userId", "status");

-- CreateIndex
CREATE INDEX "pos_drafts_companyId_branchId_status_businessDate_idx" ON "pos_drafts"("companyId", "branchId", "status", "businessDate");

-- CreateIndex
CREATE INDEX "pos_drafts_originUserId_status_idx" ON "pos_drafts"("originUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_drafts_companyId_requestId_key" ON "pos_drafts"("companyId", "requestId");

-- CreateIndex
CREATE INDEX "pos_draft_reservations_companyId_branchId_productId_release_idx" ON "pos_draft_reservations"("companyId", "branchId", "productId", "releasedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_draft_reservations_draftId_productId_branchId_key" ON "pos_draft_reservations"("draftId", "productId", "branchId");

-- CreateIndex
CREATE INDEX "pos_draft_decisions_draftId_createdAt_idx" ON "pos_draft_decisions"("draftId", "createdAt");

-- AddForeignKey
ALTER TABLE "mobile_pos_invites" ADD CONSTRAINT "mobile_pos_invites_branchSetupId_fkey" FOREIGN KEY ("branchSetupId") REFERENCES "mobile_pos_branch_setups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_pos_enrollments" ADD CONSTRAINT "mobile_pos_enrollments_branchSetupId_fkey" FOREIGN KEY ("branchSetupId") REFERENCES "mobile_pos_branch_setups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_draft_reservations" ADD CONSTRAINT "pos_draft_reservations_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "pos_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_draft_decisions" ADD CONSTRAINT "pos_draft_decisions_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "pos_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
