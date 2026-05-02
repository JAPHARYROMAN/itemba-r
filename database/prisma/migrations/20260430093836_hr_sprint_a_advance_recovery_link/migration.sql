-- AlterTable
ALTER TABLE "payroll_entry_deductions" ADD COLUMN     "salaryAdvanceId" TEXT;

-- CreateIndex
CREATE INDEX "payroll_entry_deductions_salaryAdvanceId_idx" ON "payroll_entry_deductions"("salaryAdvanceId");

-- AddForeignKey
ALTER TABLE "payroll_entry_deductions" ADD CONSTRAINT "payroll_entry_deductions_salaryAdvanceId_fkey" FOREIGN KEY ("salaryAdvanceId") REFERENCES "salary_advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
