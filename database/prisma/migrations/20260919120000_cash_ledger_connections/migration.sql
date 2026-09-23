ALTER TABLE "cash_accounts" ADD COLUMN "ledgerAccountId" TEXT;
ALTER TABLE "cash_desk_accounts" ADD COLUMN "erpCashAccountId" TEXT;
CREATE UNIQUE INDEX "cash_accounts_ledgerAccountId_key" ON "cash_accounts"("ledgerAccountId");
CREATE UNIQUE INDEX "cash_desk_accounts_erpCashAccountId_key" ON "cash_desk_accounts"("erpCashAccountId");
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_accounts" ADD CONSTRAINT "cash_desk_accounts_erpCashAccountId_fkey" FOREIGN KEY ("erpCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
