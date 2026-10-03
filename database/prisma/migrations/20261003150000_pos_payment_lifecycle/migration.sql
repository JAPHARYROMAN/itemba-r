ALTER TABLE "sales_orders" ADD COLUMN "posTenders" JSONB;
CREATE TABLE "pos_transaction_actions" (
 "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "divisionId" TEXT NOT NULL,
 "branchId" TEXT NOT NULL, "terminalId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "saleId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "result" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "pos_transaction_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pos_transaction_actions_companyId_requestId_key" ON "pos_transaction_actions"("companyId", "requestId");
CREATE INDEX "pos_transaction_actions_companyId_terminalId_saleId_idx" ON "pos_transaction_actions"("companyId", "terminalId", "saleId");
