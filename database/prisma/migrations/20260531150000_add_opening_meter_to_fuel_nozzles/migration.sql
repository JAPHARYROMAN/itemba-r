ALTER TABLE "fuel_nozzles"
  ADD COLUMN "openingMeter" DECIMAL(18, 3) NOT NULL DEFAULT 0;

UPDATE "fuel_nozzles"
SET "openingMeter" = "currentMeterReading"
WHERE "openingMeter" = 0;
