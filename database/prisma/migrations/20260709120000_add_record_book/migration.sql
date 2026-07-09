-- CreateEnum
CREATE TYPE "RecordBookStatus" AS ENUM ('DRAFT', 'FINALIZED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RecordBookReceiptType" AS ENUM ('CASH', 'MPESA', 'LIPA_NAMBA', 'BANK', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordBookPaymentMethod" AS ENUM ('CASH', 'MPESA', 'LIPA_NAMBA', 'BANK', 'CARD', 'OTHER');

-- CreateTable
CREATE TABLE "record_book_daily_sales" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "totalSalesAmount" DECIMAL(18,2) NOT NULL,
    "status" "RecordBookStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_book_daily_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_book_sale_receipts" (
    "id" TEXT NOT NULL,
    "dailySaleId" TEXT NOT NULL,
    "receiptType" "RecordBookReceiptType" NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_book_sale_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_book_expense_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_book_expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_book_expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "expenseCategoryId" TEXT NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "paidTo" TEXT,
    "paymentMethod" "RecordBookPaymentMethod" NOT NULL DEFAULT 'CASH',
    "paymentLabel" TEXT,
    "reference" TEXT,
    "status" "RecordBookStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_book_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_book_daily_sales_companyId_idx" ON "record_book_daily_sales"("companyId");
CREATE INDEX "record_book_daily_sales_divisionId_idx" ON "record_book_daily_sales"("divisionId");
CREATE INDEX "record_book_daily_sales_branchId_idx" ON "record_book_daily_sales"("branchId");
CREATE INDEX "record_book_daily_sales_recordDate_idx" ON "record_book_daily_sales"("recordDate");
CREATE INDEX "record_book_daily_sales_status_idx" ON "record_book_daily_sales"("status");
CREATE INDEX "record_book_daily_sales_companyId_recordDate_status_idx" ON "record_book_daily_sales"("companyId", "recordDate", "status");

CREATE INDEX "record_book_sale_receipts_dailySaleId_idx" ON "record_book_sale_receipts"("dailySaleId");
CREATE INDEX "record_book_sale_receipts_receiptType_idx" ON "record_book_sale_receipts"("receiptType");

CREATE UNIQUE INDEX "record_book_expense_categories_companyId_name_key" ON "record_book_expense_categories"("companyId", "name");
CREATE INDEX "record_book_expense_categories_companyId_idx" ON "record_book_expense_categories"("companyId");
CREATE INDEX "record_book_expense_categories_isActive_idx" ON "record_book_expense_categories"("isActive");

CREATE INDEX "record_book_expenses_companyId_idx" ON "record_book_expenses"("companyId");
CREATE INDEX "record_book_expenses_divisionId_idx" ON "record_book_expenses"("divisionId");
CREATE INDEX "record_book_expenses_branchId_idx" ON "record_book_expenses"("branchId");
CREATE INDEX "record_book_expenses_expenseCategoryId_idx" ON "record_book_expenses"("expenseCategoryId");
CREATE INDEX "record_book_expenses_recordDate_idx" ON "record_book_expenses"("recordDate");
CREATE INDEX "record_book_expenses_status_idx" ON "record_book_expenses"("status");
CREATE INDEX "record_book_expenses_companyId_recordDate_status_idx" ON "record_book_expenses"("companyId", "recordDate", "status");

-- AddForeignKey
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_daily_sales" ADD CONSTRAINT "record_book_daily_sales_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "record_book_sale_receipts" ADD CONSTRAINT "record_book_sale_receipts_dailySaleId_fkey" FOREIGN KEY ("dailySaleId") REFERENCES "record_book_daily_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "record_book_expense_categories" ADD CONSTRAINT "record_book_expense_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "record_book_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
