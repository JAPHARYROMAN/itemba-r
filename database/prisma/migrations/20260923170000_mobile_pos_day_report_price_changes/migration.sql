-- POS remake phase 5: price changes on the end-of-day report.
-- Additive; reports filed before price editing existed read 0.

-- AlterTable
ALTER TABLE "mobile_pos_day_reports" ADD COLUMN     "priceChangeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceDropTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "priceRaiseTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;
