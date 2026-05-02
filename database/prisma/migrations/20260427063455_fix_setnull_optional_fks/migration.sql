-- AlterTable
ALTER TABLE "customer_package_balances" ALTER COLUMN "returnablePackageId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "package_movements" ALTER COLUMN "returnablePackageId" DROP NOT NULL;
