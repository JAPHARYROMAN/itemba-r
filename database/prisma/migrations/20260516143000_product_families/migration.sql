-- Product family / SKU variant hierarchy.
CREATE TABLE "product_families" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "divisionId" TEXT,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_families_companyId_idx" ON "product_families"("companyId");
CREATE INDEX "product_families_divisionId_idx" ON "product_families"("divisionId");
CREATE INDEX "product_families_categoryId_idx" ON "product_families"("categoryId");
CREATE INDEX "product_families_companyId_categoryId_name_idx"
  ON "product_families"("companyId", "categoryId", "name");

ALTER TABLE "product_families"
  ADD CONSTRAINT "product_families_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_families"
  ADD CONSTRAINT "product_families_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_families"
  ADD CONSTRAINT "product_families_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD COLUMN "productFamilyId" TEXT,
  ADD COLUMN "variantName" TEXT,
  ADD COLUMN "variantColor" TEXT,
  ADD COLUMN "variantSize" TEXT,
  ADD COLUMN "variantFinish" TEXT;

CREATE INDEX "products_productFamilyId_idx" ON "products"("productFamilyId");

ALTER TABLE "products"
  ADD CONSTRAINT "products_productFamilyId_fkey"
  FOREIGN KEY ("productFamilyId") REFERENCES "product_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
