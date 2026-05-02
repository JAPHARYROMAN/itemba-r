-- CreateTable
CREATE TABLE "project_cost_allocations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "allocatedGross" DECIMAL(18,2) NOT NULL,
    "allocatedEmployerStatutory" DECIMAL(18,2) NOT NULL,
    "allocatedTotalCost" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_cost_allocations_companyId_projectId_idx" ON "project_cost_allocations"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_cost_allocations_payrollRunId_idx" ON "project_cost_allocations"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "project_cost_allocations_payrollEntryId_projectId_key" ON "project_cost_allocations"("payrollEntryId", "projectId");

-- AddForeignKey
ALTER TABLE "project_cost_allocations" ADD CONSTRAINT "project_cost_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_allocations" ADD CONSTRAINT "project_cost_allocations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_allocations" ADD CONSTRAINT "project_cost_allocations_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "payroll_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_allocations" ADD CONSTRAINT "project_cost_allocations_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_allocations" ADD CONSTRAINT "project_cost_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
