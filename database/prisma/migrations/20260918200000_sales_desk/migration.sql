-- AlterTable
ALTER TABLE "cash_desk_movements" ADD COLUMN     "salesPaymentId" TEXT;

-- CreateTable
CREATE TABLE "sales_desk_customers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "nameKey" TEXT NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_desk_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_desk_sales" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleNumber" VARCHAR(100) NOT NULL,
    "numberKey" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "saleDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "voidedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_desk_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_desk_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" VARCHAR(250) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_desk_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_desk_payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadKey" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" VARCHAR(500),

    CONSTRAINT "sales_desk_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_desk_events" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_desk_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_desk_customers_companyId_nameKey_key" ON "sales_desk_customers"("companyId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "sales_desk_sales_requestId_key" ON "sales_desk_sales"("requestId");

-- CreateIndex
CREATE INDEX "sales_desk_sales_companyId_divisionId_branchId_saleDate_idx" ON "sales_desk_sales"("companyId", "divisionId", "branchId", "saleDate");

-- CreateIndex
CREATE UNIQUE INDEX "sales_desk_sales_companyId_numberKey_key" ON "sales_desk_sales"("companyId", "numberKey");

-- CreateIndex
CREATE UNIQUE INDEX "sales_desk_lines_saleId_position_key" ON "sales_desk_lines"("saleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sales_desk_payments_requestId_key" ON "sales_desk_payments"("requestId");

-- CreateIndex
CREATE INDEX "sales_desk_payments_saleId_idx" ON "sales_desk_payments"("saleId");

-- CreateIndex
CREATE INDEX "sales_desk_events_saleId_createdAt_idx" ON "sales_desk_events"("saleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_movements_salesPaymentId_key" ON "cash_desk_movements"("salesPaymentId");

-- AddForeignKey
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_salesPaymentId_fkey" FOREIGN KEY ("salesPaymentId") REFERENCES "sales_desk_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_customers" ADD CONSTRAINT "sales_desk_customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_sales_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "sales_desk_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_lines" ADD CONSTRAINT "sales_desk_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales_desk_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_payments" ADD CONSTRAINT "sales_desk_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales_desk_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_desk_events" ADD CONSTRAINT "sales_desk_events_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales_desk_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_amounts" CHECK ("totalAmount" > 0 AND "paidAmount" >= 0 AND "paidAmount" <= "totalAmount" AND ("voidedAt" IS NULL OR "paidAmount" = 0));
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_dates" CHECK ("dueDate" >= "saleDate");
ALTER TABLE "sales_desk_lines" ADD CONSTRAINT "sales_desk_line_amounts" CHECK ("quantity" > 0 AND "unitPrice" > 0 AND "totalAmount" > 0);
ALTER TABLE "sales_desk_payments" ADD CONSTRAINT "sales_desk_payment_positive" CHECK ("amount" > 0);
INSERT INTO "permissions" ("id","code","description","module","action","isGroupControl") VALUES
('perm-sales-desk-view','sales_desk.view','Read Sales Desk customers and sales','sales_desk','view',false),
('perm-sales-desk-manage','sales_desk.manage','Manage Sales Desk customers and sales','sales_desk','manage',false),
('perm-sales-desk-payments','sales_desk.payments','Record and reverse sales payments','sales_desk','payments',false)
ON CONFLICT ("code") DO UPDATE SET "description"=EXCLUDED."description";
INSERT INTO "role_permissions" ("roleId","permissionId") SELECT r."id",p."id" FROM "roles" r CROSS JOIN "permissions" p WHERE r."name"='GROUP_SUPER_ADMIN' AND p."module"='sales_desk' ON CONFLICT DO NOTHING;
