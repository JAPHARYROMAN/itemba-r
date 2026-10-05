-- Preserve price-change attribution and amounts without requiring a salesperson explanation.
ALTER TABLE "mobile_pos_price_overrides" ALTER COLUMN "reasonCode" DROP NOT NULL;
