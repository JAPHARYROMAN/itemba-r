-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "disbursingChartOfAccountId" TEXT,
ADD COLUMN     "paymentJournalEntryId" TEXT;

-- AlterTable
ALTER TABLE "salary_advances" ADD COLUMN     "paymentJournalEntryId" TEXT,
ADD COLUMN     "recoveredAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "hr_documents_documentId_idx" ON "hr_documents"("documentId");

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
