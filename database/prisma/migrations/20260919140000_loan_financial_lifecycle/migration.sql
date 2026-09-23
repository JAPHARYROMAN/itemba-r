ALTER TABLE "loans" ADD COLUMN "fundingMode" TEXT NOT NULL DEFAULT 'LEGACY', ADD COLUMN "principalLedgerAccountId" TEXT;
ALTER TABLE "loans" ADD CONSTRAINT "loans_principalLedgerAccountId_fkey" FOREIGN KEY ("principalLedgerAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_loans" ADD COLUMN "receivableAccountId" TEXT, ADD COLUMN "payableAccountId" TEXT;
ALTER TABLE "cash_desk_movements" ADD COLUMN "loanPrincipal" DECIMAL(18,2), ADD COLUMN "loanInterest" DECIMAL(18,2), ADD COLUMN "loanFees" DECIMAL(18,2);

CREATE TABLE "loan_financial_events" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadKey" TEXT NOT NULL,
  "kind" VARCHAR(30) NOT NULL,
  "businessDate" DATE NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "principal" DECIMAL(18,2) NOT NULL,
  "interest" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "fees" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "penalties" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL,
  "cashMovementId" TEXT,
  "journalEntryId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "repaymentId" TEXT,
  "scheduledPaymentId" TEXT,
  "reversalOfId" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversalReason" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_financial_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loan_financial_event_amounts" CHECK ("amount" > 0 AND "principal" >= 0 AND "interest" >= 0 AND "fees" >= 0 AND "penalties" >= 0 AND (
    ("kind" IN ('REPAYMENT','REVERSAL_REPAYMENT') AND "amount" = "principal" + "interest" + "fees" + "penalties") OR
    ("kind" IN ('DISBURSEMENT','REVERSAL_DISBURSEMENT') AND "amount" = "principal" - "fees" AND "interest" = 0 AND "penalties" = 0) OR
    ("kind" IN ('OPENING','REVERSAL_OPENING') AND "amount" = "principal" AND "interest" = 0 AND "fees" = 0 AND "penalties" = 0)
  )),
  CONSTRAINT "loan_financial_events_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_financial_events_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "cash_desk_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_financial_events_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_financial_events_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "loan_repayment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_financial_events_repaymentId_fkey" FOREIGN KEY ("repaymentId") REFERENCES "loan_repayments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_financial_events_scheduledPaymentId_fkey" FOREIGN KEY ("scheduledPaymentId") REFERENCES "loan_repayment_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "loan_financial_events_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "loan_financial_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "loan_financial_events_requestId_key" ON "loan_financial_events"("requestId");
CREATE UNIQUE INDEX "loan_financial_events_cashMovementId_key" ON "loan_financial_events"("cashMovementId");
CREATE UNIQUE INDEX "loan_financial_events_journalEntryId_key" ON "loan_financial_events"("journalEntryId");
CREATE UNIQUE INDEX "loan_financial_events_repaymentId_key" ON "loan_financial_events"("repaymentId");
CREATE UNIQUE INDEX "loan_financial_events_scheduledPaymentId_key" ON "loan_financial_events"("scheduledPaymentId");
CREATE UNIQUE INDEX "loan_financial_events_reversalOfId_key" ON "loan_financial_events"("reversalOfId");
CREATE INDEX "loan_financial_events_loanId_businessDate_idx" ON "loan_financial_events"("loanId", "businessDate");
CREATE INDEX "loan_financial_events_scheduleId_idx" ON "loan_financial_events"("scheduleId");
