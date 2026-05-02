-- CreateIndex
CREATE INDEX "trips_salesOrderId_idx" ON "trips"("salesOrderId");

-- CreateIndex
CREATE INDEX "trips_receivableId_idx" ON "trips"("receivableId");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
