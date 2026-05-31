ALTER TABLE "fuel_nozzles"
  ADD COLUMN IF NOT EXISTS "openingMeter" DECIMAL(18, 3);

UPDATE "fuel_nozzles"
SET "openingMeter" = COALESCE("openingMeter", "currentMeterReading", 0)
WHERE "openingMeter" IS NULL;

UPDATE "fuel_nozzles"
SET "openingMeter" = "currentMeterReading"
WHERE "openingMeter" = 0
  AND "currentMeterReading" <> 0;

ALTER TABLE "fuel_nozzles"
  ALTER COLUMN "openingMeter" SET DEFAULT 0,
  ALTER COLUMN "openingMeter" SET NOT NULL;
