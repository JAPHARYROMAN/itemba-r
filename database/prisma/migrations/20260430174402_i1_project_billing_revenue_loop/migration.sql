-- CreateIndex
CREATE INDEX "project_billings_salesOrderId_idx" ON "project_billings"("salesOrderId");

-- CreateIndex
CREATE INDEX "project_billings_receivableId_idx" ON "project_billings"("receivableId");

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
