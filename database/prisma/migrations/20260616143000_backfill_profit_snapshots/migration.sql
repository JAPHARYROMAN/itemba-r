-- Best-effort backfill for historical confirmed sales.
-- Rows without usable cost remain NULL and are surfaced by the Profit module
-- until product master or branch average costs are fixed.
UPDATE "sales_order_lines" AS sol
SET
  "unitCostAtSale" = ROUND(costs."unitCost"::numeric, 4),
  "cogsAmount" = ROUND((sol."quantity" * costs."unitCost")::numeric, 2),
  "grossProfitAmount" = ROUND(((sol."quantity" * sol."unitPrice" - COALESCE(sol."discountAmount", 0)) - (sol."quantity" * costs."unitCost"))::numeric, 2),
  "grossMarginPct" = CASE
    WHEN (sol."quantity" * sol."unitPrice" - COALESCE(sol."discountAmount", 0)) > 0 THEN
      ROUND(((((sol."quantity" * sol."unitPrice" - COALESCE(sol."discountAmount", 0)) - (sol."quantity" * costs."unitCost")) / (sol."quantity" * sol."unitPrice" - COALESCE(sol."discountAmount", 0))) * 100)::numeric, 4)
    ELSE NULL
  END,
  "profitCostSource" = costs."source"::"ProfitCostSource"
FROM "sales_orders" AS so
JOIN "products" AS p ON p."id" = sol."productId"
LEFT JOIN "inventory_balances" AS ib
  ON ib."companyId" = so."companyId"
  AND ib."productId" = sol."productId"
  AND ib."branchId" IS NOT DISTINCT FROM so."branchId"
CROSS JOIN LATERAL (
  SELECT
    COALESCE(NULLIF(ib."averageCost", 0), NULLIF(p."defaultPurchasePrice", 0)) AS "unitCost",
    CASE
      WHEN ib."averageCost" IS NOT NULL AND ib."averageCost" > 0 THEN 'BRANCH_AVERAGE_COST'
      ELSE 'DEFAULT_PURCHASE_PRICE'
    END AS "source"
) AS costs
WHERE sol."salesOrderId" = so."id"
  AND so."status" IN ('CONFIRMED', 'PARTIALLY_PAID', 'PAID')
  AND sol."unitCostAtSale" IS NULL
  AND p."trackInventory" = true
  AND p."productType" NOT IN ('SERVICE', 'NON_STOCK_ITEM')
  AND costs."unitCost" IS NOT NULL
  AND costs."unitCost" > 0;
