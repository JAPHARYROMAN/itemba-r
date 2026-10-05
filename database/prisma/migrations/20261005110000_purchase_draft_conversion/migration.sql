-- Internal references are separate from supplier-issued invoice numbers.
ALTER TABLE "purchase_orders" ADD COLUMN "internalInvoiceNumber" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "sourceDraftId" TEXT;
CREATE UNIQUE INDEX "purchase_orders_companyId_internalInvoiceNumber_key" ON "purchase_orders"("companyId", "internalInvoiceNumber");
CREATE UNIQUE INDEX "purchase_orders_sourceDraftId_key" ON "purchase_orders"("sourceDraftId");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sourceDraftId_fkey" FOREIGN KEY ("sourceDraftId") REFERENCES "supplier_order_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
