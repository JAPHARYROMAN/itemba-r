-- POS remake phase 3: price editing (POS_REMAKE_PLAN_2026-09-23.md section 5).
-- Additive only. maxPriceDropPct defaults to 0, so no rep may lower a price on
-- any terminal until an administrator sets a limit.

-- AlterTable
ALTER TABLE "mobile_pos_terminals" ADD COLUMN     "maxPriceDropPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "mobile_pos_price_overrides" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listUnitPrice" DECIMAL(18,4) NOT NULL,
    "chargedUnitPrice" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_pos_price_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_pos_price_overrides_companyId_createdAt_idx" ON "mobile_pos_price_overrides"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "mobile_pos_price_overrides_terminalId_createdAt_idx" ON "mobile_pos_price_overrides"("terminalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_pos_price_overrides_salesOrderId_productId_key" ON "mobile_pos_price_overrides"("salesOrderId", "productId");

-- AddForeignKey
ALTER TABLE "mobile_pos_price_overrides" ADD CONSTRAINT "mobile_pos_price_overrides_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_pos_price_overrides" ADD CONSTRAINT "mobile_pos_price_overrides_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "mobile_pos_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
