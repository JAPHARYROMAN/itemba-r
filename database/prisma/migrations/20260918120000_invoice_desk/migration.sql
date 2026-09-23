-- CreateTable
CREATE TABLE "invoice_desk_suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "nameKey" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_desk_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_desk_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNumber" VARCHAR(100) NOT NULL,
    "numberKey" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(4000),
    "voidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_desk_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_desk_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" VARCHAR(500),

    CONSTRAINT "invoice_desk_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_desk_attachments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_desk_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_desk_events" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "detail" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_desk_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_desk_suppliers_companyId_nameKey_key" ON "invoice_desk_suppliers"("companyId", "nameKey");

-- CreateIndex
CREATE INDEX "invoice_desk_invoices_companyId_divisionId_branchId_dueDate_idx" ON "invoice_desk_invoices"("companyId", "divisionId", "branchId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_desk_invoices_companyId_supplierId_numberKey_key" ON "invoice_desk_invoices"("companyId", "supplierId", "numberKey");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_desk_payments_requestId_key" ON "invoice_desk_payments"("requestId");

-- CreateIndex
CREATE INDEX "invoice_desk_payments_invoiceId_idx" ON "invoice_desk_payments"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_desk_attachments_invoiceId_digest_key" ON "invoice_desk_attachments"("invoiceId", "digest");

-- CreateIndex
CREATE INDEX "invoice_desk_events_invoiceId_createdAt_idx" ON "invoice_desk_events"("invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "invoice_desk_suppliers" ADD CONSTRAINT "invoice_desk_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_invoices_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "invoice_desk_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_payments" ADD CONSTRAINT "invoice_desk_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice_desk_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_attachments" ADD CONSTRAINT "invoice_desk_attachments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice_desk_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_desk_events" ADD CONSTRAINT "invoice_desk_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice_desk_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_amounts_valid" CHECK ("totalAmount" > 0 AND "paidAmount" >= 0 AND "paidAmount" <= "totalAmount" AND ("voidedAt" IS NULL OR "paidAmount" = 0));
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_dates_valid" CHECK ("dueDate" >= "invoiceDate");
ALTER TABLE "invoice_desk_payments" ADD CONSTRAINT "invoice_desk_payment_positive" CHECK ("amount" > 0);
ALTER TABLE "invoice_desk_attachments" ADD CONSTRAINT "invoice_desk_attachment_size" CHECK ("size" > 0 AND "size" <= 10485760);

INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
('perm-invoice-desk-view', 'invoice_desk.view', 'Open Invoice Desk and read accessible invoices', 'invoice_desk', 'view', false),
('perm-invoice-desk-manage', 'invoice_desk.manage', 'Manage Invoice Desk suppliers, invoices and attachments', 'invoice_desk', 'manage', false),
('perm-invoice-desk-payments', 'invoice_desk.payments', 'Record and reverse Invoice Desk payments', 'invoice_desk', 'payments', false)
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description", "module" = EXCLUDED."module", "action" = EXCLUDED."action";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'GROUP_SUPER_ADMIN' AND p."module" = 'invoice_desk'
ON CONFLICT DO NOTHING;
