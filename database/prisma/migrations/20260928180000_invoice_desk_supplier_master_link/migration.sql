-- References only: preserve historical balances, invoice IDs and payment IDs.
-- Names are not proof of identity; match existing entries explicitly in each app.
ALTER TABLE "invoice_desk_suppliers" ADD COLUMN "canonicalSupplierId" TEXT;
CREATE INDEX "invoice_desk_suppliers_canonicalSupplierId_idx" ON "invoice_desk_suppliers"("canonicalSupplierId");
ALTER TABLE "invoice_desk_suppliers" ADD CONSTRAINT "invoice_desk_suppliers_canonicalSupplierId_fkey"
FOREIGN KEY ("canonicalSupplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_desk_customers" ADD COLUMN "canonicalCustomerId" TEXT;
CREATE INDEX "sales_desk_customers_canonicalCustomerId_idx" ON "sales_desk_customers"("canonicalCustomerId");
ALTER TABLE "sales_desk_customers" ADD CONSTRAINT "sales_desk_customers_canonicalCustomerId_fkey"
FOREIGN KEY ("canonicalCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_desk_invoices" ADD COLUMN "canonicalInvoiceId" TEXT;
CREATE UNIQUE INDEX "invoice_desk_invoices_canonicalInvoiceId_key" ON "invoice_desk_invoices"("canonicalInvoiceId");
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_invoices_canonicalInvoiceId_fkey"
FOREIGN KEY ("canonicalInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_desk_sales" ADD COLUMN "canonicalSalesOrderId" TEXT;
CREATE UNIQUE INDEX "sales_desk_sales_canonicalSalesOrderId_key" ON "sales_desk_sales"("canonicalSalesOrderId");
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_sales_canonicalSalesOrderId_fkey"
FOREIGN KEY ("canonicalSalesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
