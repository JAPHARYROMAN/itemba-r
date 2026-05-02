-- CreateEnum
CREATE TYPE "SalesCommissionBasis" AS ENUM ('GROSS', 'NET', 'FLAT');

-- CreateEnum
CREATE TYPE "SalesCommissionStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "salespersonId" TEXT;

-- CreateTable
CREATE TABLE "sales_commissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "basis" "SalesCommissionBasis" NOT NULL DEFAULT 'GROSS',
    "rate" DECIMAL(8,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "SalesCommissionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidPayrollEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_commissions_companyId_status_idx" ON "sales_commissions"("companyId", "status");

-- CreateIndex
CREATE INDEX "sales_commissions_employeeId_status_idx" ON "sales_commissions"("employeeId", "status");

-- CreateIndex
CREATE INDEX "sales_commissions_paidPayrollEntryId_idx" ON "sales_commissions"("paidPayrollEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_commissions_salesOrderId_employeeId_key" ON "sales_commissions"("salesOrderId", "employeeId");

-- CreateIndex
CREATE INDEX "sales_orders_salespersonId_idx" ON "sales_orders"("salespersonId");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_commissions" ADD CONSTRAINT "sales_commissions_paidPayrollEntryId_fkey" FOREIGN KEY ("paidPayrollEntryId") REFERENCES "payroll_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
