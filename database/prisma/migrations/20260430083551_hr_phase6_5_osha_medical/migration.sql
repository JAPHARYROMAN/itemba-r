-- CreateEnum
CREATE TYPE "OshaRegistrationType" AS ENUM ('GENERAL', 'HAZARDOUS_PROCESS', 'CHEMICAL_PLANT', 'PETROLEUM_FACILITY', 'CONSTRUCTION_SITE', 'WAREHOUSE', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "OshaRegistrationStatus" AS ENUM ('ACTIVE', 'PENDING_RENEWAL', 'EXPIRED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OshaRiskClassification" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MedicalExamType" AS ENUM ('PRE_EMPLOYMENT', 'ANNUAL', 'POST_INCIDENT', 'RETURN_TO_WORK', 'FITNESS_FOR_DUTY', 'HAZARD_SECTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicalFitnessStatus" AS ENUM ('FIT', 'FIT_WITH_RESTRICTIONS', 'TEMPORARILY_UNFIT', 'UNFIT');

-- CreateTable
CREATE TABLE "osha_registrations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "registrationType" "OshaRegistrationType" NOT NULL DEFAULT 'GENERAL',
    "issuedAt" DATE,
    "expiresAt" DATE NOT NULL,
    "inspectorName" TEXT,
    "inspectorContact" TEXT,
    "riskClassification" "OshaRiskClassification",
    "status" "OshaRegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "osha_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_exam_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "examType" "MedicalExamType" NOT NULL DEFAULT 'ANNUAL',
    "examDate" DATE NOT NULL,
    "expiresAt" DATE NOT NULL,
    "fitnessStatus" "MedicalFitnessStatus" NOT NULL DEFAULT 'FIT',
    "doctorName" TEXT,
    "facilityName" TEXT,
    "hazardSector" BOOLEAN NOT NULL DEFAULT false,
    "restrictions" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "medical_exam_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "osha_registrations_branchId_idx" ON "osha_registrations"("branchId");

-- CreateIndex
CREATE INDEX "osha_registrations_expiresAt_idx" ON "osha_registrations"("expiresAt");

-- CreateIndex
CREATE INDEX "osha_registrations_status_idx" ON "osha_registrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "osha_registrations_companyId_certificateNumber_key" ON "osha_registrations"("companyId", "certificateNumber");

-- CreateIndex
CREATE INDEX "medical_exam_records_employeeId_expiresAt_idx" ON "medical_exam_records"("employeeId", "expiresAt");

-- CreateIndex
CREATE INDEX "medical_exam_records_companyId_expiresAt_idx" ON "medical_exam_records"("companyId", "expiresAt");

-- AddForeignKey
ALTER TABLE "osha_registrations" ADD CONSTRAINT "osha_registrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "osha_registrations" ADD CONSTRAINT "osha_registrations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_exam_records" ADD CONSTRAINT "medical_exam_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_exam_records" ADD CONSTRAINT "medical_exam_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
