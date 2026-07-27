-- Supplier-issued invoice metadata for direct Operations purchases.
ALTER TABLE "purchase_orders"
  ADD COLUMN "supplierInvoiceNumber" TEXT,
  ADD COLUMN "supplierInvoiceDate" TIMESTAMP(3);

CREATE INDEX "purchase_orders_companyId_supplierInvoiceNumber_idx"
  ON "purchase_orders"("companyId", "supplierInvoiceNumber");

-- Supplier invoice numbers are unique within a supplier account, not across
-- unrelated suppliers that may use the same numbering sequence.
DROP INDEX IF EXISTS "supplier_invoices_companyId_supplierInvoiceNumber_key";
CREATE UNIQUE INDEX "supplier_invoices_companyId_supplierId_supplierInvoiceNumber_key"
  ON "supplier_invoices"("companyId", "supplierId", "supplierInvoiceNumber");

-- Historical imports could contain an unvalidated raw purchaseOrderId. Keep
-- those invoices, but clear dangling references before enforcing the FK.
UPDATE "supplier_invoices" AS invoice
SET "purchaseOrderId" = NULL
WHERE invoice."purchaseOrderId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "purchase_orders" AS purchase
    WHERE purchase."id" = invoice."purchaseOrderId"
  );

ALTER TABLE "supplier_invoices"
  ADD CONSTRAINT "supplier_invoices_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
