-- Supplier/category operating scope.
CREATE TABLE "supplier_product_categories" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productCategoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_product_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_product_categories_supplierId_productCategoryId_key"
  ON "supplier_product_categories"("supplierId", "productCategoryId");

CREATE INDEX "supplier_product_categories_productCategoryId_idx"
  ON "supplier_product_categories"("productCategoryId");

ALTER TABLE "supplier_product_categories"
  ADD CONSTRAINT "supplier_product_categories_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_product_categories"
  ADD CONSTRAINT "supplier_product_categories_productCategoryId_fkey"
  FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business licenses are scoped to the branch/location they cover.
ALTER TABLE "business_licenses" ADD COLUMN "branchId" TEXT;

CREATE INDEX "business_licenses_divisionId_idx" ON "business_licenses"("divisionId");
CREATE INDEX "business_licenses_branchId_idx" ON "business_licenses"("branchId");
CREATE INDEX "business_licenses_licensedBusinessUnitId_idx"
  ON "business_licenses"("licensedBusinessUnitId");

ALTER TABLE "business_licenses"
  ADD CONSTRAINT "business_licenses_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
