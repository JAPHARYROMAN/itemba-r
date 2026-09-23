-- CreateTable
CREATE TABLE "cash_desk_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameKey" TEXT NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "openingDate" DATE NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_desk_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_desk_movements" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadKey" TEXT NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" VARCHAR(500),
    "reversalOfId" TEXT,
    "dailySalesKey" TEXT,
    "invoicePaymentId" TEXT,
    "loanId" TEXT,

    CONSTRAINT "cash_desk_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_desk_entries" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "cash_desk_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_desk_loans" (
    "id" TEXT NOT NULL,
    "lenderAccountId" TEXT NOT NULL,
    "borrowerAccountId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "outstanding" DECIMAL(18,2) NOT NULL,
    "loanDate" DATE NOT NULL,
    "dueDate" DATE,
    "description" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_desk_loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_desk_accounts_companyId_divisionId_branchId_idx" ON "cash_desk_accounts"("companyId", "divisionId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_accounts_branchId_nameKey_key" ON "cash_desk_accounts"("branchId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_movements_requestId_key" ON "cash_desk_movements"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_movements_reversalOfId_key" ON "cash_desk_movements"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_movements_dailySalesKey_key" ON "cash_desk_movements"("dailySalesKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_movements_invoicePaymentId_key" ON "cash_desk_movements"("invoicePaymentId");

-- CreateIndex
CREATE INDEX "cash_desk_movements_businessDate_createdAt_idx" ON "cash_desk_movements"("businessDate", "createdAt");

-- CreateIndex
CREATE INDEX "cash_desk_entries_accountId_businessDate_idx" ON "cash_desk_entries"("accountId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_entries_movementId_accountId_key" ON "cash_desk_entries"("movementId", "accountId");

-- CreateIndex
CREATE INDEX "cash_desk_loans_lenderAccountId_idx" ON "cash_desk_loans"("lenderAccountId");

-- CreateIndex
CREATE INDEX "cash_desk_loans_borrowerAccountId_idx" ON "cash_desk_loans"("borrowerAccountId");

-- AddForeignKey
ALTER TABLE "cash_desk_accounts" ADD CONSTRAINT "cash_desk_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_accounts" ADD CONSTRAINT "cash_desk_accounts_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_accounts" ADD CONSTRAINT "cash_desk_accounts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "cash_desk_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_invoicePaymentId_fkey" FOREIGN KEY ("invoicePaymentId") REFERENCES "invoice_desk_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "cash_desk_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_entries" ADD CONSTRAINT "cash_desk_entries_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "cash_desk_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_entries" ADD CONSTRAINT "cash_desk_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "cash_desk_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_loans" ADD CONSTRAINT "cash_desk_loans_lenderAccountId_fkey" FOREIGN KEY ("lenderAccountId") REFERENCES "cash_desk_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk_loans" ADD CONSTRAINT "cash_desk_loans_borrowerAccountId_fkey" FOREIGN KEY ("borrowerAccountId") REFERENCES "cash_desk_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_accounts" ADD CONSTRAINT "cash_desk_balance_valid" CHECK ("balance" >= 0 AND "version" > 0);
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "cash_desk_entries" ADD CONSTRAINT "cash_desk_entry_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "cash_desk_loans" ADD CONSTRAINT "cash_desk_loan_valid" CHECK ("principal" > 0 AND "outstanding" >= 0 AND "outstanding" <= "principal" AND "lenderAccountId" <> "borrowerAccountId" AND ("dueDate" IS NULL OR "dueDate" >= "loanDate"));
INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
('perm-cash-desk-view', 'cash_desk.view', 'Read Cash Desk accounts and movements', 'cash_desk', 'view', false),
('perm-cash-desk-manage', 'cash_desk.manage', 'Create Cash Desk accounts', 'cash_desk', 'manage', false),
('perm-cash-desk-record', 'cash_desk.record', 'Record Cash Desk sales, movements and loans', 'cash_desk', 'record', false),
('perm-cash-desk-reverse', 'cash_desk.reverse', 'Reverse Cash Desk movements', 'cash_desk', 'reverse', false)
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'GROUP_SUPER_ADMIN' AND p."module" = 'cash_desk'
ON CONFLICT DO NOTHING;
