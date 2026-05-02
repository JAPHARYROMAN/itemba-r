-- AlterTable
ALTER TABLE "payroll_entry_allowances" ADD COLUMN     "salesCommissionId" TEXT;

-- CreateIndex
CREATE INDEX "payroll_entry_allowances_salesCommissionId_idx" ON "payroll_entry_allowances"("salesCommissionId");

-- AddForeignKey
ALTER TABLE "payroll_entry_allowances" ADD CONSTRAINT "payroll_entry_allowances_salesCommissionId_fkey" FOREIGN KEY ("salesCommissionId") REFERENCES "sales_commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
