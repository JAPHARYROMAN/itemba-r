/*
  Warnings:

  - You are about to drop the column `posTransactionId` on the `sales_commissions` table. All the data in the column will be lost.
  - You are about to drop the `pos_transaction_lines` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `pos_transactions` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `salesOrderId` on table `sales_commissions` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "SalesPaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_CARD', 'BANK_TRANSFER', 'CREDIT', 'MIXED', 'OTHER');

-- DropForeignKey
ALTER TABLE "pos_transaction_lines" DROP CONSTRAINT "pos_transaction_lines_batchId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transaction_lines" DROP CONSTRAINT "pos_transaction_lines_inventoryLocationId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transaction_lines" DROP CONSTRAINT "pos_transaction_lines_posTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transaction_lines" DROP CONSTRAINT "pos_transaction_lines_productId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transaction_lines" DROP CONSTRAINT "pos_transaction_lines_unitId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_branchId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_cashAccountId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_cashierEmployeeId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_cashierId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_companyId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_customerId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_receivableId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_salesChannelId_fkey";

-- DropForeignKey
ALTER TABLE "pos_transactions" DROP CONSTRAINT "pos_transactions_salesOrderId_fkey";

-- DropForeignKey
ALTER TABLE "sales_commissions" DROP CONSTRAINT "sales_commissions_posTransactionId_fkey";

-- DropIndex
DROP INDEX "sales_commissions_posTransactionId_employeeId_idx";

-- AlterTable
ALTER TABLE "sales_commissions" DROP COLUMN "posTransactionId",
ALTER COLUMN "salesOrderId" SET NOT NULL;

-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "cashAccountId" TEXT,
ADD COLUMN     "paymentMethod" "SalesPaymentMethod" NOT NULL DEFAULT 'CREDIT',
ADD COLUMN     "paymentReference" TEXT;

-- DropTable
DROP TABLE "pos_transaction_lines";

-- DropTable
DROP TABLE "pos_transactions";

-- DropEnum
DROP TYPE "POSPaymentMethod";

-- DropEnum
DROP TYPE "POSTransactionStatus";

-- CreateIndex
CREATE INDEX "sales_order_lines_batchId_idx" ON "sales_order_lines"("batchId");

-- CreateIndex
CREATE INDEX "sales_orders_cashAccountId_idx" ON "sales_orders"("cashAccountId");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
