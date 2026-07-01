-- CreateEnum
CREATE TYPE "CustomerPaymentStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN "documentDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN "lastReminderAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "PaymentMethodGeneral" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "appliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "cashAccountId" TEXT,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "customerPaymentId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_payments_companyId_idx" ON "customer_payments"("companyId");

-- CreateIndex
CREATE INDEX "customer_payments_divisionId_idx" ON "customer_payments"("divisionId");

-- CreateIndex
CREATE INDEX "customer_payments_branchId_idx" ON "customer_payments"("branchId");

-- CreateIndex
CREATE INDEX "customer_payments_customerId_idx" ON "customer_payments"("customerId");

-- CreateIndex
CREATE INDEX "customer_payments_cashAccountId_idx" ON "customer_payments"("cashAccountId");

-- CreateIndex
CREATE INDEX "customer_payments_status_idx" ON "customer_payments"("status");

-- CreateIndex
CREATE INDEX "customer_payments_paymentDate_idx" ON "customer_payments"("paymentDate");

-- CreateIndex
CREATE INDEX "customer_payments_companyId_customerId_paymentDate_idx" ON "customer_payments"("companyId", "customerId", "paymentDate");

-- CreateIndex
CREATE INDEX "customer_payments_companyId_status_paymentDate_idx" ON "customer_payments"("companyId", "status", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_companyId_paymentNumber_key" ON "customer_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "payment_allocations_customerPaymentId_idx" ON "payment_allocations"("customerPaymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_receivableId_idx" ON "payment_allocations"("receivableId");

-- CreateIndex
CREATE INDEX "payment_allocations_companyId_idx" ON "payment_allocations"("companyId");

-- CreateIndex
CREATE INDEX "payment_allocations_companyId_receivableId_idx" ON "payment_allocations"("companyId", "receivableId");

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_customerPaymentId_fkey" FOREIGN KEY ("customerPaymentId") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
