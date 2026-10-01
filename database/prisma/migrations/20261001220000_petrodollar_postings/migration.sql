CREATE TABLE "fuel_report_postings" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "reportVersion" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "selections" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  "reversedBy" TEXT,
  "reversalReason" TEXT,
  CONSTRAINT "fuel_report_postings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fuel_report_postings_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "fuel_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fuel_report_postings_version_positive" CHECK ("reportVersion" > 0)
);
CREATE UNIQUE INDEX "fuel_report_postings_requestId_key" ON "fuel_report_postings"("requestId");
CREATE UNIQUE INDEX "fuel_report_postings_reportId_reportVersion_key" ON "fuel_report_postings"("reportId", "reportVersion");
CREATE UNIQUE INDEX "fuel_report_postings_active_key" ON "fuel_report_postings"("reportId") WHERE "reversedAt" IS NULL;
ALTER TABLE "sales_desk_sales" ADD COLUMN "fuelReportPostingId" TEXT;
ALTER TABLE "invoice_desk_invoices" ADD COLUMN "fuelReportPostingId" TEXT;
ALTER TABLE "cash_desk_movements" ADD COLUMN "fuelReportPostingId" TEXT;
ALTER TABLE "sales_desk_sales" ADD CONSTRAINT "sales_desk_sales_fuelReportPostingId_fkey" FOREIGN KEY ("fuelReportPostingId") REFERENCES "fuel_report_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_desk_invoices" ADD CONSTRAINT "invoice_desk_invoices_fuelReportPostingId_fkey" FOREIGN KEY ("fuelReportPostingId") REFERENCES "fuel_report_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_fuelReportPostingId_fkey" FOREIGN KEY ("fuelReportPostingId") REFERENCES "fuel_report_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "sales_desk_sales_fuelReportPostingId_idx" ON "sales_desk_sales"("fuelReportPostingId");
CREATE INDEX "invoice_desk_invoices_fuelReportPostingId_idx" ON "invoice_desk_invoices"("fuelReportPostingId");
CREATE INDEX "cash_desk_movements_fuelReportPostingId_idx" ON "cash_desk_movements"("fuelReportPostingId");
