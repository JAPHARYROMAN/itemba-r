CREATE TYPE "ProfitCostSource" AS ENUM ('BRANCH_AVERAGE_COST', 'DEFAULT_PURCHASE_PRICE');

ALTER TABLE "sales_order_lines"
  ADD COLUMN "unitCostAtSale" DECIMAL(18,4),
  ADD COLUMN "cogsAmount" DECIMAL(18,2),
  ADD COLUMN "grossProfitAmount" DECIMAL(18,2),
  ADD COLUMN "grossMarginPct" DECIMAL(9,4),
  ADD COLUMN "profitCostSource" "ProfitCostSource";

