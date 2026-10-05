-- CreateTable
CREATE TABLE "supplier_purchase_advances" (
    "id" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "advanceAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_purchase_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_purchase_advance_applications" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "reversalJournalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_purchase_advance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_purchase_advances_supplierPaymentId_key" ON "supplier_purchase_advances"("supplierPaymentId");

-- CreateIndex
CREATE INDEX "supplier_purchase_advances_purchaseOrderId_idx" ON "supplier_purchase_advances"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_purchase_advance_applications_journalEntryId_key" ON "supplier_purchase_advance_applications"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_purchase_advance_applications_reversalJournalEntry_key" ON "supplier_purchase_advance_applications"("reversalJournalEntryId");

-- CreateIndex
CREATE INDEX "supplier_purchase_advance_applications_advanceId_payableId_idx" ON "supplier_purchase_advance_applications"("advanceId", "payableId");

-- AddForeignKey
ALTER TABLE "supplier_purchase_advances" ADD CONSTRAINT "supplier_purchase_advances_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_advances" ADD CONSTRAINT "supplier_purchase_advances_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_advances" ADD CONSTRAINT "supplier_purchase_advances_advanceAccountId_fkey" FOREIGN KEY ("advanceAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_advance_applications" ADD CONSTRAINT "supplier_purchase_advance_applications_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "supplier_purchase_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_advance_applications" ADD CONSTRAINT "supplier_purchase_advance_applications_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_advance_applications" ADD CONSTRAINT "supplier_purchase_advance_applications_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_advance_applications" ADD CONSTRAINT "supplier_purchase_advance_applications_reversalJournalEntr_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_purchase_advance_applications" ADD CONSTRAINT "supplier_advance_application_positive" CHECK ("amount" > 0);
