-- AlterTable
ALTER TABLE "disciplinary_actions" ADD COLUMN     "fineAmount" DECIMAL(18,2),
ADD COLUMN     "fineDeductionId" TEXT;

-- AlterTable
ALTER TABLE "performance_records" ADD COLUMN     "bonusAllowanceId" TEXT,
ADD COLUMN     "bonusAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "pos_transactions" ADD COLUMN     "cashierEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "sales_commissions" ADD COLUMN     "posTransactionId" TEXT,
ALTER COLUMN "salesOrderId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "pos_transactions_cashierEmployeeId_idx" ON "pos_transactions"("cashierEmployeeId");

-- CreateIndex
CREATE INDEX "sales_commissions_posTransactionId_employeeId_idx" ON "sales_commissions"("posTransactionId", "employeeId");

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_posTransactionId_fkey" FOREIGN KEY ("posTransactionId") REFERENCES "pos_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_cashierEmployeeId_fkey" FOREIGN KEY ("cashierEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
