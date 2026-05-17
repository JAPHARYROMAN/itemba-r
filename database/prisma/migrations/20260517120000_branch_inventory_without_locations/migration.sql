-- Branch/location is now the stock scope. This migration moves existing stock
-- references from inventory_locations onto branchId, then removes the legacy
-- inventory location table and columns.

ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "product_batches" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "harvest_records" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "project_material_issues" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

UPDATE "inventory_balances" b
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE b."inventoryLocationId" = l."id"
  AND b."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "inventory_movements" m
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE m."inventoryLocationId" = l."id"
  AND m."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "stock_adjustments" a
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE a."inventoryLocationId" = l."id"
  AND a."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "product_batches" b
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE b."inventoryLocationId" = l."id"
  AND b."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "product_batches" b
SET "branchId" = po."branchId"
FROM "purchase_orders" po
WHERE b."purchaseOrderId" = po."id"
  AND b."branchId" IS NULL
  AND po."branchId" IS NOT NULL;

UPDATE "stock_damages" d
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE d."inventoryLocationId" = l."id"
  AND d."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "harvest_records" h
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE h."inventoryLocationId" = l."id"
  AND h."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "project_material_issues" i
SET "branchId" = l."branchId"
FROM "inventory_locations" l
WHERE i."inventoryLocationId" = l."id"
  AND i."branchId" IS NULL
  AND l."branchId" IS NOT NULL;

UPDATE "project_material_issues" i
SET "branchId" = p."branchId"
FROM "construction_projects" p
WHERE i."projectId" = p."id"
  AND i."branchId" IS NULL
  AND p."branchId" IS NOT NULL;

CREATE TEMP TABLE "_inventory_balance_branch_rollup" ON COMMIT DROP AS
SELECT
  "companyId",
  "productId",
  "branchId",
  MIN("id") AS "keepId",
  SUM("quantityOnHand") AS "quantityOnHand",
  SUM("quantityReserved") AS "quantityReserved",
  SUM("totalValue") AS "totalValue",
  MAX("lastMovementAt") AS "lastMovementAt"
FROM "inventory_balances"
WHERE "branchId" IS NOT NULL
GROUP BY "companyId", "productId", "branchId"
HAVING COUNT(*) > 1;

UPDATE "inventory_balances" b
SET
  "quantityOnHand" = r."quantityOnHand",
  "quantityReserved" = r."quantityReserved",
  "totalValue" = r."totalValue",
  "averageCost" = CASE
    WHEN r."quantityOnHand" = 0 THEN 0
    ELSE r."totalValue" / r."quantityOnHand"
  END,
  "lastMovementAt" = r."lastMovementAt"
FROM "_inventory_balance_branch_rollup" r
WHERE b."id" = r."keepId";

DELETE FROM "inventory_balances" b
USING "_inventory_balance_branch_rollup" r
WHERE b."companyId" = r."companyId"
  AND b."productId" = r."productId"
  AND b."branchId" = r."branchId"
  AND b."id" <> r."keepId";

ALTER TABLE "inventory_balances" DROP CONSTRAINT IF EXISTS "inventory_balances_inventoryLocationId_fkey";
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_inventoryLocationId_fkey";
ALTER TABLE "stock_adjustments" DROP CONSTRAINT IF EXISTS "stock_adjustments_inventoryLocationId_fkey";
ALTER TABLE "sales_order_lines" DROP CONSTRAINT IF EXISTS "sales_order_lines_inventoryLocationId_fkey";
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT IF EXISTS "purchase_order_lines_inventoryLocationId_fkey";
ALTER TABLE "fuel_tanks" DROP CONSTRAINT IF EXISTS "fuel_tanks_inventoryLocationId_fkey";
ALTER TABLE "product_batches" DROP CONSTRAINT IF EXISTS "product_batches_inventoryLocationId_fkey";
ALTER TABLE "stock_damages" DROP CONSTRAINT IF EXISTS "stock_damages_inventoryLocationId_fkey";
ALTER TABLE "farm_input_applications" DROP CONSTRAINT IF EXISTS "farm_input_applications_inventoryLocationId_fkey";
ALTER TABLE "harvest_records" DROP CONSTRAINT IF EXISTS "harvest_records_inventoryLocationId_fkey";
ALTER TABLE "project_material_issues" DROP CONSTRAINT IF EXISTS "project_material_issues_inventoryLocationId_fkey";

DROP INDEX IF EXISTS "inventory_balances_companyId_productId_inventoryLocationId_key";
DROP INDEX IF EXISTS "inventory_balances_inventoryLocationId_idx";
DROP INDEX IF EXISTS "inventory_movements_inventoryLocationId_idx";
DROP INDEX IF EXISTS "inventory_locations_companyId_idx";
DROP INDEX IF EXISTS "inventory_locations_locationType_idx";
DROP INDEX IF EXISTS "inventory_locations_companyId_locationCode_key";

ALTER TABLE "inventory_balances" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "inventory_movements" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "stock_adjustments" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "sales_order_lines" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "purchase_order_lines" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "fuel_tanks" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "product_batches" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "stock_damages" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "farm_input_applications" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "harvest_records" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "project_material_issues" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "restaurant_order_lines" DROP COLUMN IF EXISTS "inventoryLocationId";
ALTER TABLE "goods_received_note_lines" DROP COLUMN IF EXISTS "inventoryLocationId";

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_balances_companyId_productId_branchId_key"
  ON "inventory_balances"("companyId", "productId", "branchId");
CREATE INDEX IF NOT EXISTS "inventory_balances_branchId_idx" ON "inventory_balances"("branchId");
CREATE INDEX IF NOT EXISTS "inventory_movements_branchId_idx" ON "inventory_movements"("branchId");
CREATE INDEX IF NOT EXISTS "product_batches_branchId_idx" ON "product_batches"("branchId");

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_batches"
  ADD CONSTRAINT "product_batches_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "harvest_records"
  ADD CONSTRAINT "harvest_records_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_material_issues"
  ADD CONSTRAINT "project_material_issues_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "inventory_locations";
DROP TYPE IF EXISTS "InventoryLocationType";
