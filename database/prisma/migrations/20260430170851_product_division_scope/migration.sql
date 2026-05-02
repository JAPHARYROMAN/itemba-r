-- AlterTable
ALTER TABLE "products" ADD COLUMN     "divisionId" TEXT;

-- CreateIndex
CREATE INDEX "products_divisionId_idx" ON "products"("divisionId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
