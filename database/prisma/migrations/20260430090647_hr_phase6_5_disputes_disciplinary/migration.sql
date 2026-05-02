-- CreateEnum
CREATE TYPE "EmploymentDisputeType" AS ENUM ('GRIEVANCE', 'WAGE_DISPUTE', 'WORKING_CONDITIONS', 'HARASSMENT', 'DISCRIMINATION', 'UNFAIR_TERMINATION', 'CONSTRUCTIVE_DISMISSAL', 'CONTRACT_BREACH', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentDisputeStatus" AS ENUM ('RAISED', 'INTERNAL_MEDIATION', 'CMA_REFERRED', 'CMA_HEARING', 'RESOLVED', 'DISMISSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EmploymentDisputeResolution" AS ENUM ('SETTLED_INTERNALLY', 'CMA_AWARD_FOR_EMPLOYEE', 'CMA_AWARD_FOR_EMPLOYER', 'WITHDRAWN_BY_EMPLOYEE', 'ABANDONED', 'OTHER');

-- CreateEnum
CREATE TYPE "DisciplinaryActionType" AS ENUM ('VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION_WITH_PAY', 'SUSPENSION_WITHOUT_PAY', 'DEMOTION', 'TERMINATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DisciplinaryActionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'OVERTURNED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "employment_disputes" (
    "id" TEXT NOT NULL,
    "disputeNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "type" "EmploymentDisputeType" NOT NULL,
    "status" "EmploymentDisputeStatus" NOT NULL DEFAULT 'RAISED',
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "initialPosition" TEXT,
    "mediatedById" TEXT,
    "mediatedAt" TIMESTAMP(3),
    "mediationOutcome" TEXT,
    "cmaReferenceNumber" TEXT,
    "cmaReferredById" TEXT,
    "cmaReferredAt" TIMESTAMP(3),
    "cmaArbitrator" TEXT,
    "cmaHearingDate" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionType" "EmploymentDisputeResolution",
    "resolutionAmount" DECIMAL(18,2),
    "resolutionCurrency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "resolutionNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employment_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disciplinary_actions" (
    "id" TEXT NOT NULL,
    "actionNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "disputeId" TEXT,
    "type" "DisciplinaryActionType" NOT NULL,
    "status" "DisciplinaryActionStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "employeeResponse" TEXT,
    "issuedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "disciplinary_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employment_disputes_employeeId_idx" ON "employment_disputes"("employeeId");

-- CreateIndex
CREATE INDEX "employment_disputes_companyId_status_idx" ON "employment_disputes"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employment_disputes_companyId_disputeNumber_key" ON "employment_disputes"("companyId", "disputeNumber");

-- CreateIndex
CREATE INDEX "disciplinary_actions_employeeId_idx" ON "disciplinary_actions"("employeeId");

-- CreateIndex
CREATE INDEX "disciplinary_actions_companyId_status_idx" ON "disciplinary_actions"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "disciplinary_actions_companyId_actionNumber_key" ON "disciplinary_actions"("companyId", "actionNumber");

-- AddForeignKey
ALTER TABLE "employment_disputes" ADD CONSTRAINT "employment_disputes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_disputes" ADD CONSTRAINT "employment_disputes_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_disputes" ADD CONSTRAINT "employment_disputes_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_disputes" ADD CONSTRAINT "employment_disputes_mediatedById_fkey" FOREIGN KEY ("mediatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_disputes" ADD CONSTRAINT "employment_disputes_cmaReferredById_fkey" FOREIGN KEY ("cmaReferredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_disputes" ADD CONSTRAINT "employment_disputes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "employment_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
